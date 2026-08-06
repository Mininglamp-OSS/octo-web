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

  const makeLegacyProfile = (dir: string, extra = {}) => {
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
    // Simulate the single-instance lock having created <appData>/OCTO already.
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "SingletonLock"), "");
    fs.writeFileSync(path.join(newDir, MIGRATION_MARKER), "2026-08-06T00:00:00Z");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
  });

  it("defers to the legacy profile when a legacy instance holds SingletonLock", () => {
    const profile = makeLegacyProfile(appDataDir);
    fs.writeFileSync(path.join(profile, "SingletonLock"), "hostname-pid");
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("defer-legacy");
  });
});

describe("executeUserDataMigration", () => {
  let appDataDir: string;
  let setUserDataDir: ReturnType<typeof vi.fn>;
  let runtime: MigrationRuntime;

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-mig-exec-"));
    setUserDataDir = vi.fn();
    runtime = {
      setUserDataDir,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  });

  afterEach(() => {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  });

  const makeLegacyProfile = (withLock = false) => {
    const profile = path.join(appDataDir, "DMWork");
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, "Preferences"), '{"account":"user"}');
    fs.mkdirSync(path.join(profile, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001");
    fs.mkdirSync(path.join(profile, "Cache"), { recursive: true });
    fs.writeFileSync(path.join(profile, "Cache", "data_0"), "cache-bytes");
    fs.writeFileSync(path.join(profile, "IndexedDB"), "indexed-db-content");
    if (withLock) {
      fs.writeFileSync(path.join(profile, "SingletonLock"), "hostname-pid");
    }
    return profile;
  };

  it("(a) migrates a populated legacy profile atomically via staging, keeps the source, writes the marker", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(setUserDataDir).not.toHaveBeenCalled();
    // New profile complete, marker present.
    const newDir = path.join(appDataDir, BRAND);
    expect(fs.existsSync(path.join(newDir, "Preferences"))).toBe(true);
    expect(fs.readFileSync(path.join(newDir, "Preferences"), "utf8")).toBe('{"account":"user"}');
    expect(fs.existsSync(path.join(newDir, "Local Storage", "leveldb", "CURRENT"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(true);
    // Regenerable caches skipped.
    expect(fs.existsSync(path.join(newDir, "Cache"))).toBe(false);
    // No staging residue.
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
    // Source kept (rollback safety / retryability).
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);
    // Second launch: marker present -> no-op.
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("(b) falls back to the legacy profile when the rename fails, then succeeds on retry", () => {
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
    // This session keeps the user on their data.
    expect(setUserDataDir).toHaveBeenCalledWith(path.join(appDataDir, "DMWork"));
    // Staging cleaned up so the next launch retries from scratch.
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
    // Legacy profile untouched.
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);

    // Next launch: still no marker -> the migration retries and now succeeds.
    const secondPlan = planUserDataMigration(appDataDir, BRAND);
    expect(secondPlan.action).toBe("migrate");
    const second = executeUserDataMigration(secondPlan, runtime);
    expect(second).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(true);
  });

  it("(c) defers to the legacy profile when the legacy SingletonLock is held and copies nothing", () => {
    makeLegacyProfile(true);
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("defer-legacy");

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("deferred");
    expect(setUserDataDir).toHaveBeenCalledWith(path.join(appDataDir, "DMWork"));
    // Nothing was copied.
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
  });

  it("cleans up a stale staging dir from an interrupted previous attempt and retries", () => {
    makeLegacyProfile();
    // Simulate a crash mid-copy: partial staging dir left behind.
    const stale = path.join(appDataDir, `${BRAND}.migrating`);
    fs.mkdirSync(path.join(stale, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(stale, "Local Storage", "leveldb", "CURRENT"), "partial");

    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(true);
  });

  it("removes only Electron lock files from <newDir> before the rename lands", () => {
    makeLegacyProfile();
    // requestSingleInstanceLock() ran first: <appData>/OCTO exists with lock files.
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "SingletonLock"), "");
    fs.writeFileSync(path.join(newDir, "SingletonCookie"), "");
    fs.writeFileSync(path.join(newDir, "SingletonSocket"), "");

    const plan = planUserDataMigration(appDataDir, BRAND);
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(newDir, "Preferences"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(true);
  });

  it("does not clobber <newDir> when it contains non-lock data and no marker (both profiles kept)", () => {
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), '{"account":"someone-else"}');

    const plan = planUserDataMigration(appDataDir, BRAND);
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    // The pre-existing data is untouched, and the legacy profile was not consumed.
    expect(fs.readFileSync(path.join(newDir, "Preferences"), "utf8")).toBe('{"account":"someone-else"}');
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(false);
  });
});
