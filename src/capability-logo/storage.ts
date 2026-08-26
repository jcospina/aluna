// Where a logo lives, and how it gets there without ever overwriting one.
//
// `capabilities/<id>/<incarnation_id>/logo.svg` — beside the immutable `vN/` directories
// rather than inside one ([ADR-0007](../../docs/adr/0007-capability-logo-contract.md)).
// That position is the whole reason retry is possible: artwork arrives *after* the
// snapshot is published and activated, and a file inside `v1/` would either mutate a
// published snapshot or falsify `snapshot.json`'s exact inventory. Deletion already
// removes the incarnation tree, so the artwork's lifetime is the capability's with no
// second cleanup path.
//
// Two properties the installer holds:
//
//   - **No overwrite, ever.** `link` + `unlink` rather than `rename`, because `rename`
//     clobbers silently and L7 says an accepted drawing is never remade. A second
//     installer losing the race fails loudly and the first drawing survives.
//   - **No untracked staging artifact.** The temporary file is named for the incarnation
//     and the attempt that made it and is removed in `finally`, so recovery never has to
//     guess what a crashed claim left behind.

import { linkSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createSafeStagingParent } from "../builder/artifacts/artifact-publication.ts";
import { CAPABILITY_LOGO_FILENAME, capabilityLogoStagingName } from "./artifact-names.ts";

export class LogoInstallError extends Error {
  override readonly name = "LogoInstallError";
}

/** The incarnation's artifact root — the directory holding `vN/` and `logo.svg`. */
export function capabilityIncarnationRoot(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): string {
  return resolve(process.cwd(), artifactsRoot, capabilityId, incarnationId);
}

/** The one path an incarnation's accepted artwork is ever read from or written to. */
export function capabilityLogoPath(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): string {
  return join(
    capabilityIncarnationRoot(artifactsRoot, capabilityId, incarnationId),
    CAPABILITY_LOGO_FILENAME,
  );
}

/**
 * The accepted bytes, or `null` when this incarnation has no artwork to serve.
 *
 * One syscall rather than an `exists` followed by a read, and every failure is `null`
 * rather than a throw. The route that calls this has to answer "no picture" with an
 * explicit `no-store` 404: an unreadable file surfacing as an exception would leave the
 * cache policy to whatever the framework does with a raised error, which is the one
 * outcome the fail-closed rule exists to prevent.
 */
export function readCapabilityLogo(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): Uint8Array<ArrayBuffer> | null {
  try {
    return readFileSync(capabilityLogoPath(artifactsRoot, capabilityId, incarnationId));
  } catch {
    return null;
  }
}

export interface InstallCapabilityLogoInput {
  readonly artifactsRoot: string;
  readonly capabilityId: string;
  readonly incarnationId: string;
  /** The claimed attempt these bytes belong to — it names the temporary file. */
  readonly attempt: number;
  /** Exactly what the service returned. Nothing here inspects or rewrites them. */
  readonly bytes: Uint8Array;
}

/**
 * Identifies the exact file one attempt installed, so a later discard can prove it is
 * removing its own bytes rather than whatever now sits at that path.
 */
export interface InstalledLogo {
  readonly path: string;
  readonly inode: number;
}

/**
 * Install accepted bytes at the incarnation's logo path, atomically and without
 * overwriting. Throws {@link LogoInstallError} if artwork is already there — which is
 * the correct answer to two attempts landing at once, not a case to smooth over.
 */
export function installCapabilityLogo(input: InstallCapabilityLogoInput): InstalledLogo {
  const { artifactsRoot, capabilityId, incarnationId, attempt, bytes } = input;
  const root = resolve(process.cwd(), artifactsRoot);
  // The same defensive parent chain a snapshot is published through: real directories,
  // never a symlink, and idempotent.
  createSafeStagingParent(root, capabilityId, incarnationId);

  const incarnationRoot = capabilityIncarnationRoot(artifactsRoot, capabilityId, incarnationId);
  // Scoped to the incarnation by where it sits and to the attempt by what it is called,
  // so a crashed claim leaves something recovery can recognize and sweep rather than an
  // anonymous staging artifact.
  const temporaryPath = join(incarnationRoot, ".staging", capabilityLogoStagingName(attempt));
  const finalPath = join(incarnationRoot, CAPABILITY_LOGO_FILENAME);

  try {
    // Attempt numbers only ever rise, so this name is unique to this claim; truncating
    // is the right answer to the impossible case rather than a permanent block on it.
    writeFileSync(temporaryPath, bytes, { flag: "w" });
    try {
      // Atomic and no-overwrite in one syscall: `link` fails with EEXIST rather than
      // clobbering, which `rename` would do silently.
      linkSync(temporaryPath, finalPath);
    } catch (error) {
      throw new LogoInstallError(
        `Refusing to install a second logo at ${finalPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { path: finalPath, inode: statSync(finalPath).ino };
  } finally {
    removeIfPresent(temporaryPath);
  }
}

/**
 * Take back bytes this attempt installed but never got acknowledged.
 *
 * Only ever called when the finalizing write moved nothing — the row was deleted or had
 * already been settled by something else while the drawing was being made. Those bytes
 * were never *accepted*: no lifecycle ever said `present`, the route refuses to serve
 * them, and reconciliation would admit them forever. Left in place they would also make
 * every later attempt fail on EEXIST, since the installer refuses to overwrite. This is
 * therefore not the "never delete an accepted final file" case; it is its opposite.
 *
 * **The inode is the proof, not the path.** "Only this attempt could have written here"
 * is an invariant of today's single-claim lifecycle, and the retry sweep (5.5/04) is
 * exactly the code that could add a second writer. Removing accepted artwork is
 * unrecoverable — the route refuses a missing file and L7 forbids redrawing — so the
 * discard identifies what it installed rather than trusting who else might have.
 */
export function discardUnacknowledgedLogo(installed: InstalledLogo): void {
  let present: ReturnType<typeof statSync>;
  try {
    present = statSync(installed.path);
  } catch {
    return;
  }
  if (present.ino !== installed.inode) return;
  try {
    unlinkSync(installed.path);
  } catch (error) {
    // Not silent: the file this could not remove is the one that will fail every later
    // attempt on EEXIST, and an operator with no line in the log has nothing to go on.
    console.error(
      `omni-crud could not discard an unacknowledged logo at ${installed.path}:`,
      error,
    );
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone, which is the state this wanted.
  }
}
