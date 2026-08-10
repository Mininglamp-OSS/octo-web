import fs from "fs";
import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// One-time userData migration from the legacy DMWork profile to OCTO.
//
// Why this exists: app.setName("OCTO") (main/index.ts) relocates Electron's
// default userData from <appData>/DMWork to <appData>/OCTO. Without a migration
// every existing user would silently start with a fresh empty profile (lost
// session, localStorage, IndexedDB message stores, drafts).
//
// Design (each point maps to a review finding on PR #1265):
// - Staging copy + atomic rename: copy into <appData>/OCTO.migrating, then
//   renameSync into place. renameSync is atomic, so <appData>/OCTO only ever
//   appears as a COMPLETE profile — a torn LevelDB can never be mistaken for a
//   finished one. DMWork is never mutated, so a failed attempt simply retries
//   on the next launch and a release rollback keeps the legacy profile.
// - Completion marker: the sentinel is <appData>/OCTO/.migrated-from-dmwork,
//   NOT the existence of <appData>/OCTO — startup itself (the single-instance
//   lock, then Chromium) creates that directory, so destination-existence
//   would latch a failed migration forever. The marker is written into the
//   staging dir BEFORE the rename (F5), so profile+marker publish atomically
//   and a post-rename marker failure can no longer strand a markerless
//   destination.
// - Cross-launch mutex (F2): the staging dir itself is the mutex.
//   fs.mkdirSync is atomic — EEXIST means another launch is mid-migration,
//   so this launch defers to the legacy profile. A stale staging dir (owner
//   pid dead, or no owner file from a pre-upgrade crash) is claimed and
//   retried. The migration therefore runs BEFORE requestSingleInstanceLock()
//   and never has to delete a lock it holds; the fallback also happens before
//   the lock, so the fallback session's lock is created in the legacy dir it
//   writes (F4) — no double writer anywhere.
// - Legacy instance guard (F1): a running DMWork-branded process holds
//   <appData>/DMWork/SingletonLock. On POSIX Chromium writes that file as a
//   symlink to a deliberately non-existent target "<hostname>-<pid>", so
//   existsSync (which follows links) can never see it; Windows has no such
//   file at all (ProcessSingleton uses OS primitives). We lstat the link,
//   parse the target, confirm the hostname and that the pid is alive, and
//   only then defer. A stale lock (dead pid / foreign hostname / unparseable)
//   is treated as not held so a crash can never permanently trap users. On
//   Windows the guard is a no-op by design: a live legacy process keeps its
//   profile files open, so the copy/rename fails and the catch falls back to
//   the legacy profile — same outcome, no data loss.
// - Fallback on failure: if the copy/rename fails, this session keeps using
//   the legacy profile via setUserDataDir(oldDir) — the user keeps their data
//   and the migration retries on the next launch (marker still absent).
// - Destination with real data (F6/F10): if <appData>/OCTO already exists
//   with non-lock content and no marker, plan() returns "none" — permanently
//   (not a per-launch re-decision), both profiles are kept, and the skip is
//   surfaced through the log. Correctness never depends on enumerating every
//   future file Chromium might create early.
// ---------------------------------------------------------------------------

export const LEGACY_USER_DATA_DIR = "DMWork";
export const MIGRATION_MARKER = ".migrated-from-dmwork";
export const STAGING_OWNER_FILE = ".migration-owner.json";

// Files Electron/Chromium's ProcessSingleton creates in userData. They are
// never migrated (F3) and are the only entries a pre-existing destination is
// allowed to contain for the migration to proceed (F2/F10).
const ELECTRON_LOCK_FILES = new Set([
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "lockfile",
]);

// Regenerable Chromium caches, intentionally not migrated.
export const SKIP_DIRS = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "ShaderCache",
  "Service Worker",
  "blob_storage",
]);

export type MigrationPlan = {
  action: "migrate" | "defer-legacy" | "none";
  oldDir: string;
  newDir: string;
  stagingDir: string;
};

export type MigrationResult = "done" | "deferred" | "failed";

export type MigrationRuntime = {
  setUserDataDir: (dir: string) => void;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string, err: unknown): void;
  };
};

// F1: detect a live legacy DMWork instance.
// POSIX: SingletonLock is a symlink to "<hostname>-<pid>" whose target does
// not exist, so lstat (no follow) is required. Windows: no SingletonLock
// file — the guard intentionally returns false; see header comment.
export function isLegacyInstanceRunning(oldDir: string): boolean {
  const lockPath = path.join(oldDir, "SingletonLock");
  let raw: string;
  try {
    const st = fs.lstatSync(lockPath);
    raw = st.isSymbolicLink()
      ? fs.readlinkSync(lockPath)
      : fs.readFileSync(lockPath, "utf8").trim();
  } catch {
    return false; // ENOENT or unreadable -> not running; never trap on a stale lock
  }
  const match = /^(.+)-(\d+)$/.exec(raw);
  if (!match) return false; // unparseable -> treat as stale, do not defer forever
  const [, hostname, pidStr] = match;
  if (hostname !== os.hostname()) return false; // lock from another machine -> stale
  const pid = Number(pidStr);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // liveness probe, no signal
    return true;
  } catch (err) {
    // EPERM: the pid exists but is owned by another user -> still running.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function planUserDataMigration(appDataDir: string, brandName: string): MigrationPlan {
  const oldDir = path.join(appDataDir, LEGACY_USER_DATA_DIR);
  const newDir = path.join(appDataDir, brandName);
  const stagingDir = `${newDir}.migrating`;
  if (!fs.existsSync(oldDir) || fs.existsSync(path.join(newDir, MIGRATION_MARKER))) {
    return { action: "none", oldDir, newDir, stagingDir };
  }
  // F6/F10: a destination that already holds real data (no marker) wins.
  // Deciding here — not in execute() — makes the decision idempotent across
  // launches: plan() returns "none" forever, no per-launch re-decision loop.
  if (fs.existsSync(newDir)) {
    const nonLock = fs
      .readdirSync(newDir)
      .filter((name) => !ELECTRON_LOCK_FILES.has(name) && name !== MIGRATION_MARKER);
    if (nonLock.length > 0) {
      return { action: "none", oldDir, newDir, stagingDir };
    }
  }
  if (isLegacyInstanceRunning(oldDir)) {
    return { action: "defer-legacy", oldDir, newDir, stagingDir };
  }
  return { action: "migrate", oldDir, newDir, stagingDir };
}

function isStagingOwnedByLiveProcess(stagingDir: string): boolean {
  try {
    const owner = JSON.parse(
      fs.readFileSync(path.join(stagingDir, STAGING_OWNER_FILE), "utf8")
    ) as { hostname?: unknown; pid?: unknown };
    if (typeof owner.hostname !== "string" || typeof owner.pid !== "number") {
      return false; // unparseable owner -> stale
    }
    if (owner.hostname !== os.hostname()) return false; // from another machine
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  } catch {
    return false; // no owner file (pre-upgrade crash residue) -> stale, claim it
  }
}

function writeOwnerFile(stagingDir: string): void {
  fs.writeFileSync(
    path.join(stagingDir, STAGING_OWNER_FILE),
    JSON.stringify({
      hostname: os.hostname(),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    })
  );
}

export function executeUserDataMigration(
  plan: MigrationPlan,
  runtime: MigrationRuntime
): MigrationResult {
  if (plan.action === "none") {
    return "done";
  }
  if (plan.action === "defer-legacy") {
    // F7: this branch is reachable because index.ts routes defer-legacy
    // through executeUserDataMigration; the user-actionable message below is
    // the only signal that a running legacy instance deferred the migration.
    runtime.setUserDataDir(plan.oldDir);
    runtime.log.warn(
      `[userData] a legacy DMWork instance is still running (${path.join(
        plan.oldDir,
        "SingletonLock"
      )} is held); using the legacy profile for this session. Quit the old app and relaunch to migrate.`
    );
    return "deferred";
  }
  // action === "migrate"
  // F2: acquire the staging dir as the cross-launch mutex BEFORE any copy.
  try {
    fs.mkdirSync(plan.stagingDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    if (isStagingOwnedByLiveProcess(plan.stagingDir)) {
      runtime.log.warn(
        `[userData] another launch is mid-migration (${plan.stagingDir}); using the legacy profile for this session.`
      );
      runtime.setUserDataDir(plan.oldDir);
      return "deferred";
    }
    // Stale staging from a crashed/interrupted attempt: claim it and retry.
    fs.rmSync(plan.stagingDir, { recursive: true, force: true });
    fs.mkdirSync(plan.stagingDir);
  }
  writeOwnerFile(plan.stagingDir);
  try {
    // F3: never copy Chromium singleton artifacts or locks into the new profile.
    fs.cpSync(plan.oldDir, plan.stagingDir, {
      recursive: true,
      filter: (src) => {
        const name = path.basename(src);
        return !SKIP_DIRS.has(name) && !ELECTRON_LOCK_FILES.has(name);
      },
    });
    // F5: marker lands in staging BEFORE the rename, so profile+marker
    // publish as one atomic step. A marker can no longer be missing after a
    // successful rename (the old post-rename marker-failure window is gone).
    fs.writeFileSync(path.join(plan.stagingDir, MIGRATION_MARKER), new Date().toISOString());
    // F8 (durability, best-effort): flush the marker before publishing.
    try {
      const fd = fs.openSync(path.join(plan.stagingDir, MIGRATION_MARKER), "a");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd); // always close — a leaked handle blocks rename on Windows
      }
    } catch {
      // best-effort; not all platforms support fsync on every fd type
    }
    // plan() already refused to migrate when newDir holds real data; if it
    // exists here it contains only lock files (F2/F10), which at this point
    // belong to no live process: we run before our own single-instance lock
    // exists, and any concurrent launch that reached the lock already deferred
    // (its lock lives in <oldDir>).
    if (fs.existsSync(plan.newDir)) {
      fs.rmSync(plan.newDir, { recursive: true, force: true });
    }
    fs.renameSync(plan.stagingDir, plan.newDir);
    runtime.log.info(`[userData] migrated legacy DMWork profile to ${plan.newDir}`);
    return "done";
  } catch (err) {
    try {
      fs.rmSync(plan.stagingDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; the next launch retries anyway
    }
    runtime.setUserDataDir(plan.oldDir);
    runtime.log.error(
      "[userData] DMWork -> OCTO migration failed; keeping the legacy profile for this session (will retry on next launch):",
      err
    );
    return "failed";
  }
}
