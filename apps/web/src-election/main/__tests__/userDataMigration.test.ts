import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MIGRATION_ATTEMPTS,
  MIGRATION_BREADCRUMB,
  MIGRATION_MARKER,
  MIGRATION_NOTICES,
  actualBreadcrumbFile,
  cleanupStaleStaging,
  decideLockLostAction,
  executeUserDataMigration,
  isCopyableSource,
  planUserDataMigration,
  recordMigrationNotice,
  shouldShowMigrationNotice,
  type MigrationRuntime,
} from "../userDataMigration";

const BRAND = "OCTO";

describe("planUserDataMigration", () => {
  let appDataDir: string;

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-mig-test-"));
  });

  afterEach(() => {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });

  const makeLegacyProfile = (dir: string, extra: Record<string, string> = {}) => {
    const profile = path.join(dir, "DMWork");
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, "Preferences"), "{}");
    fs.writeFileSync(path.join(profile, "Local State"), "{}");
    fs.mkdirSync(path.join(profile, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001");
    for (const [name, content] of Object.entries(extra)) {
      fs.writeFileSync(path.join(profile, name), content);
    }
    return profile;
  };

  it("plans migration when a legacy profile exists and no marker is present", () => {
    makeLegacyProfile(appDataDir);
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");
    expect(plan.oldDir).toBe(path.join(appDataDir, "DMWork"));
    expect(plan.newDir).toBe(path.join(appDataDir, BRAND));
    expect(plan.stagingDir).toBe(path.join(appDataDir, `${BRAND}.migrating`));
  });

  it("plans none when there is no legacy profile", () => {
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
  });

  it("plans none when migration is complete (marker + residual data present)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), "{}");
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("re-migrates a torn publish: marker present over an EMPTY destination, legacy had data (P0-1)", () => {
    makeLegacyProfile(appDataDir); // has Preferences -> real data to carry
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    // Power loss between rename and any data flush: a bare marker with no
    // residual data must NOT be trusted when the legacy had data.
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("migrate");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("torn publish"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("trusts a marker whose destination lost Preferences but kept residual data (round-6 P1-1 scenario A)", () => {
    // The user deleted OCTO/Preferences to reset UI state. The profile still
    // holds Local Storage — re-migrating over it would destroy every byte
    // written since the migration. The marker + residual data must win.
    makeLegacyProfile(appDataDir); // legacy still has its sentinel
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(path.join(newDir, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(newDir, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001");
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("re-migrates a torn publish when the legacy holds IndexedDB but no sentinel (round-8 P1-2)", () => {
    // hasProfileSentinel (Preferences/Local State only) missed this legacy:
    // the copy filter copies IndexedDB, so a marker-only destination over it
    // would strand the message store. hasCopyableData uses the copy rule.
    const profile = path.join(appDataDir, "DMWork");
    fs.mkdirSync(path.join(profile, "IndexedDB"), { recursive: true });
    fs.writeFileSync(path.join(profile, "IndexedDB", "data"), "message-store-bytes");
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");
  });

  it("marker-only counts as migrated when the legacy holds ONLY non-copyable artifacts (round-8 P1-2)", () => {
    // Singleton artifacts are pruned by the copy filter, so a legacy with only
    // a stale lock has nothing to migrate — marker-only must plan "none" (no
    // relaunch loop), even though no Preferences/Local State exist either way.
    const profile = path.join(appDataDir, "DMWork");
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, "SingletonLock"), "hostname-pid");
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("keeps the legacy profile when the marker destination cannot be inspected (round-8 P2-3 tri-state)", () => {
    // Fail-closed: an unreadable destination is neither "complete" (none) nor
    // safely re-migratable — never start a session on an unverified OCTO dir.
    // Round-10 P2-6: the plan carries a distinct reason for the right dialog.
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementationOnce(() => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });
    try {
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("legacy");
      expect(plan.reason).toBe("destination-unreadable");
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it("round-trip invariant: a legacy with nothing copyable plans none — no useless marker-only migrate+relaunch (P0-1 / round-8 nit)", () => {
    // Legacy profile with ONLY regenerable caches: the copy would prune
    // everything, so migrating would publish nothing and loop forever. The
    // short-circuit (same hasCopyableData rule as the marker branch) plans
    // "none" directly, and a marker-only destination from a previous version
    // still plans "none" on the next launch (marker branch).
    const profile = path.join(appDataDir, "DMWork");
    fs.mkdirSync(path.join(profile, "Cache"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Cache", "data"), "x");

    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");

    // Legacy marker-only publish (e.g. produced by an older build): still none.
    const newDir = path.join(appDataDir, BRAND);
    const staging = path.join(appDataDir, `${BRAND}.migrating`);
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, MIGRATION_MARKER), new Date().toISOString());
    fs.renameSync(staging, newDir);

    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("an EMPTY legacy dir plans none (round-8 nit: nothing to copy)", () => {
    fs.mkdirSync(path.join(appDataDir, "DMWork"), { recursive: true });
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  // Round-10 P0-1: the boot-loop regression. Each of these top-level names is
  // "noise" — never copied, and cleanable at the destination. A legacy holding
  // ONLY such entries must plan "none"; previously .DS_Store etc. planned
  // "migrate" (hasCopyableData used a smaller prune set than the allowlist),
  // published a marker-only destination, and re-planned "migrate" forever
  // (relaunch loop, reproduced by the round-10 review harness).
  const NOISE_ONLY_ENTRIES: Array<[string, string]> = [
    [".DS_Store", "x"],
    ["Thumbs.db", "x"],
    ["desktop.ini", "x"],
    [".localized", "x"],
    ["Network Persistent State", "{}"],
    ["Dictionaries", "x"],
    ["Cache", "x"],
    ["Crashpad", "x"],
    ["SingletonLock", "x"],
    ["SingletonCookie", "x"],
    ["SingletonSocket", "x"],
    ["LockFile", "x"],
    ["Service Worker", "x"],
    [MIGRATION_BREADCRUMB, "{}"],
  ];
  it.each(NOISE_ONLY_ENTRIES)(
    "round-trip: a legacy holding only %s plans none — no boot loop (round-10 P0-1)",
    (name, content) => {
      const profile = path.join(appDataDir, "DMWork");
      fs.mkdirSync(path.join(profile, name), { recursive: true });
      fs.writeFileSync(path.join(profile, name, "data"), content);
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("none");
    }
  );

  it("mixed noise-only legacy (Cache + .DS_Store + Crashpad) plans none (round-10 P0-1)", () => {
    const profile = path.join(appDataDir, "DMWork");
    for (const name of ["Cache", ".DS_Store", "Crashpad"]) {
      fs.mkdirSync(path.join(profile, name), { recursive: true });
      fs.writeFileSync(path.join(profile, name, "data"), "x");
    }
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("a real profile beside noise still migrates, and the noise is NOT published (round-10 P0-1)", () => {
    makeLegacyProfile(appDataDir);
    const profile = path.join(appDataDir, "DMWork");
    fs.writeFileSync(path.join(profile, ".DS_Store"), "x");
    fs.writeFileSync(path.join(profile, "Dictionaries"), "dict");

    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");

    const result = executeUserDataMigration(plan, {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(result).toBe("done");
    const newDir = path.join(appDataDir, BRAND);
    expect(fs.existsSync(path.join(newDir, ".DS_Store"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "Dictionaries"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "Preferences"))).toBe(true);
    // Round-trip: next launch plans none (Preferences is residual data).
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("plans legacy (occupied) when the destination has a real profile without a marker — permanent, loud (round-6 P1-2)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), '{"account":"someone-else"}');
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const plan = planUserDataMigration(appDataDir, BRAND);
      // Stay on the established legacy profile; index.ts dialogs about both dirs.
      expect(plan.action).toBe("legacy");
      expect(plan.reason).toBe("destination-occupied");
      expect(planUserDataMigration(appDataDir, BRAND).action).toBe("legacy");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keeping both profiles"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("plans legacy (occupied) for a live profile inside Chromium's ~10 s sentinel blind spot (round-6 P1-1)", () => {
    // Measured on a real Electron 26 binary: Local Storage appears ~120 ms
    // after launch, Preferences only ~10 s later, Local State not at all on
    // some platforms. A sentinel-only probe would classify this as deletable.
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(path.join(newDir, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(newDir, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("legacy");
    expect(plan.reason).toBe("destination-occupied");
  });

  it("a destination with only regenerable/OS-metadata files does NOT block migration (allowlist polarity)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Dictionaries"), "dict");
    fs.writeFileSync(path.join(newDir, "Network Persistent State"), "{}");
    // Round-8 P2-2: OS/Finder metadata is noise, not user data.
    fs.writeFileSync(path.join(newDir, ".DS_Store"), "x");
    fs.writeFileSync(path.join(newDir, "Thumbs.db"), "x");
    fs.writeFileSync(path.join(newDir, "desktop.ini"), "x");
    fs.writeFileSync(path.join(newDir, ".localized"), "x");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");
  });

  it("a destination holding a live singleton lock is occupied, never deleted (round-8 P2-4)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    // ProcessSingleton artifacts can be a LIVE instance's fingerprint. We hold
    // the legacy lock, so a lock on the OCTO path is never ours — deleting it
    // could break the other instance's mutex.
    fs.writeFileSync(path.join(newDir, "SingletonLock"), "hostname-pid");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("legacy");
    expect(plan.reason).toBe("destination-occupied");
  });

  it("a destination with only a Crashpad dir is occupied (round-8 P2-4)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(path.join(newDir, "Crashpad"), { recursive: true });
    fs.writeFileSync(path.join(newDir, "Crashpad", "reports"), "x");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("legacy");
    expect(plan.reason).toBe("destination-occupied");
  });

  it("plans legacy (too-many-failures) when the breadcrumb budget is exhausted (P1-1)", () => {
    const profile = makeLegacyProfile(appDataDir);
    fs.writeFileSync(
      path.join(profile, MIGRATION_BREADCRUMB),
      JSON.stringify({ attempts: MAX_MIGRATION_ATTEMPTS, lastError: "ENOSPC", lastAttemptAt: "x" })
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("legacy");
      expect(plan.reason).toBe("too-many-failures");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("disabling auto-retry"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("migrates while the breadcrumb budget is not exhausted", () => {
    const profile = makeLegacyProfile(appDataDir);
    fs.writeFileSync(
      path.join(profile, MIGRATION_BREADCRUMB),
      JSON.stringify({ attempts: MAX_MIGRATION_ATTEMPTS - 1, lastError: "ENOSPC" })
    );
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("migrate");
  });

  it("retry bound reads the MAX of primary and fallback — a stale readable primary cannot shadow the newer fallback (round-10 P1-1)", () => {
    // Primary became readable-but-unwritable after the breadcrumb was written
    // there; the fallback holds the real (newer) count. Old logic (primary ??
    // fallback) would read 1 and keep retrying past the bound.
    const profile = makeLegacyProfile(appDataDir);
    fs.writeFileSync(
      path.join(profile, MIGRATION_BREADCRUMB),
      JSON.stringify({ attempts: 1, lastError: "stale" })
    );
    fs.writeFileSync(
      path.join(appDataDir, MIGRATION_BREADCRUMB),
      JSON.stringify({ attempts: MAX_MIGRATION_ATTEMPTS, lastError: "EACCES" })
    );
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("legacy");
    expect(plan.reason).toBe("too-many-failures");
  });

  it("plans none when the legacy path is a regular file, not a directory (P2-6)", () => {
    fs.writeFileSync(path.join(appDataDir, "DMWork"), "not-a-directory");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
  });

  it("plans none when the legacy path does not exist (ENOENT -> none, normal fresh install)", () => {
    const statSpy = vi.spyOn(fs, "statSync").mockImplementationOnce(() => {
      const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });
    try {
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("none");
    } finally {
      statSpy.mockRestore();
    }
  });

  it("plans legacy (not none) when the legacy path cannot be inspected for other reasons (P1-1 round-5)", () => {
    makeLegacyProfile(appDataDir);
    const statSpy = vi.spyOn(fs, "statSync").mockImplementationOnce(() => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // EACCES must NOT degrade to "none" (which would silently start a fresh
      // OCTO profile and strand DMWork forever via destination-occupied).
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("legacy");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("executeUserDataMigration", () => {
  let appDataDir: string;
  let runtime: MigrationRuntime;

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-mig-exec-"));
    runtime = {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  });

  afterEach(() => {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });

  const makeLegacyProfile = () => {
    const profile = path.join(appDataDir, "DMWork");
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, "Preferences"), '{"account":"user"}');
    fs.mkdirSync(path.join(profile, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001");
    fs.mkdirSync(path.join(profile, "Cache"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Cache", "data_0"), "cache-bytes");
    fs.mkdirSync(path.join(profile, "cache"), { recursive: true }); // case variant
    fs.writeFileSync(path.join(profile, "cache", "lower"), "cache-lower");
    fs.writeFileSync(path.join(profile, "IndexedDB"), "indexed-db-content");
    // A stale legacy instance's singleton artifacts must never leak (F3).
    fs.writeFileSync(path.join(profile, "SingletonLock"), "hostname-pid");
    fs.writeFileSync(path.join(profile, "SingletonCookie"), "cookie");
    fs.writeFileSync(path.join(profile, "SingletonSocket"), "socket");
    // Nested dirs whose names collide with the top-level skip sets must NOT
    // be pruned (P2-3: the filter is anchored to top-level entries).
    fs.mkdirSync(path.join(profile, "Partitions", "persist_octo", "Cache"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Partitions", "persist_octo", "Cache", "nested-cache"), "keep");
    fs.mkdirSync(path.join(profile, "Sync Data", "Cache"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Sync Data", "Cache", "keep-me"), "keep");
    return profile;
  };

  it("(a) migrates atomically, keeps source, writes marker, leaks no Singleton artifacts (F3), prunes top-level caches case-insensitively (P2-3), leaves the breadcrumb behind (round-5 P2)", () => {
    makeLegacyProfile();
    // Migration bookkeeping must stay behind (never copied).
    fs.writeFileSync(
      path.join(appDataDir, "DMWork", ".migration-failed.json"),
      JSON.stringify({ attempts: 2, lastError: "x" })
    );
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    const newDir = path.join(appDataDir, BRAND);
    expect(fs.existsSync(path.join(newDir, "Preferences"))).toBe(true);
    expect(fs.readFileSync(path.join(newDir, "Preferences"), "utf8")).toBe('{"account":"user"}');
    expect(fs.existsSync(path.join(newDir, "Local Storage", "leveldb", "CURRENT"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "SingletonLock"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "SingletonCookie"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "SingletonSocket"))).toBe(false);
    // Round-5 P2: the breadcrumb is migration bookkeeping, never copied.
    expect(fs.existsSync(path.join(newDir, ".migration-failed.json"))).toBe(false);
    // Top-level caches skipped, including the lowercase variant.
    expect(fs.existsSync(path.join(newDir, "Cache"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "cache"))).toBe(false);
    // P2-3: nested dirs named like caches are preserved.
    expect(fs.existsSync(path.join(newDir, "Partitions", "persist_octo", "Cache", "nested-cache"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "Sync Data", "Cache", "keep-me"))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("(b) fails, records a breadcrumb, and succeeds on retry (breadcrumb cleared on success, P1-1)", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);

    const renameSpy = vi
      .spyOn(fs, "renameSync")
      .mockImplementationOnce(() => {
        throw new Error("EPERM: operation not permitted (Windows EBUSY equivalent)");
      });

    const first = executeUserDataMigration(plan, runtime);
    renameSpy.mockRestore();

    expect(first).toBe("failed");
    expect(runtime.log.error).toHaveBeenCalledWith(
      expect.stringContaining("migration failed"),
      expect.anything()
    );
    // Breadcrumb recorded so the next launch can bound retries.
    const breadcrumb = JSON.parse(
      fs.readFileSync(path.join(appDataDir, "DMWork", MIGRATION_BREADCRUMB), "utf8")
    );
    expect(breadcrumb.attempts).toBe(1);
    expect(breadcrumb.lastError).toContain("EPERM");
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);

    const secondPlan = planUserDataMigration(appDataDir, BRAND);
    expect(secondPlan.action).toBe("migrate");
    const second = executeUserDataMigration(secondPlan, runtime);
    expect(second).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(true);
    // Success clears the breadcrumb.
    expect(fs.existsSync(path.join(appDataDir, "DMWork", MIGRATION_BREADCRUMB))).toBe(false);
  });

  it("records the attempt BEFORE the copy starts — ENOSPC-class failures still count toward the retry bound (round-10 P1-1)", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");

    const order: string[] = [];
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(p).endsWith(MIGRATION_BREADCRUMB)) order.push("breadcrumb");
      return (originalWriteFileSync as (p: fs.PathOrFileDescriptor, ...a: unknown[]) => unknown)(p, ...args);
    }) as never);
    const cpSpy = vi.spyOn(fs, "cpSync").mockImplementation(((..._args: unknown[]) => {
      order.push("cpSync");
      const err = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
      err.code = "ENOSPC";
      throw err;
    }) as never);

    const result = executeUserDataMigration(plan, runtime);
    writeSpy.mockRestore();
    cpSpy.mockRestore();

    expect(result).toBe("failed");
    // The attempt counter was bumped before the copy that then failed on a
    // full volume — the retry bound works for the failure mode it exists for.
    expect(order.indexOf("breadcrumb")).toBeLessThan(order.indexOf("cpSync"));
    const breadcrumb = JSON.parse(
      fs.readFileSync(path.join(appDataDir, "DMWork", MIGRATION_BREADCRUMB), "utf8")
    );
    expect(breadcrumb.attempts).toBe(1);
    expect(breadcrumb.lastError).toContain("ENOSPC");
  });

  it("falls back to the appData breadcrumb when the legacy dir is unwritable, and plan() reads it (round-6 P2-1)", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);

    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("EPERM: simulated rename failure");
    });
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      const target = String(p);
      if (target.endsWith(MIGRATION_BREADCRUMB) && target.includes(`${path.sep}DMWork${path.sep}`)) {
        throw new Error("EACCES: read-only legacy dir");
      }
      return (originalWriteFileSync as (p: fs.PathOrFileDescriptor, ...a: unknown[]) => unknown)(p, ...args);
    }) as never);

    const result = executeUserDataMigration(plan, runtime);
    renameSpy.mockRestore();
    writeSpy.mockRestore();

    expect(result).toBe("failed");
    // The retry bound must survive an unwritable legacy dir.
    expect(fs.existsSync(path.join(appDataDir, "DMWork", MIGRATION_BREADCRUMB))).toBe(false);
    const fallback = JSON.parse(fs.readFileSync(path.join(appDataDir, MIGRATION_BREADCRUMB), "utf8"));
    expect(fallback.attempts).toBe(1);
    // plan() reads the fallback location when bounding retries.
    fs.writeFileSync(
      path.join(appDataDir, MIGRATION_BREADCRUMB),
      JSON.stringify({ attempts: MAX_MIGRATION_ATTEMPTS, lastError: "EACCES" })
    );
    expect(planUserDataMigration(appDataDir, BRAND).reason).toBe("too-many-failures");
  });

  it("clears a stale staging dir from an interrupted attempt and retries", () => {
    makeLegacyProfile();
    const stale = path.join(appDataDir, `${BRAND}.migrating`);
    fs.mkdirSync(path.join(stale, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(stale, "Local Storage", "leveldb", "CURRENT"), "partial");

    const plan = planUserDataMigration(appDataDir, BRAND);
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it("refuses to clear a destination with singleton lock artifacts — skipped, lock files untouched (round-8 P2-4)", () => {
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "SingletonLock"), "hostname-pid");
    fs.writeFileSync(path.join(newDir, "SingletonCookie"), "cookie");
    fs.writeFileSync(path.join(newDir, "SingletonSocket"), "socket");

    const plan = planUserDataMigration(appDataDir, BRAND);
    plan.action = "migrate"; // force the execute-side re-check path
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("skipped");
    // The lock artifacts (possibly a live instance's) are never deleted.
    expect(fs.existsSync(path.join(newDir, "SingletonLock"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "SingletonCookie"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "SingletonSocket"))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);
  });

  it("clears a destination holding only OS metadata (round-8 P2-2)", () => {
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, ".DS_Store"), "x");

    const plan = planUserDataMigration(appDataDir, BRAND);
    plan.action = "migrate"; // force the execute-side re-check path
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(newDir, "Preferences"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, ".DS_Store"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(true);
  });

  it("a successful migration clears the one-shot notice bookkeeping (round-8 P2-7)", () => {
    makeLegacyProfile();
    // A previous session told the user about a paused migration.
    fs.writeFileSync(
      path.join(appDataDir, MIGRATION_NOTICES),
      JSON.stringify({ shown: ["retry-exhausted"] })
    );
    const plan = planUserDataMigration(appDataDir, BRAND);
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    // The "already shown" records are stale once the migration is done.
    expect(fs.existsSync(path.join(appDataDir, MIGRATION_NOTICES))).toBe(false);
  });

  it("returns skipped (not done) when the destination gained a real profile since planning", () => {
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), '{"account":"someone-else"}');

    // Drive execute() directly with a migrate plan to prove the re-check.
    const plan = planUserDataMigration(appDataDir, BRAND);
    plan.action = "migrate";
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("skipped");
    expect(runtime.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("unexpected entries")
    );
    expect(fs.readFileSync(path.join(newDir, "Preferences"), "utf8")).toBe('{"account":"someone-else"}');
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(false);
  });

  it("never deletes a destination that has data but no sentinel (round-6 P1-1 allowlist)", () => {
    // The fixture that fails under a sentinel denylist: Local Storage present,
    // Preferences absent (live profile inside Chromium's ~10 s blind spot, or
    // a first-run crash). execute() must refuse the delete.
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(path.join(newDir, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(newDir, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001");

    const plan = planUserDataMigration(appDataDir, BRAND);
    plan.action = "migrate"; // force the execute-side re-check path
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("skipped");
    expect(fs.existsSync(path.join(newDir, "Local Storage", "leveldb", "CURRENT"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(false);
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);
  });

  it("a marker-write failure fails the migration BEFORE the rename publishes anything (F5)", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(p).endsWith(MIGRATION_MARKER)) {
        throw new Error("ENOSPC: simulated marker write failure");
      }
      return (originalWriteFileSync as (p: fs.PathOrFileDescriptor, ...a: unknown[]) => unknown)(p, ...args);
    }) as never);

    const result = executeUserDataMigration(plan, runtime);
    writeSpy.mockRestore();

    expect(result).toBe("failed");
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
    expect(fs.existsSync(plan.stagingDir)).toBe(false);
  });

  it("never throws: an execution-phase I/O failure degrades to failed (P0-2)", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementationOnce(() => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });

    const result = executeUserDataMigration(plan, runtime);
    mkdirSpy.mockRestore();

    expect(result).toBe("failed");
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
  });

  it("no-op for a none plan", () => {
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
    expect(executeUserDataMigration(plan, runtime)).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
  });
});

describe("migration notices", () => {
  let appDataDir: string;

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-mig-notice-"));
  });

  afterEach(() => {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });

  it("one-shot per key: a recorded notice suppresses only its own key (round-6 P2)", () => {
    expect(shouldShowMigrationNotice(appDataDir, "retry-exhausted")).toBe(true);
    recordMigrationNotice(appDataDir, "retry-exhausted");
    expect(shouldShowMigrationNotice(appDataDir, "retry-exhausted")).toBe(false);
    expect(shouldShowMigrationNotice(appDataDir, "destination-occupied")).toBe(true);
    // Recording is idempotent.
    recordMigrationNotice(appDataDir, "retry-exhausted");
    expect(shouldShowMigrationNotice(appDataDir, "retry-exhausted")).toBe(false);
  });
});

describe("decideLockLostAction", () => {
  const plan = (action: "migrate" | "legacy" | "none") =>
    ({
      action,
      oldDir: path.join("C:", "appData", "DMWork"),
      newDir: path.join("C:", "appData", "OCTO"),
      stagingDir: path.join("C:", "appData", ".octo-migrate-staging"),
    }) as const;

  it("migrate plan: the losing process says so before quitting (dialog-then-quit)", () => {
    expect(decideLockLostAction(plan("migrate"))).toBe("dialog-then-quit");
  });

  it("legacy plan: ordinary second-instance flow, quit silently", () => {
    expect(decideLockLostAction(plan("legacy"))).toBe("quit-now");
  });

  it("none plan: steady state, quit silently", () => {
    expect(decideLockLostAction(plan("none"))).toBe("quit-now");
  });
});

describe("actualBreadcrumbFile", () => {
  let appDataDir: string;

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-mig-bc-"));
    fs.mkdirSync(path.join(appDataDir, "DMWork"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });

  it("points at the primary when it exists (round-8 P2-1)", () => {
    const primary = path.join(appDataDir, "DMWork", MIGRATION_BREADCRUMB);
    fs.writeFileSync(primary, "{}");
    expect(actualBreadcrumbFile(path.join(appDataDir, "DMWork"))).toBe(primary);
  });

  it("points at the appData fallback when the legacy dir was unwritable (round-8 P2-1)", () => {
    // Fallback only (as after a failed write with a read-only legacy dir) —
    // the retry-exhausted dialog must name THIS file, not a non-existent one.
    const fallback = path.join(appDataDir, MIGRATION_BREADCRUMB);
    fs.writeFileSync(fallback, "{}");
    expect(actualBreadcrumbFile(path.join(appDataDir, "DMWork"))).toBe(fallback);
  });

  it("falls back to the primary path when nothing exists yet", () => {
    expect(actualBreadcrumbFile(path.join(appDataDir, "DMWork"))).toBe(
      path.join(appDataDir, "DMWork", MIGRATION_BREADCRUMB)
    );
  });
});

describe("cleanupStaleStaging", () => {
  let appDataDir: string;

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-mig-stage-"));
  });

  afterEach(() => {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });

  it("removes a leftover staging dir holding copied credentials (round-10 P2-1)", () => {
    const staging = path.join(appDataDir, `${BRAND}.migrating`);
    fs.mkdirSync(path.join(staging, "Cookies"), { recursive: true });
    fs.writeFileSync(path.join(staging, "Cookies", "data"), "creds");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      cleanupStaleStaging(staging);
      expect(fs.existsSync(staging)).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("is a no-op when no staging dir exists", () => {
    cleanupStaleStaging(path.join(appDataDir, `${BRAND}.migrating`));
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
  });
});

describe("isCopyableSource", () => {
  const stat = (o: { fifo?: boolean; socket?: boolean }) => ({
    isFIFO: () => !!o.fifo,
    isSocket: () => !!o.socket,
  });

  it("prunes top-level noise (round-10 P0-1)", () => {
    expect(isCopyableSource(".DS_Store", stat({}))).toBe(false);
    expect(isCopyableSource("Cache", stat({}))).toBe(false);
    expect(isCopyableSource("SingletonLock", stat({}))).toBe(false);
    expect(isCopyableSource("Preferences", stat({}))).toBe(true);
    expect(isCopyableSource("IndexedDB", stat({}))).toBe(true);
  });

  it("keeps nested entries even when their name matches noise (round-4 P2-3)", () => {
    expect(isCopyableSource(path.join("Partitions", "persist", "Cache"), stat({}))).toBe(true);
  });

  it("skips FIFOs and sockets at any depth (round-10 P2-3)", () => {
    expect(isCopyableSource("fifo", stat({ fifo: true }))).toBe(false);
    expect(isCopyableSource(path.join("a", "b", "sock"), stat({ socket: true }))).toBe(false);
    expect(isCopyableSource(path.join("a", "b", "file"), stat({}))).toBe(true);
  });
});
