import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_DRIVE_UPLOAD_LIMITS,
  driveUploadLimitsEqual,
  parseDriveUploadLimits,
} from "../../../../packages/dmworkbase/src/Service/DriveUploadConfig";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("drive_upload_limits leaf parsing", () => {
  it("falls back to the frozen defaults when the field is missing or not an object", () => {
    for (const raw of [undefined, null, "not an object", 42, true]) {
      expect(parseDriveUploadLimits(raw)).toEqual(DEFAULT_DRIVE_UPLOAD_LIMITS);
    }
    // Exactly 1 GiB / 128 MiB / 64 MiB / 3 / 3 (octo-server effective value).
    expect(DEFAULT_DRIVE_UPLOAD_LIMITS).toEqual({
      maxSizeKB: 1048576,
      multipartThresholdKB: 131072,
      partSizeKB: 65536,
      maxConcurrentParts: 3,
      maxConcurrentSessions: 3,
    });
  });

  it("parses a well-formed drive_upload_limits object from appconfig", () => {
    expect(
      parseDriveUploadLimits({
        max_size_kb: 2097152,
        multipart_threshold_kb: 262144,
        part_size_kb: 131072,
        max_concurrent_parts: 4,
        max_concurrent_sessions: 5,
      })
    ).toEqual({
      maxSizeKB: 2097152,
      multipartThresholdKB: 262144,
      partSizeKB: 131072,
      maxConcurrentParts: 4,
      maxConcurrentSessions: 5,
    });
  });

  it("accepts numeric strings (defensive against string-typed JSON)", () => {
    expect(
      parseDriveUploadLimits({
        max_size_kb: "1048576",
        multipart_threshold_kb: "131072",
        part_size_kb: "65536",
        max_concurrent_parts: "3",
        max_concurrent_sessions: "3",
      })
    ).toEqual(DEFAULT_DRIVE_UPLOAD_LIMITS);
  });

  it.each([0, -1, NaN, Infinity, 12.5, "0", "-5", "12.5", "", true, {}, []])(
    "rejects non-positive-integer max_size_kb %s and falls back",
    (value) => {
      expect(parseDriveUploadLimits({ max_size_kb: value }).maxSizeKB).toBe(
        DEFAULT_DRIVE_UPLOAD_LIMITS.maxSizeKB
      );
    }
  );

  it("defends each of the five fields independently and falls back field-by-field", () => {
    // Every single field malformed → the whole object equals the defaults.
    expect(
      parseDriveUploadLimits({
        max_size_kb: "nope",
        multipart_threshold_kb: -1,
        part_size_kb: 0,
        max_concurrent_parts: null,
        max_concurrent_sessions: NaN,
      })
    ).toEqual(DEFAULT_DRIVE_UPLOAD_LIMITS);

    // One field malformed → only that field falls back; the others keep the pushed values.
    expect(
      parseDriveUploadLimits({
        max_size_kb: 2097152,
        multipart_threshold_kb: 262144,
        part_size_kb: "bad",
        max_concurrent_parts: 4,
        max_concurrent_sessions: 5,
      })
    ).toEqual({
      maxSizeKB: 2097152,
      multipartThresholdKB: 262144,
      partSizeKB: DEFAULT_DRIVE_UPLOAD_LIMITS.partSizeKB,
      maxConcurrentParts: 4,
      maxConcurrentSessions: 5,
    });

    // Missing fields each fall back on their own too.
    expect(parseDriveUploadLimits({ max_size_kb: 2097152 })).toEqual({
      ...DEFAULT_DRIVE_UPLOAD_LIMITS,
      maxSizeKB: 2097152,
    });
  });

  it("passes through a degenerate threshold > limit without crashing or correcting", () => {
    // The host only parses/forwards; it does not normalize business semantics.
    const out = parseDriveUploadLimits({
      max_size_kb: 1024,
      multipart_threshold_kb: 2048,
    });
    expect(out.maxSizeKB).toBe(1024);
    expect(out.multipartThresholdKB).toBe(2048);
  });

  it("compares limits field-by-field for change detection", () => {
    const a = { ...DEFAULT_DRIVE_UPLOAD_LIMITS };
    expect(driveUploadLimitsEqual(a, { ...DEFAULT_DRIVE_UPLOAD_LIMITS })).toBe(
      true
    );
    for (const key of [
      "maxSizeKB",
      "multipartThresholdKB",
      "partSizeKB",
      "maxConcurrentParts",
      "maxConcurrentSessions",
    ] as const) {
      expect(driveUploadLimitsEqual(a, { ...a, [key]: a[key] + 1 })).toBe(false);
    }
  });

  it("does not implement the optional C4 driveUploadPort capability port", () => {
    expect(
      fs.existsSync(
        path.join(
          repoRoot,
          "packages/dmworkbase/src/bridge/drive/driveUploadPort.ts"
        )
      )
    ).toBe(false);
  });

  it("adds no polling / timer in the drive upload config leaf", () => {
    const source = readRepoFile(
      "packages/dmworkbase/src/Service/DriveUploadConfig.ts"
    );
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("setTimeout");
  });
});

describe("drive_upload_limits WKRemoteConfig wiring", () => {
  it("wires driveUploadLimits into WKRemoteConfig from appconfig, defaulting to the frozen values", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    expect(source).toContain(
      "driveUploadLimits: DriveUploadLimits = { ...DEFAULT_DRIVE_UPLOAD_LIMITS }"
    );
    expect(source).toContain(
      "const previousDriveUploadLimits = this.driveUploadLimits;"
    );
    expect(source).toContain(
      'this.driveUploadLimits = parseDriveUploadLimits(\n        result["drive_upload_limits"]\n      );'
    );
    // Must participate in change detection so consumers refresh when ops adjusts limits.
    expect(source).toContain(
      "driveUploadLimitsEqual(\n          previousDriveUploadLimits,\n          this.driveUploadLimits\n        )"
    );
    expect(source).toContain("notifyConfigChangeListeners");
  });
});
