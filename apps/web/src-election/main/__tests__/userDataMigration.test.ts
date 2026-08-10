import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MIGRATION_ATTEMPTS,
  MIGRATION_BREADCRUMB,
  MIGRATION_MARKER,
  executeUserDataMigration,
  planUserDataMigration,
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

  it("plans none when migration is complete (marker + profile sentinel present)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), "{}");
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("re-migrates a torn publish: marker present but no profile sentinel (P1-2)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    // Power loss between rename and any data flush: a bare marker with no
    // real profile files must NOT be trusted.
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("migrate");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no profile sentinel"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("plans none (occupied) when the destination has a real profile without a marker — permanent, loud (P2-1)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), '{"account":"someone-else"}');
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("none");
      expect(plan.reason).toBe("destination-occupied");
      expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keeping both profiles"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a destination with only lock/crash files does NOT block migration (P2-1 polarity)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "SingletonLock"), "");
    fs.mkdirSync(path.join(newDir, "Crashpad"), { recursive: true });
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");
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

  it("plans none when the legacy path is a regular file, not a directory (P2-6)", () => {
    fs.writeFileSync(path.join(appDataDir, "DMWork"), "not-a-directory");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
  });

  it("never throws: an unstatable legacy path degrades to none, not an exception (P0-2)", () => {
    makeLegacyProfile(appDataDir);
    const statSpy = vi.spyOn(fs, "statSync").mockImplementationOnce(() => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });
    try {
      // Cannot stat the legacy path -> treated as "no legacy profile":
      // no exception escapes plan() (the internal guard swallows it).
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("none");
    } finally {
      statSpy.mockRestore();
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

  it("(a) migrates atomically, keeps source, writes marker, leaks no Singleton artifacts (F3), prunes top-level caches case-insensitively (P2-3)", () => {
    makeLegacyProfile();
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

  it("clears a destination with only lock files before the rename lands", () => {
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "SingletonLock"), "");
    fs.writeFileSync(path.join(newDir, "SingletonCookie"), "");
    fs.writeFileSync(path.join(newDir, "SingletonSocket"), "");

    const plan = planUserDataMigration(appDataDir, BRAND);
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(newDir, "Preferences"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "SingletonLock"))).toBe(false);
  });

  it("returns skipped (not done) when the destination gained a real profile since planning (P2-2/P2-6)", () => {
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
      expect.stringContaining("gained a real profile")
    );
    expect(fs.readFileSync(path.join(newDir, "Preferences"), "utf8")).toBe('{"account":"someone-else"}');
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(false);
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
