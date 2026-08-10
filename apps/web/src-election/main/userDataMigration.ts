import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

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
// - Cross-launch mutex (F2): the staging dir is the mutex, claimed atomically
//   by exclusive-creating the owner file ({ flag: "wx" }) — whoever writes
//   .migration-owner.json first is the migrator. A launcher that loses the
//   claim either defers (owner pid alive) or reclaims (owner dead / crash
//   residue). mkdir is only a directory bootstrap, never the claim itself, so
//   a process preempted between mkdir and owner-write cannot be misjudged as
//   stale. The migration runs BEFORE requestSingleInstanceLock() and never
//   has to delete a lock it holds; the fallback also happens before the lock,
//   so the fallback session's lock is created in the legacy dir it writes
//   (F4) — no double writer anywhere.
// - Legacy instance guard (F1): a running DMWork-branded process holds
//   <appData>/DMWork/SingletonLock. On POSIX Chromium writes that file as a
//   symlink to a deliberately non-existent target "<hostname>-<pid>", so
//   existsSync (which follows links) can never see it; we lstat the link,
//   parse the target, confirm the hostname and that the pid is alive, and
//   only then defer. A stale lock (dead pid / foreign hostname / unparseable)
//   is treated as not held so a crash can never permanently trap users. On
//   Windows there is no SingletonLock file (ProcessSingleton uses named
//   mutexes), so we probe running processes by the legacy image name
//   (DMWork.exe) instead — deferring is required there, not best-effort,
//   because Windows allows copying files that are open by another process.
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
// not exist, so lstat (no follow) is required. Windows: no SingletonLock file
// (ProcessSingleton uses OS primitives) — instead probe running processes by
// the legacy image name; a live legacy process keeps its profile files open
// and copying it would produce a torn snapshot, so deferring is required, not
// just best-effort.
export function isLegacyInstanceRunning(oldDir: string): boolean {
  if (process.platform === "win32") {
    return isLegacyProcessRunning();
  }
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

// Windows: no SingletonLock file exists; Chromium's ProcessSingleton there
// uses named mutexes. Probe the legacy executable by image name instead.
// The pre-rebrand (DMWork) executable name is "DMWork.exe" (the post-rebrand
// productName "OCTO" landed in #1258); tasklist returns non-zero when the
// filter matches nothing, which we treat as "not running".
export function isLegacyProcessRunningOutput(output: string): boolean {
  return /DMWork\.exe/i.test(output);
}

function isLegacyProcessRunning(): boolean {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq DMWork.exe", "/NH"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return isLegacyProcessRunningOutput(out);
  } catch {
    return false;
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
  // F2: the staging dir is the cross-launch mutex. mkdir is not the claim —
  // the OWNER FILE is, via atomic exclusive create ({ flag: "wx" }). This
  // closes the owner-file race: a process that mkdir'd but was preempted
  // before writing its owner loses the claim to whoever writes the owner
  // file first; a process that sees EEXIST on the owner file either defers
  // (live owner) or reclaims (dead owner / crash residue).
  let claimed = false;
  try {
    try {
      fs.mkdirSync(plan.stagingDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const ownerJson = JSON.stringify({
      hostname: os.hostname(),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    try {
      fs.writeFileSync(path.join(plan.stagingDir, STAGING_OWNER_FILE), ownerJson, { flag: "wx" });
      claimed = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (isStagingOwnedByLiveProcess(plan.stagingDir)) {
        runtime.log.warn(
          `[userData] another launch is mid-migration (${plan.stagingDir}); using the legacy profile for this session.`
        );
        runtime.setUserDataDir(plan.oldDir);
        return "deferred";
      }
      // Claimer is dead (crash / interrupted attempt): reclaim.
      fs.rmSync(plan.stagingDir, { recursive: true, force: true });
      fs.mkdirSync(plan.stagingDir);
      fs.writeFileSync(path.join(plan.stagingDir, STAGING_OWNER_FILE), ownerJson, { flag: "wx" });
      claimed = true;
    }
    // We hold the claim. Drop anything left in the dir by a crashed attempt
    // (our owner file stays).
    for (const entry of fs.readdirSync(plan.stagingDir)) {
      if (entry !== STAGING_OWNER_FILE) {
        fs.rmSync(path.join(plan.stagingDir, entry), { recursive: true, force: true });
      }
    }
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
    // The owner file is migration-internal metadata; never publish it into
    // the final profile.
    fs.rmSync(path.join(plan.stagingDir, STAGING_OWNER_FILE));
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
    // Only clean up a staging dir we actually claimed — never a live one.
    if (claimed) {
      try {
        fs.rmSync(plan.stagingDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; the next launch retries anyway
      }
    }
    runtime.setUserDataDir(plan.oldDir);
    runtime.log.error(
      "[userData] DMWork -> OCTO migration failed; keeping the legacy profile for this session (will retry on next launch):",
      err
    );
    return "failed";
  }
}
