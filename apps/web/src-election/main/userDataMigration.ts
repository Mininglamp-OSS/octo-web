import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// One-time userData migration from the legacy DMWork profile to OCTO.
//
// Why this exists: app.setName("OCTO") (main/index.ts) relocates Electron's
// default userData from <appData>/DMWork to <appData>/OCTO. Without a migration
// every existing user would silently start with a fresh empty profile (lost
// session, localStorage, IndexedDB message stores, drafts).
//
// Design (each point maps to a review finding on PR #1258):
// - Staging copy + atomic rename: copy into <appData>/OCTO.migrating, then
//   renameSync into place. renameSync is atomic, so <appData>/OCTO only ever
//   appears as a COMPLETE profile — a torn LevelDB can never be mistaken for a
//   finished one. DMWork is never mutated, so a failed attempt simply retries
//   on the next launch and a release rollback keeps the legacy profile.
// - Completion marker: the sentinel is <appData>/OCTO/.migrated-from-dmwork,
//   NOT the existence of <appData>/OCTO — startup itself (the single-instance
//   lock, then Chromium) creates that directory, so destination-existence
//   would latch a failed migration forever.
// - Fallback on failure: if the copy/rename fails, this session keeps using
//   the legacy profile via setUserDataDir(oldDir) — the user keeps their data
//   and the migration retries on the next launch (marker still absent).
// - Legacy instance guard: a running DMWork-branded process holds
//   <appData>/DMWork/SingletonLock. When that lock exists we do NOT migrate
//   (copying a live profile is a torn snapshot; on macOS/Linux rename(2) would
//   even succeed against a live profile, giving two writers). Instead the
//   caller points userData at the legacy dir before requestSingleInstanceLock()
//   so the lock fails against the running instance and this launch quits.
// - Runs after requestSingleInstanceLock(): only the process that holds the
//   new single-instance lock performs the migration, closing the double-launch
//   race.
// ---------------------------------------------------------------------------

export const LEGACY_USER_DATA_DIR = "DMWork";
export const MIGRATION_MARKER = ".migrated-from-dmwork";

// Electron's single-instance lock creates these files in userData. When the
// migration runs after requestSingleInstanceLock(), <appData>/OCTO already
// contains them; they are regenerable and must be removed before the staging
// rename can land. Any OTHER entry in <appData>/OCTO is treated as real user
// data we must not clobber.
const ELECTRON_LOCK_FILES = new Set([
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
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
]);

export type MigrationPlan = {
  action: "migrate" | "defer-legacy" | "none";
  oldDir: string;
  newDir: string;
  stagingDir: string;
};

export function planUserDataMigration(appDataDir: string, brandName: string): MigrationPlan {
  const oldDir = path.join(appDataDir, LEGACY_USER_DATA_DIR);
  const newDir = path.join(appDataDir, brandName);
  const stagingDir = `${newDir}.migrating`;
  if (!fs.existsSync(oldDir) || fs.existsSync(path.join(newDir, MIGRATION_MARKER))) {
    return { action: "none", oldDir, newDir, stagingDir };
  }
  if (fs.existsSync(path.join(oldDir, "SingletonLock"))) {
    return { action: "defer-legacy", oldDir, newDir, stagingDir };
  }
  return { action: "migrate", oldDir, newDir, stagingDir };
}

export type MigrationResult = "done" | "deferred" | "failed";

export type MigrationRuntime = {
  setUserDataDir: (dir: string) => void;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string, err: unknown): void;
  };
};

export function executeUserDataMigration(
  plan: MigrationPlan,
  runtime: MigrationRuntime
): MigrationResult {
  if (plan.action === "none") {
    return "done";
  }
  if (plan.action === "defer-legacy") {
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
  try {
    // Stale staging dir from an interrupted previous attempt (crash mid-copy).
    if (fs.existsSync(plan.stagingDir)) {
      fs.rmSync(plan.stagingDir, { recursive: true, force: true });
    }
    // The single-instance lock (or an earlier failed run) may have created
    // <appData>/OCTO containing only Electron's lock files. Remove those; if
    // anything else is in there we treat it as user data we must not clobber
    // and skip the migration (both profiles are kept, nothing is lost).
    if (fs.existsSync(plan.newDir)) {
      const entries = fs.readdirSync(plan.newDir);
      const nonLock = entries.filter((name) => !ELECTRON_LOCK_FILES.has(name));
      if (nonLock.length > 0) {
        runtime.log.warn(
          `[userData] ${plan.newDir} already contains data but no migration marker; not migrating (both profiles kept).`
        );
        return "done";
      }
      // The dir itself must also go: on Windows renameSync fails against an
      // existing (even empty) destination directory.
      fs.rmSync(plan.newDir, { recursive: true, force: true });
    }
    fs.cpSync(plan.oldDir, plan.stagingDir, {
      recursive: true,
      filter: (src) => !SKIP_DIRS.has(path.basename(src)),
    });
    fs.renameSync(plan.stagingDir, plan.newDir);
    fs.writeFileSync(path.join(plan.newDir, MIGRATION_MARKER), new Date().toISOString());
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
