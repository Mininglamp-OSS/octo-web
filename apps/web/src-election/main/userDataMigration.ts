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
// Design (round 4 — structural, per reviews):
// - Mutual exclusion comes from Electron's OWN single-instance lock. index.ts
//   points userData at the legacy dir BEFORE requestSingleInstanceLock(), so
//   the lock is taken on the legacy path (the primary-instance lookup keys off
//   the userData path): a running legacy instance or a concurrent launch fails
//   the lock and quits. On success index.ts relaunches so the next process
//   takes the OCTO lock. (P0-1/P1-1 from rounds 2-3.)
// - Staging copy + atomic rename: copy into <appData>/OCTO.migrating, then
//   renameSync into place. DMWork is never mutated, so a failed attempt
//   retries on the next launch and a release rollback keeps the legacy
//   profile.
// - Completion marker + profile sentinel (round-4 P1-2): the sentinel is
//   <appData>/OCTO/.migrated-from-dmwork AND a real profile file
//   (Preferences / Local State). A bare marker (power loss mid-publish, no
//   fsync anywhere) is NOT trusted — plan() treats it as torn and re-migrates.
//   The marker is written into the staging dir BEFORE the rename so profile+
//   marker publish atomically.
// - Failure containment ("never throws"): every I/O in plan()/execute() is
//   inside try/catch; plan degrades to "legacy", execute to "failed", index.ts
//   has a defensive try/catch backstop. Failures are visible: breadcrumbs in
//   the legacy profile bound retries (round-4 P1-1), and index.ts surfaces
//   dialogs for occupied-destination / too-many-failures / lock-held.
// - Destination policy (round-4 P2-1): a destination counts as a REAL profile
//   only when it has a profile sentinel. Anything else (lock files, Crashpad,
//   caches) is cleanable and does not block migration — no allowlist polarity.
// - Copy filter anchored to top-level entries, case-insensitive (nits).
// ---------------------------------------------------------------------------

export const LEGACY_USER_DATA_DIR = "DMWork";
export const MIGRATION_MARKER = ".migrated-from-dmwork";
export const MIGRATION_BREADCRUMB = ".migration-failed.json";
export const MAX_MIGRATION_ATTEMPTS = 3;

// A "real profile" is recognized by these sentinel files (Chromium always
// writes them into userData before any app-level data).
const PROFILE_SENTINELS = ["Preferences", "Local State"];

// Files Electron/Chromium's ProcessSingleton creates in userData. Never
// migrated (round-1 F3). Stored lower-case; matched case-insensitively.
const ELECTRON_LOCK_FILES = new Set([
  "singletonlock",
  "singletoncookie",
  "singletonsocket",
  "lockfile",
]);

// Regenerable Chromium caches / crash artifacts, intentionally not migrated
// (top-level only, matched case-insensitively). Stored lower-case.
const SKIP_DIRS = new Set([
  "cache",
  "code cache",
  "gpucache",
  "dawncache",
  "dawngraphitecache",
  "dawnwebgpucache",
  "shadercache",
  "service worker",
  "blob_storage",
  "crashpad",
]);

export type MigrationPlan = {
  action: "migrate" | "legacy" | "none";
  oldDir: string;
  newDir: string;
  stagingDir: string;
  reason?: "destination-occupied" | "too-many-failures";
};

export type MigrationResult = "done" | "failed" | "skipped";

export type MigrationRuntime = {
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string, err: unknown): void;
  };
};

function hasProfileSentinel(dir: string): boolean {
  return PROFILE_SENTINELS.some((name) => fs.existsSync(path.join(dir, name)));
}

function readBreadcrumb(oldDir: string): { attempts: number; lastError?: string; lastAttemptAt?: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(oldDir, MIGRATION_BREADCRUMB), "utf8"));
    return typeof raw?.attempts === "number" ? raw : null;
  } catch {
    return null;
  }
}

function writeBreadcrumb(oldDir: string, err: unknown): void {
  try {
    const prev = readBreadcrumb(oldDir) ?? { attempts: 0 };
    fs.writeFileSync(
      path.join(oldDir, MIGRATION_BREADCRUMB),
      JSON.stringify({
        attempts: prev.attempts + 1,
        lastError: err instanceof Error ? err.message : String(err),
        lastAttemptAt: new Date().toISOString(),
      })
    );
  } catch {
    // best-effort; never throw from the failure path
  }
}

function removeBreadcrumb(oldDir: string): void {
  try {
    fs.rmSync(path.join(oldDir, MIGRATION_BREADCRUMB), { force: true });
  } catch {
    // best-effort
  }
}

export function planUserDataMigration(appDataDir: string, brandName: string): MigrationPlan {
  const oldDir = path.join(appDataDir, LEGACY_USER_DATA_DIR);
  const newDir = path.join(appDataDir, brandName);
  const stagingDir = `${newDir}.migrating`;
  try {
    // P2-6: the legacy path must be a directory; a regular file is not a
    // profile (and would blow up the copy) — treat as "no migration".
    let oldIsDir = false;
    try {
      oldIsDir = fs.statSync(oldDir).isDirectory();
    } catch {
      oldIsDir = false;
    }
    if (!oldIsDir) {
      return { action: "none", oldDir, newDir, stagingDir };
    }
    // P1-2: marker alone is not trusted — it must be accompanied by a real
    // profile sentinel. A bare marker (torn publish) re-migrates.
    if (fs.existsSync(path.join(newDir, MIGRATION_MARKER))) {
      if (hasProfileSentinel(newDir)) {
        return { action: "none", oldDir, newDir, stagingDir };
      }
      console.warn(
        `[userData] ${newDir} has a migration marker but no profile sentinel (torn publish?); re-migrating.`
      );
    }
    // P2-1: a destination is a real profile only when it has a sentinel;
    // anything else (locks, Crashpad, caches) is cleanable and does not block.
    if (hasProfileSentinel(newDir)) {
      console.warn(
        `[userData] ${newDir} already contains a real profile (no marker); keeping both profiles and NOT migrating (legacy data stays in ${oldDir}).`
      );
      return { action: "none", oldDir, newDir, stagingDir, reason: "destination-occupied" };
    }
    // P1-1: bound retries — after N consecutive failures the migration stops
    // auto-retrying and the session runs on the legacy profile (index.ts
    // surfaces a dialog). Deleting ${oldDir}/${MIGRATION_BREADCRUMB} re-enables.
    const breadcrumb = readBreadcrumb(oldDir);
    if (breadcrumb && breadcrumb.attempts >= MAX_MIGRATION_ATTEMPTS) {
      console.warn(
        `[userData] migration failed ${breadcrumb.attempts} times (last: ${breadcrumb.lastError ?? "unknown"}); disabling auto-retry. Delete ${oldDir}/${MIGRATION_BREADCRUMB} to re-enable.`
      );
      return { action: "legacy", oldDir, newDir, stagingDir, reason: "too-many-failures" };
    }
    return { action: "migrate", oldDir, newDir, stagingDir };
  } catch (err) {
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
    // Defensive: index.ts only calls execute() for "migrate" plans. "none" is
    // a no-op; "legacy" is handled by the caller (path already pointed at
    // DMWork before the lock).
    return plan.action === "legacy" ? "skipped" : "done";
  }
  // action === "migrate"
  try {
    // P2-6 (execute side): re-assert the destination is not a real profile
    // immediately before deleting it — plan() may have run minutes ago.
    if (fs.existsSync(plan.newDir)) {
      if (hasProfileSentinel(plan.newDir)) {
        // P2-2: a skip is NOT a success — the caller must not relaunch onto
        // the non-ours destination; this session stays on the legacy path.
        runtime.log.warn(
          `[userData] ${plan.newDir} gained a real profile since planning; not migrating (both profiles kept).`
        );
        return "skipped";
      }
      fs.rmSync(plan.newDir, { recursive: true, force: true });
    }
    // Crash residue from an interrupted attempt: with the single-instance lock
    // as the mutex there is never a concurrent writer, so a leftover staging
    // dir is always stale — clear it.
    if (fs.existsSync(plan.stagingDir)) {
      fs.rmSync(plan.stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(plan.stagingDir);
    // F3 + P2-3: never copy singleton artifacts / locks; anchor the filter to
    // top-level entries (nested dirs are left alone), case-insensitive.
    fs.cpSync(plan.oldDir, plan.stagingDir, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(plan.oldDir, src);
        if (rel.includes(path.sep)) return true; // nested: never prune
        const lower = rel.toLowerCase();
        return !SKIP_DIRS.has(lower) && !ELECTRON_LOCK_FILES.has(lower);
      },
    });
    // F5: marker lands in staging BEFORE the rename, so profile+marker publish
    // as one atomic step (no fsync claimed; P1-2 guards torn publishes via the
    // sentinel check on the next launch).
    fs.writeFileSync(path.join(plan.stagingDir, MIGRATION_MARKER), new Date().toISOString());
    fs.renameSync(plan.stagingDir, plan.newDir);
    removeBreadcrumb(plan.oldDir);
    runtime.log.info(`[userData] migrated legacy DMWork profile to ${plan.newDir}`);
    return "done";
  } catch (err) {
    try {
      fs.rmSync(plan.stagingDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; the next launch retries anyway
    }
    writeBreadcrumb(plan.oldDir, err);
    runtime.log.error(
      "[userData] DMWork -> OCTO migration failed; keeping the legacy profile for this session (will retry on next launch):",
      err
    );
    return "failed";
  }
}
