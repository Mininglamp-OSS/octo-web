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
// Design (round 3 — structural, per review P0-1/P1-1/P1-2/P2-2/P2-5/P2-11):
// - Mutual exclusion comes from Electron's OWN single-instance lock, keyed
//   off the userData path on every platform. index.ts points userData at the
//   legacy dir BEFORE requestSingleInstanceLock(), so the lock is taken on
//   the legacy path:
//     * a running legacy DMWork instance already holds that lock  -> this
//       launch's requestSingleInstanceLock() fails and it quits (the legacy
//       guard, cross-platform, no hand-written probe needed);
//     * a concurrent launch during the migration hits the same held lock and
//       quits — exactly one process can ever be the migrator, and no second
//       window can appear mid-copy (the old deferral race that discarded a
//       user's session is gone).
//   On success index.ts relaunches so the next process takes the OCTO lock.
// - Staging copy + atomic rename: copy into <appData>/OCTO.migrating, then
//   renameSync into place. renameSync is atomic, so <appData>/OCTO only ever
//   appears as a COMPLETE profile. DMWork is never mutated, so a failed
//   attempt simply retries on the next launch and a release rollback keeps
//   the legacy profile.
// - Completion marker: the sentinel is <appData>/OCTO/.migrated-from-dmwork,
//   NOT the existence of <appData>/OCTO. The marker is written into the
//   staging dir BEFORE the rename (round-1 F5), so profile+marker publish
//   atomically and a post-rename marker failure can no longer strand a
//   markerless destination.
// - Failure containment ("never throws", round-2 P0-2): every I/O statement
//   in both plan() and execute() is inside a try/catch. No input state may
//   make them throw — plan() degrades to "legacy" (this session keeps the
//   DMWork path, retried next launch), execute() degrades to "failed" with
//   the legacy profile, and index.ts adds a defensive try/catch backstop.
// - Destination with real data (round-1 F6/F10): if <appData>/OCTO already
//   exists with non-lock content and no marker, plan() returns "none"
//   permanently (idempotent, no per-launch re-decision), both profiles are
//   kept, and the skip is logged loudly. execute() re-asserts the lock-only
//   invariant immediately before deleting the destination (round-2 P2-6).
// - Copy filter is anchored to top-level entries only (round-2 P2-3): nested
//   dirs named like caches (e.g. Partitions/*/Cache) are NOT pruned — only a
//   top-level entry in SKIP_DIRS / ELECTRON_LOCK_FILES is skipped.
// ---------------------------------------------------------------------------

export const LEGACY_USER_DATA_DIR = "DMWork";
export const MIGRATION_MARKER = ".migrated-from-dmwork";

// Files Electron/Chromium's ProcessSingleton creates in userData. Never
// migrated (round-1 F3) and the only entries a pre-existing destination is
// allowed to contain for the migration to proceed (round-1 F2/F10).
const ELECTRON_LOCK_FILES = new Set([
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "lockfile",
]);

// Regenerable Chromium caches, intentionally not migrated (top-level only).
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
  action: "migrate" | "legacy" | "none";
  oldDir: string;
  newDir: string;
  stagingDir: string;
};

export type MigrationResult = "done" | "deferred" | "failed";

export type MigrationRuntime = {
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string, err: unknown): void;
  };
};

export function planUserDataMigration(appDataDir: string, brandName: string): MigrationPlan {
  const oldDir = path.join(appDataDir, LEGACY_USER_DATA_DIR);
  const newDir = path.join(appDataDir, brandName);
  const stagingDir = `${newDir}.migrating`;
  try {
    if (!fs.existsSync(oldDir) || fs.existsSync(path.join(newDir, MIGRATION_MARKER))) {
      return { action: "none", oldDir, newDir, stagingDir };
    }
    // round-1 F6/F10: a destination that already holds real data (no marker)
    // wins. Deciding here — not in execute() — makes the decision idempotent
    // across launches: plan() returns "none" forever, no re-decision loop.
    // The skip is surfaced loudly (round-2 P2-1).
    if (fs.existsSync(newDir)) {
      const nonLock = fs
        .readdirSync(newDir)
        .filter((name) => !ELECTRON_LOCK_FILES.has(name) && name !== MIGRATION_MARKER);
      if (nonLock.length > 0) {
        console.warn(
          `[userData] ${newDir} already contains data but no migration marker; keeping both profiles and NOT migrating (legacy data stays in ${oldDir}).`
        );
        return { action: "none", oldDir, newDir, stagingDir };
      }
    }
    return { action: "migrate", oldDir, newDir, stagingDir };
  } catch (err) {
    // round-2 P0-2: never throw out of plan(). Degrade to "legacy" — the
    // caller points userData at DMWork for this session and retries next
    // launch. Safer than guessing "none" (which would use an empty OCTO).
    console.error(
      `[userData] planUserDataMigration failed; using the legacy profile this session (will retry on next launch):`,
      err
    );
    return { action: "legacy", oldDir, newDir, stagingDir };
  }
}

export function executeUserDataMigration(
  plan: MigrationPlan,
  runtime: MigrationRuntime
): MigrationResult {
  if (plan.action !== "migrate") {
    // "none": nothing to do. "legacy": the caller already pointed userData
    // at the legacy dir before the single-instance lock; this session simply
    // runs there and retries the migration next launch.
    return plan.action === "legacy" ? "deferred" : "done";
  }
  // action === "migrate"
  try {
    // round-2 P2-6: re-assert the lock-only invariant immediately before
    // deleting the destination — plan() may have run minutes ago (the copy
    // below can be slow on multi-GB profiles).
    if (fs.existsSync(plan.newDir)) {
      const nonLock = fs
        .readdirSync(plan.newDir)
        .filter((name) => !ELECTRON_LOCK_FILES.has(name));
      if (nonLock.length > 0) {
        runtime.log.warn(
          `[userData] ${plan.newDir} gained non-lock data since planning; not migrating (both profiles kept).`
        );
        return "done";
      }
      fs.rmSync(plan.newDir, { recursive: true, force: true });
    }
    // Crash residue from an interrupted previous attempt: with the
    // single-instance lock as the mutex there is never a concurrent writer,
    // so a leftover staging dir is always stale — clear it.
    if (fs.existsSync(plan.stagingDir)) {
      fs.rmSync(plan.stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(plan.stagingDir);
    // round-1 F3 + round-2 P2-3: never copy singleton artifacts / locks, and
    // anchor the filter to top-level entries (nested dirs are left alone).
    fs.cpSync(plan.oldDir, plan.stagingDir, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(plan.oldDir, src);
        if (rel.includes(path.sep)) return true; // nested: never prune
        return !SKIP_DIRS.has(rel) && !ELECTRON_LOCK_FILES.has(rel);
      },
    });
    // round-1 F5: marker lands in staging BEFORE the rename, so profile+marker
    // publish as one atomic step. (No fsync: a marker is only ever written
    // before the rename now, and claiming power-loss durability would require
    // flushing the whole copied tree, which is out of scope — round-2 P2-4.)
    fs.writeFileSync(path.join(plan.stagingDir, MIGRATION_MARKER), new Date().toISOString());
    fs.renameSync(plan.stagingDir, plan.newDir);
    runtime.log.info(`[userData] migrated legacy DMWork profile to ${plan.newDir}`);
    return "done";
  } catch (err) {
    try {
      fs.rmSync(plan.stagingDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; the next launch retries anyway
    }
    runtime.log.error(
      "[userData] DMWork -> OCTO migration failed; keeping the legacy profile for this session (will retry on next launch):",
      err
    );
    return "failed";
  }
}
