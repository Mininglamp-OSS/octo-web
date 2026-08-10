import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIGRATION_MARKER,
  STAGING_OWNER_FILE,
  executeUserDataMigration,
  planUserDataMigration,
  type MigrationRuntime,
} from "../userDataMigration";

const BRAND = "OCTO";
// A pid that is guaranteed not to exist on this machine (any process.kill
// against it must throw ESRCH), for stale-lock fixtures.
const DEAD_PID = 2_147_483_647;

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
    // First decision: keep both profiles.
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
    // Re-running must NOT flip back to migrate: the decision is idempotent,
    // no per-launch re-decision loop.
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("none");
  });

  it("defers when a live legacy SingletonLock symlink exists (F1: POSIX dangling symlink, pid alive)", () => {
    makeLegacyProfile(appDataDir);
    // Chromium's POSIX SingletonLock is a symlink to a non-existent target
    // "<hostname>-<pid>"; existsSync follows links and would never see it.
    const lstatSpy = vi
      .spyOn(fs, "lstatSync")
      .mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
    const readlinkSpy = vi
      .spyOn(fs, "readlinkSync")
      .mockReturnValue(`${os.hostname()}-${process.pid}`);
    try {
      expect(planUserDataMigration(appDataDir, BRAND).action).toBe("defer-legacy");
    } finally {
      lstatSpy.mockRestore();
      readlinkSpy.mockRestore();
    }
  });

  it("does NOT defer for a stale lock with a dead pid (F1)", () => {
    makeLegacyProfile(appDataDir);
    const lstatSpy = vi
      .spyOn(fs, "lstatSync")
      .mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
    const readlinkSpy = vi
      .spyOn(fs, "readlinkSync")
      .mockReturnValue(`${os.hostname()}-${DEAD_PID}`);
    try {
      expect(planUserDataMigration(appDataDir, BRAND).action).toBe("migrate");
    } finally {
      lstatSpy.mockRestore();
      readlinkSpy.mockRestore();
    }
  });

  it("does NOT defer for a lock from a foreign hostname (F1)", () => {
    makeLegacyProfile(appDataDir);
    const lstatSpy = vi
      .spyOn(fs, "lstatSync")
      .mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
    const readlinkSpy = vi
      .spyOn(fs, "readlinkSync")
      .mockReturnValue(`other-host-${process.pid}`);
    try {
      expect(planUserDataMigration(appDataDir, BRAND).action).toBe("migrate");
    } finally {
      lstatSpy.mockRestore();
      readlinkSpy.mockRestore();
    }
  });

  it("does NOT defer for an unparseable lock file (F1: never trap users on garbage)", () => {
    const profile = makeLegacyProfile(appDataDir);
    fs.writeFileSync(path.join(profile, "SingletonLock"), "not-a-hostname-pid");
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("migrate");
  });

  it("defers for a plain-file lock with a live pid (F1 fallback parse)", () => {
    const profile = makeLegacyProfile(appDataDir);
    fs.writeFileSync(path.join(profile, "SingletonLock"), `${os.hostname()}-${process.pid}`);
    expect(planUserDataMigration(appDataDir, BRAND).action).toBe("defer-legacy");
  });
});

describe("executeUserDataMigration", () => {
  let appDataDir: string;
  let setUserDataDir: ReturnType<typeof vi.fn<(dir: string) => void>>;
  let runtime: MigrationRuntime;

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-mig-exec-"));
    setUserDataDir = vi.fn<(dir: string) => void>();
    runtime = {
      setUserDataDir,
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
    fs.writeFileSync(path.join(profile, "SingletonLock"), `${os.hostname()}-${DEAD_PID}`);
    fs.writeFileSync(path.join(profile, "SingletonCookie"), "cookie");
    fs.writeFileSync(path.join(profile, "SingletonSocket"), "socket");
    return profile;
  };

  it("(a) migrates atomically via staging, keeps the source, writes the marker, leaks no Singleton artifacts (F3)", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(setUserDataDir).not.toHaveBeenCalled();
    const newDir = path.join(appDataDir, BRAND);
    expect(fs.existsSync(path.join(newDir, "Preferences"))).toBe(true);
    expect(fs.readFileSync(path.join(newDir, "Preferences"), "utf8")).toBe('{"account":"user"}');
    expect(fs.existsSync(path.join(newDir, "Local Storage", "leveldb", "CURRENT"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(true);
    // F3: singleton artifacts are not copied.
    expect(fs.existsSync(path.join(newDir, "SingletonLock"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "SingletonCookie"))).toBe(false);
    expect(fs.existsSync(path.join(newDir, "SingletonSocket"))).toBe(false);
    // Regenerable caches skipped.
    expect(fs.existsSync(path.join(newDir, "Cache"))).toBe(false);
    // No staging residue (owner file included).
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
    expect(setUserDataDir).toHaveBeenCalledWith(path.join(appDataDir, "DMWork"));
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);

    const secondPlan = planUserDataMigration(appDataDir, BRAND);
    expect(secondPlan.action).toBe("migrate");
    const second = executeUserDataMigration(secondPlan, runtime);
    expect(second).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(true);
  });

  it("(c) defer-legacy is reachable through execute and emits the user-actionable message (F7)", () => {
    makeLegacyProfile();
    const lstatSpy = vi
      .spyOn(fs, "lstatSync")
      .mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
    const readlinkSpy = vi
      .spyOn(fs, "readlinkSync")
      .mockReturnValue(`${os.hostname()}-${process.pid}`);
    let plan;
    try {
      plan = planUserDataMigration(appDataDir, BRAND);
    } finally {
      lstatSpy.mockRestore();
      readlinkSpy.mockRestore();
    }
    expect(plan.action).toBe("defer-legacy");

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("deferred");
    expect(setUserDataDir).toHaveBeenCalledWith(path.join(appDataDir, "DMWork"));
    expect(runtime.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Quit the old app and relaunch to migrate")
    );
    // Nothing was copied.
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
    expect(fs.existsSync(path.join(appDataDir, `${BRAND}.migrating`))).toBe(false);
  });

  it("defers when another launch is mid-migration (live staging owner, F2) and leaves its staging alone", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("migrate");

    // Simulate a concurrent launch that claimed the staging mutex first.
    fs.mkdirSync(plan.stagingDir, { recursive: true });
    fs.writeFileSync(
      path.join(plan.stagingDir, STAGING_OWNER_FILE),
      JSON.stringify({ hostname: os.hostname(), pid: process.pid, startedAt: "x" })
    );

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("deferred");
    expect(setUserDataDir).toHaveBeenCalledWith(path.join(appDataDir, "DMWork"));
    // The concurrent migration's staging dir is untouched.
    expect(fs.existsSync(path.join(plan.stagingDir, STAGING_OWNER_FILE))).toBe(true);
    // Nothing copied to the destination.
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(false);
  });

  it("claims and retries a stale staging dir whose owner pid is dead (F2)", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);

    fs.mkdirSync(plan.stagingDir, { recursive: true });
    fs.writeFileSync(
      path.join(plan.stagingDir, STAGING_OWNER_FILE),
      JSON.stringify({ hostname: os.hostname(), pid: DEAD_PID, startedAt: "x" })
    );

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(true);
    expect(fs.existsSync(plan.stagingDir)).toBe(false);
  });

  it("claims a stale staging dir with no owner file (pre-upgrade crash residue, F2)", () => {
    makeLegacyProfile();
    const plan = planUserDataMigration(appDataDir, BRAND);

    fs.mkdirSync(path.join(plan.stagingDir, "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(plan.stagingDir, "Local Storage", "leveldb", "CURRENT"), "partial");

    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.existsSync(path.join(appDataDir, BRAND, MIGRATION_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(appDataDir, BRAND, "Preferences"))).toBe(true);
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
    expect(setUserDataDir).toHaveBeenCalledWith(path.join(appDataDir, "DMWork"));
    // The rename never ran, so a markerless destination can never exist:
    // profile+marker publish as one atomic step.
    expect(fs.existsSync(path.join(appDataDir, BRAND))).toBe(false);
    expect(fs.existsSync(plan.stagingDir)).toBe(false);
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

  it("does not clobber a destination with non-lock data (plan already returned none, F6)", () => {
    makeLegacyProfile();
    const newDir = path.join(appDataDir, BRAND);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "Preferences"), '{"account":"someone-else"}');

    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
    const result = executeUserDataMigration(plan, runtime);

    expect(result).toBe("done");
    expect(fs.readFileSync(path.join(newDir, "Preferences"), "utf8")).toBe('{"account":"someone-else"}');
    expect(fs.existsSync(path.join(appDataDir, "DMWork", "Preferences"))).toBe(true);
    expect(fs.existsSync(path.join(newDir, MIGRATION_MARKER))).toBe(false);
  });

  it("no-op for a none plan (no side effects)", () => {
    const plan = planUserDataMigration(appDataDir, BRAND);
    expect(plan.action).toBe("none");
    const result = executeUserDataMigration(plan, runtime);
    expect(result).toBe("done");
    expect(setUserDataDir).not.toHaveBeenCalled();
  });
});
