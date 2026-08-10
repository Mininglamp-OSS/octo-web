import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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

  it("plans none when migration is already complete (marker exists) — even if <newDir> exists from startup", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "SingletonLock"), "");
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
  });

  it("plans none when the destination already holds real data without a marker, permanently (F6)", () => {
    makeLegacyProfile(appDataDir);
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), '{"account":"someone-else"}');
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
      expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
      // The skip is surfaced loudly (P2-1).
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keeping both profiles"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("never throws: a plan-time I/O failure degrades to legacy, not an exception (P0-2)", () => {
    makeLegacyProfile(appDataDir);
    // Make the destination inspection reachable (plan reads <newDir> only
    // when it exists), then force that read to fail (e.g. unreadable dir).
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementationOnce(() => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const plan = planUserDataMigration(appDataDir, BRAND);
      expect(plan.action).toBe("legacy");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("planUserDataMigration failed"),
        expect.anything()
      );
    } finally {
      readdirSpy.mockRestore();
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
    fs.writeFileSync(path.join(profile, "IndexedDB"), "indexed-db-content");
    // A stale legacy instance's singleton artifacts must never leak into the
    // new profile (F3).
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

  it("(a) migrates atomically via staging, keeps the source, writes the marker, leaks no Singleton artifacts (F3), prunes only top-level caches (P2-3)", () => {
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
    // F3: singleton artifacts are not copied.
    expect(fs.existsSync(path.join(newDir, "SingletonLock"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "SingletonCookie"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "SingletonSocket"))).toBe(false);
    // Top-level regenerable caches skipped.
    expect(fs.existsSync(path.join(newDir, "Cache"))).toBe(false);
    // P2-3: nested dirs named like caches are preserved.
    expect(fs.existsSync(path.join(newDir, "Partitions", "persist_octo", "Cache", "nested-cache"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "Sync Data", "Cache", "keep-me"))).toBe(true);
    // No staging residue.
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
    // Source kept (rollback safety / retryability).
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);
    // Second launch: marker present -> no-op.
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("(b) fails and keeps the legacy profile when the rename fails, then succeeds on retry", () => {
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
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);

    const secondPlan = planUserDataMigration(appDataDir, BRAND);
    expect(secondPlan.action).toBe("migrate");
    const second = executeUserDataMigration(secondPlan, runtime);
    expect(second).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(true);
  });

  it("clears a stale staging dir from an interrupted previous attempt and retries", () => {
    makeLegacyProfile();
    const stale = path.join(appDataDir, `${BRAND}.migrating`);
    fs.mkdirSync(path.join(stale, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(stale, "Local Storage", "leveldb", "CURRENT"), "partial");

    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it("clears a destination that contains only lock files before the rename lands", () => {
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "SingletonLock"), "");
    fs.writeFileSync(path.join(newDir, "SingletonCookie"), "");
    fs.writeFileSync(path.join(newDir, "SingletonSocket"), "");

    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(newDir, "Preferences"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(newDir, "SingletonLock"))).toBe(false);
  });

  it("re-asserts the lock-only invariant before deleting the destination (P2-6)", () => {
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), '{"account":"someone-else"}');

    // plan() would return "none" for this state; drive execute() directly to
    // prove the re-check protects against the plan→execute gap.
    const plan = planUserDataMigration(appDataDir, BRAND);
    plan.action = "migrate";
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(runtime.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("gained non-lock data")
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
    expect(runtime.log.error).toHaveBeenCalled();
    // The rename never ran, so a markerless destination can never exist.
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
    expect(fs.existsSync(plan.stagingDir)).toBe(false);
  });

  it("never throws: an execution-phase I/O failure degrades to failed, not an exception (P0-2)", () => {
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
    expect(runtime.log.error).toHaveBeenCalledWith(
      expect.stringContaining("migration failed"),
      expect.anything()
    );
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
  });

  it("no-op for a none plan (no side effects)", () => {
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
    const result = executeUserDataMigration(plan, runtime);
    expect(result).toBe("done");
    expect(runtime.log.info).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
  });

  it("legacy plan defers (caller already pointed userData at DMWork before the lock)", () => {
    const plan = planUserDataMigration(appDataDir, BRAND);
    plan.action = "legacy";
    const result = executeUserDataMigration(plan, runtime);
    expect(result).toBe("deferred");
    expect(runtime.log.warn).not.toHaveBeenCalled();
  });
});
