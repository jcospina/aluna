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

import {
  existsSync,
  linkSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { createSafeStagingParent } from "../../../builder/artifacts/publication/artifact-publication.ts";
import {
  CAPABILITY_LOGO_FILENAME,
  CAPABILITY_LOGO_STAGING_PATTERN,
  capabilityLogoStagingName,
} from "../artifact-names.ts";

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
 * Whether this incarnation has an artifact tree at all.
 *
 * Asked before a *loss* is believed. A `present` row whose file is not there is either one
 * drawing that went or a root pointing somewhere the platform's artifacts are not, and the
 * two are indistinguishable from the file alone — while the answer to loss is terminal:
 * `abandoned`, which L7 forbids ever redrawing. An incarnation whose whole directory is
 * absent has not lost its logo; it has lost everything, and that is not this pass's news
 * to act on.
 */
export function capabilityIncarnationTreeExists(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): boolean {
  return existsSync(capabilityIncarnationRoot(artifactsRoot, capabilityId, incarnationId));
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

/** What is at the incarnation's one logo path, as far as recovery needs to know. */
export type StoredCapabilityLogo =
  /** A drawing. The route serves exactly this shape, so the two agree by construction. */
  | "accepted"
  /** A file holding no drawing. Nothing this platform writes can produce it. */
  | "truncated"
  /** Nothing at that path, proven — the errno said so, not a `catch` that assumed it. */
  | "missing"
  /** The question could not be answered. Recovery reconciles nothing from this. */
  | "unknown";

/**
 * What is on disk for this incarnation — the fact recovery reconciles an interrupted
 * claim from.
 *
 * One `stat`, never a read: the file only ever arrives by `link` from bytes already
 * written whole, so its presence *is* its completeness and a crash mid-write leaves a
 * temp rather than a short final file. Zero bytes is the one shape that cannot be a
 * drawing — nothing validates an empty document — and it is exactly the shape the route
 * already refuses to serve, so the two answer the same question the same way. Reading the
 * contents to decide would load every logo on the desk to learn what `stat` already says.
 *
 * **`missing` is proven, never assumed.** A `catch` that answered "missing" for every
 * errno would let one EACCES, EIO or descriptor exhaustion — a busy desk is the realistic
 * way in — reconcile a `present` row whose accepted drawing is intact and readable to the
 * permanent placeholder, which L7 then forbids ever redrawing. Only the errnos that mean
 * *there is nothing at this path* answer `missing`; every other failure, and anything at
 * the path that is not a regular file, is `unknown` and reconciles nothing.
 */
export function inspectCapabilityLogoFile(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): StoredCapabilityLogo {
  try {
    const file = statSync(capabilityLogoPath(artifactsRoot, capabilityId, incarnationId));
    if (!file.isFile()) return "unknown";
    return file.size > 0 ? "accepted" : "truncated";
  } catch (error) {
    // ENOENT is "no such file"; ENOTDIR is "no such file, and a path component is not a
    // directory either" — both are *candidates* for the incarnation having no artwork.
    // Nothing else is.
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unknown";
  }
}

/**
 * Remove a zero-byte file sitting at an incarnation's logo path, and say whether one went.
 *
 * **This is not the accepted-artwork rule's case; it is its opposite.** Recovery never
 * deletes an *accepted* final file — ADR-0007 is explicit, and after a loss the row is
 * reconciled to `abandoned` rather than redrawn. A truncated file was never accepted: no
 * lifecycle said `present` over it, the route refuses to serve it, and nothing this
 * platform writes can produce it, since bytes are validated before they are written and
 * installed whole by `link`.
 *
 * Left in place it is worse than untracked state. The installer refuses to overwrite, so
 * every remaining attempt would fail on EEXIST — the capability would spend its last paid
 * calls to be told the path is occupied, and reach the permanent placeholder holding a
 * file with nothing in it.
 *
 * Only ever called for an incarnation with no attempt running, and only after the same
 * `stat` that named it truncated.
 */
export function discardTruncatedCapabilityLogo(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): boolean {
  const path = capabilityLogoPath(artifactsRoot, capabilityId, incarnationId);
  try {
    // Asked again immediately before the removal rather than trusted from the caller's
    // earlier look: the one thing that must never happen here is unlinking a drawing.
    const file = statSync(path);
    if (!file.isFile() || file.size > 0) return false;
    unlinkSync(path);
    console.log(`omni-crud removed a logo file holding no drawing at ${path}`);
    return true;
  } catch (error) {
    // Not silent, for the same reason `removeLogoAttemptTemps` is not: a truncated file
    // that survives refuses every remaining paid attempt the installer's EEXIST, and the
    // capability reaches its permanent placeholder with no line explaining why.
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error(`omni-crud could not remove a logo file holding no drawing at ${path}:`, error);
    }
    return false;
  }
}

/**
 * Remove every logo attempt temp left in this incarnation's `.staging`, and answer with
 * what went.
 *
 * Only ever called by recovery, and only for an incarnation with no attempt running in
 * this process — which is what makes "every one of them" safe: the ordinary path removes
 * its own temp in `finally`, so anything still here belongs to a claim that died, and no
 * live claim can be mid-write. The name pattern is the second guard: it matches nothing
 * but an attempt temp, so a build's staging directory beside it is not even looked at.
 *
 * Nothing here can touch an accepted final file. It sits one directory up, and this reads
 * only `.staging` and only its matching entries.
 */
export function removeLogoAttemptTemps(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): string[] {
  const staging = join(
    capabilityIncarnationRoot(artifactsRoot, capabilityId, incarnationId),
    ".staging",
  );
  let entries: string[];
  try {
    entries = readdirSync(staging, { withFileTypes: true })
      .filter((entry) => entry.isFile() && CAPABILITY_LOGO_STAGING_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    // No staging directory at all, which is the ordinary shape of an incarnation whose
    // attempts all cleaned up after themselves.
    return [];
  }

  const swept: string[] = [];
  for (const name of entries) {
    const path = join(staging, name);
    try {
      unlinkSync(path);
      swept.push(path);
    } catch (error) {
      // Not silent: a temp that survives is untracked state reconciliation is told to
      // tolerate, so an operator gets the one line that explains why it is still there.
      console.error(`omni-crud could not sweep a stale logo attempt temp at ${path}:`, error);
    }
  }
  return swept;
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
 * would be an invariant of a single-claim lifecycle alone, and the retry sweep is exactly
 * the code that added a second writer. Removing accepted artwork is
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
