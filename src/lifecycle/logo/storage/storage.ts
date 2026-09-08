// Where a logo lives, and how it gets there without ever overwriting one.
//
// `capabilities/<id>/<incarnation_id>/logo.svg` — beside the immutable `vN/` directories rather
// than inside one ([ADR-0007](../../../../docs/adr/0007-capability-logo-contract.md)). That position
// is what makes retry possible: artwork arrives after the snapshot is published, and a file inside
// `v1/` would mutate a published snapshot or falsify `snapshot.json`'s inventory. Deletion already
// removes the incarnation tree, so there is no second cleanup path.
//
// The installer never overwrites: `link` + `unlink` rather than `rename`, which clobbers silently
// against L7, so a second installer fails loudly and the first drawing survives. The temp is named
// for the incarnation and attempt and removed in `finally`, so recovery can recognise what a
// crashed claim left.

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
import { errorMessage } from "../../../platform/errors.ts";
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
 * Asked before a loss is believed: a `present` row with no file is one drawing gone or a root
 * pointing elsewhere, and the answer to loss is terminal `abandoned`, which L7 forbids redrawing.
 */
export function capabilityIncarnationTreeExists(
  artifactsRoot: string,
  capabilityId: string,
  incarnationId: string,
): boolean {
  return existsSync(capabilityIncarnationRoot(artifactsRoot, capabilityId, incarnationId));
}

/**
 * The accepted bytes, or `null` when there is nothing to serve. Every failure is `null`, never a
 * throw: the route must answer with an explicit `no-store` 404, not whatever a raised error caches.
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
 * A `stat`, never a read: the file arrives by `link` from whole bytes, so presence is completeness
 * and zero bytes is a truncation. `missing` is proven — one EACCES would abandon an intact drawing.
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
    // ENOENT is "no such file"; ENOTDIR is that plus a path component that is not a directory.
    // Both are candidates for the incarnation having no artwork. Nothing else is.
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unknown";
  }
}

/**
 * Remove a zero-byte file at the logo path. A truncated file was never accepted, and left in place
 * it fails every remaining paid attempt on EEXIST. Called only when no attempt is running.
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
    // Not silent: a truncated file that survives fails every remaining paid attempt on EEXIST, and
    // the capability reaches its permanent placeholder with no line explaining why.
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error(`omni-crud could not remove a logo file holding no drawing at ${path}:`, error);
    }
    return false;
  }
}

/**
 * Remove every logo attempt temp in this incarnation's `.staging`. Safe to take all of them because
 * no attempt is running, and the name pattern matches nothing else; the final file is one level up.
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
 * Install accepted bytes at the incarnation's logo path, atomically and without overwriting. Throws
 * {@link LogoInstallError} if artwork is there: the right answer to two attempts landing at once.
 */
export function installCapabilityLogo(input: InstallCapabilityLogoInput): InstalledLogo {
  const { artifactsRoot, capabilityId, incarnationId, attempt, bytes } = input;
  const root = resolve(process.cwd(), artifactsRoot);
  // The same defensive parent chain a snapshot is published through: real directories,
  // never a symlink, and idempotent.
  createSafeStagingParent(root, capabilityId, incarnationId);

  const incarnationRoot = capabilityIncarnationRoot(artifactsRoot, capabilityId, incarnationId);
  // Scoped to the incarnation by where it sits and to the attempt by what it is called, so a
  // crashed claim leaves something recovery can recognize and sweep.
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
        `Refusing to install a second logo at ${finalPath}: ${errorMessage(error)}`,
      );
    }
    return { path: finalPath, inode: statSync(finalPath).ino };
  } finally {
    removeIfPresent(temporaryPath);
  }
}

/**
 * Take back bytes installed but never acknowledged: no lifecycle said `present`, and left in place
 * they fail every later attempt on EEXIST. The inode is the proof — the sweep is a second writer.
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
