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
// Design (round 6 — per review):
// - Mutual exclusion comes from Electron's OWN single-instance lock. index.ts
//   points userData at the legacy dir BEFORE requestSingleInstanceLock(), so
//   the lock is taken on the legacy path (the primary-instance lookup keys off
//   the userData path): a running legacy instance or a concurrent launch fails
//   the lock and quits. On success index.ts relaunches so the next process
//   takes the OCTO lock. The second-instance dialog is gated to action
//   "migrate" only (round-6 P2-3): a lock failure on any other plan is the
//   ordinary focus-the-running-instance flow.
// - Staging copy + atomic rename: copy into <appData>/OCTO.migrating, then
//   renameSync into place. The legacy PROFILE DATA is never mutated — the only
//   write into <appData>/DMWork is the failure breadcrumb dotfile, which falls
//   back to <appData> itself when the legacy dir is unwritable (round-6 P2-1)
//   — so a failed attempt retries on the next launch and a release rollback
//   keeps the legacy profile.
// - Destination safety is an ALLOWLIST, not a sentinel probe (round-6 P1-1):
//   the destination is deleted only when EVERY top-level entry is known
//   cleanable (singleton locks, regenerable caches, the marker itself);
//   anything unrecognized counts as occupied data and blocks the migration.
//   Measured on a real Electron 26 binary: Chromium writes Preferences up to
//   ~10 s after launch and "Local State" not at all on some platforms, so a
//   sentinel-only probe has a false-negative window on live profiles (it
//   would rmSync a profile that already holds Local Storage / IndexedDB).
//   The allowlist has no such window: an unknown entry is never deleted.
// - Completion marker + residual data: a migration is "complete" when the
//   marker coexists with residual destination data, OR when the legacy profile
//   has nothing copyable left (regenerable caches / singleton artifacts only —
//   re-copying would publish nothing and loop forever). "Nothing copyable" is
//   judged with the SAME rule as the copy filter (round-8 P1-2): a legacy
//   holding only IndexedDB / Local Storage / Cookies still carries real data
//   and a bare marker over it is torn, re-migrated. A bare marker over an
//   EMPTY destination with a data-bearing legacy is torn and re-migrated. The
//   marker is written into the staging dir BEFORE the rename so profile+marker
//   publish atomically. A marker-bearing destination that later loses
//   Preferences (e.g. a user reset) is trusted via its residual data and NEVER
//   re-migrated over (round-6 P1-1, failure scenario A).
// - Occupied destination (round-6 P1-2): plan() returns action "legacy" with
//   reason "destination-occupied"; the session stays on the established DMWork
//   profile and index.ts surfaces a one-shot dialog naming both directories.
// - Failure containment and visibility: every I/O in plan()/execute() is
//   inside try/catch ("never throws"); plan distinguishes ENOENT (none, fresh
//   install) from other stat errors (legacy — never silently start a fresh
//   OCTO next to an unreachable DMWork, round-5 P1-1); failures are bounded by
//   a breadcrumb (attempts+lastError, cleared on success) and surfaced via
//   dialogs from index.ts — all deferred behind app.whenReady() so they also
//   render on Linux (round-6 P2-2), bilingual via app.getLocale().
// - Copy filter anchored to top-level entries, case-insensitive; the
//   breadcrumb is never copied (round-5 P2).
// ---------------------------------------------------------------------------

export const LEGACY_USER_DATA_DIR = "DMWork";
export const MIGRATION_MARKER = ".migrated-from-dmwork";
export const MIGRATION_BREADCRUMB = ".migration-failed.json";
// One-shot dialog bookkeeping lives beside the staging dir (appData), so it
// works even when the legacy profile dir is unwritable.
export const MIGRATION_NOTICES = ".octo-migration-notices.json";
export const MAX_MIGRATION_ATTEMPTS = 3;

// A "real profile" is recognized by Chromium's userData layout; the copy
// filter (see execute()) prunes regenerable caches and singleton artifacts,
// so "does this dir carry data the migration would actually copy" is the rule
// used for the legacy side of the completion check (round-8 P1-2).
const ELECTRON_LOCK_FILES = new Set([
  "singletonlock",
  "singletoncookie",
  "singletonsocket",
  "lockfile",
]);

// Regenerable Chromium caches / crash artifacts, intentionally not migrated
// (top-level only, matched case-insensitively). Stored lower-case.
// Reviewed (round-8): Service Worker/ and blob_storage are safe to prune —
// the renderer has no caches.open/match or serviceWorker.register call sites
// anywhere in apps/web or packages (the only SW shipped is the MSW test
// harness). If a future Cache Storage feature lands, revisit this entry.
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

// Round-10 P0-1: ONE classification for "never migrates", shared by every
// consumer so they can never disagree:
//   - the copy filter (what gets published to the destination),
//   - hasCopyableData (does the legacy still hold anything worth publishing),
//   - DESTINATION_CLEANABLE (is a destination entry ours to delete).
// Previously the first two used SKIP_DIRS+LOCKS+breadcrumb while the allowlist
// ALSO listed dictionaries / network persistent state / OS metadata — a legacy
// holding only e.g. .DS_Store planned "migrate", published it, and re-planned
// "migrate" forever (relaunch boot loop, reproduced by round-10 review).
const MIGRATION_NOISE = (() => {
  const set = new Set<string>();
  ELECTRON_LOCK_FILES.forEach((e) => set.add(e));
  SKIP_DIRS.forEach((e) => set.add(e));
  set.add(MIGRATION_BREADCRUMB);
  // Regenerable, not user data (round-6 allowlist members): spelling
  // dictionaries re-downloaded by Chromium; network-stack state.
  set.add("dictionaries");
  set.add("network persistent state");
  // Round-8 P2-2 OS/Finder metadata. Leading dot matters:
  // `.DS_Store`.toLowerCase() === ".ds_store".
  set.add(".ds_store");
  set.add("thumbs.db");
  set.add("desktop.ini");
  set.add(".localized");
  return set;
})();

// Round-6 P1-1: the destination-decision ALLOWLIST. Deleting the destination
// is permitted only when every top-level entry is one of these; anything else
// is user data we do not own and must never be deleted.
// Round-8 P2-4: ProcessSingleton artifacts (SingletonLock/SingletonCookie/
// SingletonSocket) and Crashpad are NOT cleanable — a lock on the OCTO path
// can never be ours (we hold the legacy lock), so a live instance's lock files
// are treated as occupied and block the delete. Crashpad is excluded with them
// (a crash-reporting process may still hold it).
const DESTINATION_CLEANABLE = (() => {
  const set = new Set<string>();
  MIGRATION_NOISE.forEach((e) => {
    if (
      e !== "singletonlock" &&
      e !== "singletoncookie" &&
      e !== "singletonsocket" &&
      e !== "crashpad"
    ) {
      set.add(e);
    }
  });
  set.add(MIGRATION_MARKER);
  return set;
})();

// Top-level entries of `dir` that are NOT known-cleanable, tri-state
// (round-8 P2-3): { unreadable: true } means the dir cannot be inspected and
// must be treated as occupied — never mistaken for empty. Fail-closed.
type ResidualEntries = { unreadable: boolean; entries: string[] };
function residualEntries(dir: string): ResidualEntries {
  try {
    return {
      unreadable: false,
      entries: fs
        .readdirSync(dir)
        .filter((entry) => !DESTINATION_CLEANABLE.has(entry.toLowerCase())),
    };
  } catch {
    return { unreadable: true, entries: [] };
  }
}

// Does `dir` carry any data the migration would actually copy? Same rule as
// the copy filter — MIGRATION_NOISE (round-10 P0-1: one classification for
// "never migrates", so this predicate and the publish step can never
// disagree). Fail-closed: an unreadable dir reports copyable data — a
// marker-only completion must never strand a legacy profile that still holds
// IndexedDB / Local Storage / Cookies.
function hasCopyableData(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((entry) => !MIGRATION_NOISE.has(entry.toLowerCase()));
  } catch {
    return true;
  }
}

export type MigrationPlan = {
  action: "migrate" | "legacy" | "none";
  oldDir: string;
  newDir: string;
  stagingDir: string;
  reason?: "destination-occupied" | "too-many-failures" | "destination-unreadable";
};

export type LockLostAction = "quit-now" | "dialog-then-quit";

/**
 * What should a process that LOST the single-instance lock do?
 *
 * The lock is taken on the legacy path whenever a migration is planned, so a
 * lock failure means another instance already holds that path:
 * - "migrate" plan -> a migration-relevant conflict (the other instance may be
 *   migrating right now): say so, then quit.
 * - anything else   -> the ordinary second-instance flow (the running instance
 *   focuses itself): quit silently.
 *
 * The caller must also guarantee that a losing process never runs normal
 * startup — the quit has to happen before any window is created, or a second
 * process briefly opens on the same profile (round-7 review).
 */
export function decideLockLostAction(plan: MigrationPlan): LockLostAction {
  return plan.action === "migrate" ? "dialog-then-quit" : "quit-now";
}

export type MigrationResult = "done" | "failed" | "skipped";

export type MigrationRuntime = {
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string, err: unknown): void;
  };
};

// The breadcrumb lives in the legacy dir; when that dir is unwritable
// (read-only / full volume) it falls back to appData — otherwise a write
// failure would silently disable the retry bound (round-6 P2-1).
function breadcrumbPaths(oldDir: string): [string, string] {
  return [
    path.join(oldDir, MIGRATION_BREADCRUMB),
    path.join(path.dirname(oldDir), MIGRATION_BREADCRUMB),
  ];
}

function readBreadcrumbFile(
  file: string
): { attempts: number; lastError?: string; lastAttemptAt?: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof raw?.attempts === "number" ? raw : null;
  } catch {
    return null;
  }
}

function readBreadcrumb(
  oldDir: string
): { attempts: number; lastError?: string; lastAttemptAt?: string } | null {
  const [primary, fallback] = breadcrumbPaths(oldDir);
  const p = readBreadcrumbFile(primary);
  const f = readBreadcrumbFile(fallback);
  if (!p) return f;
  if (!f) return p;
  // Round-10 P1-1: a stale-but-readable primary (e.g. legacy dir became
  // read-only after the breadcrumb was written there) must not shadow the
  // newer fallback — take the max so the retry bound can never regress.
  return p.attempts >= f.attempts ? p : f;
}

// Round-8 P2-1: the retry-exhausted dialog must point the user at the file
// that actually exists — the breadcrumb may have fallen back to appData when
// the legacy dir is unwritable (round-6 P2-1).
export function actualBreadcrumbFile(oldDir: string): string {
  const [primary, fallback] = breadcrumbPaths(oldDir);
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(fallback)) return fallback;
  return primary; // nothing recorded yet; the primary is where it would land
}

// Bump the attempt counter (and optionally refresh lastError). Round-10 P1-1:
// execute() records the attempt BEFORE the copy starts — the failure modes
// this bound exists for (ENOSPC and friends) can also make a post-failure
// write fail, which would silently disable the retry bound.
function bumpBreadcrumb(oldDir: string, err?: unknown): void {
  const prev = readBreadcrumb(oldDir) ?? { attempts: 0 };
  const payload = JSON.stringify({
    attempts: prev.attempts + 1,
    lastError: err ? (err instanceof Error ? err.message : String(err)) : prev.lastError,
    lastAttemptAt: new Date().toISOString(),
  });
  for (const file of breadcrumbPaths(oldDir)) {
    try {
      fs.writeFileSync(file, payload);
      return;
    } catch {
      // try the next location; never throw from the failure path
    }
  }
}

// Round-10 P1-1: after a failed attempt, annotate the already-bumped record
// with the failure detail WITHOUT incrementing again. No-op when even the
// pre-copy bump could not be written (volume completely full).
function annotateBreadcrumb(oldDir: string, err: unknown): void {
  const prev = readBreadcrumb(oldDir);
  if (!prev) return;
  const payload = JSON.stringify({
    ...prev,
    lastError: err instanceof Error ? err.message : String(err),
    lastAttemptAt: new Date().toISOString(),
  });
  for (const file of breadcrumbPaths(oldDir)) {
    try {
      fs.writeFileSync(file, payload);
      return;
    } catch {
      // try the next location; never throw from the failure path
    }
  }
}

function removeBreadcrumb(oldDir: string): void {
  for (const file of breadcrumbPaths(oldDir)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // best-effort
    }
  }
  // Round-8 P2-7: a successful migration also clears the one-shot notice
  // bookkeeping — the "already shown" records are stale once the migration is
  // done (the dialogs they gate can never fire again).
  try {
    fs.rmSync(path.join(path.dirname(oldDir), MIGRATION_NOTICES), { force: true });
  } catch {
    // best-effort
  }
}

// One-shot dialog bookkeeping (round-6 P2: stop nagging on every launch once
// the user has been told). Best-effort; a read/write failure degrades to
// "show it again", never to a crash.
export function shouldShowMigrationNotice(appDataDir: string, key: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(appDataDir, MIGRATION_NOTICES), "utf8"));
    return !Array.isArray(raw?.shown) || !raw.shown.includes(key);
  } catch {
    return true;
  }
}

export function recordMigrationNotice(appDataDir: string, key: string): void {
  try {
    let shown: string[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(appDataDir, MIGRATION_NOTICES), "utf8"));
      if (Array.isArray(raw?.shown)) shown = raw.shown;
    } catch {
      // first notice
    }
    if (!shown.includes(key)) shown.push(key);
    fs.writeFileSync(path.join(appDataDir, MIGRATION_NOTICES), JSON.stringify({ shown }));
  } catch {
    // best-effort
  }
}

export function planUserDataMigration(
  appDataDir: string,
  brandName: string,
  log: MigrationRuntime["log"] = console
): MigrationPlan {
  const oldDir = path.join(appDataDir, LEGACY_USER_DATA_DIR);
  const newDir = path.join(appDataDir, brandName);
  const stagingDir = `${newDir}.migrating`;
  try {
    // P1-2 (round-5): distinguish "no legacy profile" (ENOENT -> none, the
    // normal fresh-install path) from "cannot inspect" (other errors ->
    // legacy, never silently start a fresh OCTO profile next to an
    // unreachable DMWork one).
    let oldIsDir = false;
    try {
      oldIsDir = fs.statSync(oldDir).isDirectory();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { action: "none", oldDir, newDir, stagingDir };
      }
      log.error(
        `[userData] cannot inspect ${oldDir} (${(err as NodeJS.ErrnoException).code ?? err}); using the legacy profile this session.`,
        err
      );
      return { action: "legacy", oldDir, newDir, stagingDir };
    }
    if (!oldIsDir) {
      // A regular file is not a profile (P2-6, round-4).
      return { action: "none", oldDir, newDir, stagingDir };
    }
    // The round-trip invariant is "execute() === 'done' implies the NEXT
    // plan() returns 'none'". A marker is trusted whenever the destination
    // carries residual data (a live profile grew after the publish — e.g. the
    // user deleted Preferences to reset UI state; re-migrating would destroy
    // every byte written since, round-6 P1-1 scenario A), or when the legacy
    // profile has nothing copyable left (regenerable caches / singleton
    // artifacts only — re-copying would publish nothing and loop forever;
    // judged by the copy filter's own rule, round-8 P1-2). Only a bare marker
    // over an EMPTY destination with a data-bearing legacy is torn and
    // re-migrated. A destination that cannot be inspected is never assumed
    // complete — stay on the legacy profile (round-8 P2-3 tri-state).
    if (fs.existsSync(path.join(newDir, MIGRATION_MARKER))) {
      const residual = residualEntries(newDir);
      if (residual.unreadable) {
        log.warn(
          `[userData] ${newDir} holds a migration marker but cannot be inspected; keeping the legacy profile this session.`
        );
        // Round-10 P2-6: distinct reason so index.ts shows the right copy
        // instead of the generic "plan failed" text.
        return {
          action: "legacy",
          oldDir,
          newDir,
          stagingDir,
          reason: "destination-unreadable",
        };
      }
      if (residual.entries.length > 0 || !hasCopyableData(oldDir)) {
        return { action: "none", oldDir, newDir, stagingDir };
      }
      log.warn(
        `[userData] ${newDir} has a migration marker but no residual data (torn publish?); re-migrating.`
      );
    }
    // Round-6 P1-1/P1-2: a destination holding ANY entry that is not
    // known-cleanable is occupied by data we do not own. Stay on the
    // established legacy profile and let index.ts say so (reason consumed
    // there). A sentinel probe alone would miss a live profile in its first
    // ~10 s (Local Storage present, Preferences not written yet). An
    // unreadable destination is occupied, never deletable (round-8 P2-3).
    if (fs.existsSync(newDir)) {
      const residual = residualEntries(newDir);
      if (residual.unreadable || residual.entries.length > 0) {
        log.warn(
          `[userData] ${newDir} already holds data without a migration marker (entries: ${residual.unreadable ? "<unreadable>" : residual.entries.join(", ")}); keeping both profiles and NOT migrating (legacy data stays in ${oldDir}).`
        );
        return {
          action: "legacy",
          oldDir,
          newDir,
          stagingDir,
          // Round-10 P2-6: an uninspectable destination is not "occupied by
          // known data" — distinct reason for the right dialog copy.
          reason: residual.unreadable ? "destination-unreadable" : "destination-occupied",
        };
      }
    }
    // P1-1: bound retries — after N consecutive failures the migration stops
    // auto-retrying and the session runs on the legacy profile (index.ts
    // surfaces a dialog). Deleting ${oldDir}/${MIGRATION_BREADCRUMB} re-enables.
    const breadcrumb = readBreadcrumb(oldDir);
    if (breadcrumb && breadcrumb.attempts >= MAX_MIGRATION_ATTEMPTS) {
      log.warn(
        `[userData] migration failed ${breadcrumb.attempts} times (last: ${breadcrumb.lastError ?? "unknown"}); disabling auto-retry. Delete ${actualBreadcrumbFile(oldDir)} to re-enable.`
      );
      return { action: "legacy", oldDir, newDir, stagingDir, reason: "too-many-failures" };
    }
    // Round-8 nit (P2-1 review): a legacy profile holding NOTHING the copy
    // would publish (empty dir, or caches/singleton artifacts only) plans
    // "none" instead of a marker-only migrate+relaunch that accomplishes
    // nothing visible. Same rule as the marker branch above (hasCopyableData).
    if (!hasCopyableData(oldDir)) {
      log.warn(
        `[userData] ${oldDir} holds nothing the migration would copy; skipping (no marker published).`
      );
      return { action: "none", oldDir, newDir, stagingDir };
    }
    return { action: "migrate", oldDir, newDir, stagingDir };
  } catch (err) {
    log.error(
      `[userData] planUserDataMigration failed; using the legacy profile this session (will retry on next launch):`,
      err
    );
    return { action: "legacy", oldDir, newDir, stagingDir };
  }
}

// Round-10 P2-3: special files (FIFOs/sockets) make cpSync abort the whole
// migration with ERR_FS_CP_FIFO_PIPE; they are never profile data. Pure so it
// is testable. `rel` is the path relative to the legacy root ("" never used).
export function isCopyableSource(
  rel: string,
  stat: { isFIFO(): boolean; isSocket(): boolean }
): boolean {
  if (!rel.includes(path.sep) && MIGRATION_NOISE.has(rel.toLowerCase())) return false;
  return !stat.isFIFO() && !stat.isSocket();
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
    // Round-10 P1-1: record the attempt BEFORE any copy/rename I/O — the
    // failure modes this bound exists for (ENOSPC etc.) can also make the
    // post-failure write fail, silently disabling MAX_MIGRATION_ATTEMPTS.
    // Success clears it via removeBreadcrumb below.
    bumpBreadcrumb(plan.oldDir);
    // Round-6 P1-1: re-assert the destination is cleanable immediately before
    // deleting it — plan() may have run minutes ago. Polarity is an allowlist:
    // delete only if every top-level entry is known-cleanable; any unknown
    // entry (even without Preferences/Local State) is treated as occupied and
    // never deleted.
    if (fs.existsSync(plan.newDir)) {
      const residual = residualEntries(plan.newDir);
      if (residual.unreadable || residual.entries.length > 0) {
        // A skip is NOT a success — the caller must not relaunch onto the
        // non-ours destination; this session stays on the legacy path.
        runtime.log.warn(
          `[userData] ${plan.newDir} holds unexpected entries (${residual.unreadable ? "<unreadable>" : residual.entries.join(", ")}); not migrating (both profiles kept).`
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
    fs.mkdirSync(plan.stagingDir, { mode: 0o700 });
    // F3 + P2-3: never copy singleton artifacts / locks; anchor the filter to
    // top-level entries (nested dirs are left alone), case-insensitive. The
    // breadcrumb is migration bookkeeping, never copied (round-5 P2). Noise
    // classification is MIGRATION_NOISE (round-10 P0-1, shared with
    // hasCopyableData / DESTINATION_CLEANABLE).
    fs.cpSync(plan.oldDir, plan.stagingDir, {
      recursive: true,
      preserveTimestamps: true,
      filter: (src) => {
        let st: fs.Stats;
        try {
          st = fs.lstatSync(src);
        } catch {
          return true; // vanished mid-copy; let cpSync report it
        }
        return isCopyableSource(path.relative(plan.oldDir, src), st);
      },
    });
    // F5: marker lands in staging BEFORE the rename, so profile+marker publish
    // as one atomic step (no fsync claimed; the marker+residual completion
    // rule guards torn publishes on the next launch).
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
    // Round-10 P1-1: the attempt count was bumped up-front; only annotate the
    // failure detail here (no double increment).
    annotateBreadcrumb(plan.oldDir, err);
    runtime.log.error(
      "[userData] DMWork -> OCTO migration failed; keeping the legacy profile for this session (will retry on next launch):",
      err
    );
    return "failed";
  }
}

// Round-10 P2-1: a leftover staging dir can hold credentials (Cookies /
// IndexedDB were copied into it) until the publish. execute() cleans its own
// staging, but none/legacy sessions never run execute — so the lock winner in
// index.ts calls this on every startup. Single-instance-lock scoped: there is
// never a concurrent writer.
export function cleanupStaleStaging(
  stagingDir: string,
  log: MigrationRuntime["log"] = console
): void {
  try {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      log.warn(`[userData] removed stale staging dir ${stagingDir}`);
    }
  } catch (err) {
    log.warn(
      `[userData] could not remove stale staging dir ${stagingDir}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
