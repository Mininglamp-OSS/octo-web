import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_FILE_UPLOAD_LIMITS,
  fileUploadLimitsEqual,
  parseFileUploadLimits,
} from "../../../../packages/dmworkbase/src/Service/FileUploadConfig";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("file_upload_limits appconfig web integration", () => {
  it("falls back to the historical hardcoded defaults when the field is missing", () => {
    for (const raw of [undefined, null, "not an object", 42]) {
      expect(parseFileUploadLimits(raw)).toEqual(DEFAULT_FILE_UPLOAD_LIMITS);
    }
    expect(DEFAULT_FILE_UPLOAD_LIMITS.maxSizeKB).toBe(102400);
  });

  it("parses a well-formed file_upload_limits object from appconfig", () => {
    expect(
      parseFileUploadLimits({
        max_size_kb: 20480,
        allowed_extensions: [".pdf", ".png"],
      })
    ).toEqual({ maxSizeKB: 20480, allowedExtensions: [".pdf", ".png"] });
  });

  it("accepts a numeric string for max_size_kb (defensive against string-typed JSON)", () => {
    expect(parseFileUploadLimits({ max_size_kb: "102400" }).maxSizeKB).toBe(
      102400
    );
  });

  it.each([0, -1, NaN, Infinity, 12.5, "0", "-5", "12.5", "", true, {}, []])(
    "rejects non-positive-integer max_size_kb %s and falls back",
    (value) => {
      expect(parseFileUploadLimits({ max_size_kb: value }).maxSizeKB).toBe(
        DEFAULT_FILE_UPLOAD_LIMITS.maxSizeKB
      );
    }
  );

  it("falls back when allowed_extensions is missing, not an array, or empty", () => {
    for (const value of [undefined, null, ".pdf", "", [], [123], [""]]) {
      expect(
        parseFileUploadLimits({ allowed_extensions: value }).allowedExtensions
      ).toEqual(DEFAULT_FILE_UPLOAD_LIMITS.allowedExtensions);
    }
  });

  it("normalizes allowed_extensions: trims, lowercases, adds the leading dot", () => {
    expect(
      parseFileUploadLimits({
        allowed_extensions: [" PDF ", "png", ".JPG", "jpeg"],
      }).allowedExtensions
    ).toEqual([".pdf", ".png", ".jpg", ".jpeg"]);
  });

  it("drops non-string / empty-string entries and de-duplicates, keeping the rest", () => {
    expect(
      parseFileUploadLimits({
        allowed_extensions: [".pdf", 123, "", null, ".PDF", "pdf"],
      }).allowedExtensions
    ).toEqual([".pdf"]);
  });

  it("falls back field-by-field, not all-or-nothing", () => {
    // max_size_kb malformed → only that field falls back; allowed_extensions still parses.
    expect(
      parseFileUploadLimits({
        max_size_kb: "nope",
        allowed_extensions: [".pdf"],
      })
    ).toEqual({
      maxSizeKB: DEFAULT_FILE_UPLOAD_LIMITS.maxSizeKB,
      allowedExtensions: [".pdf"],
    });
    // allowed_extensions malformed → only that field falls back; max_size_kb still parses.
    expect(
      parseFileUploadLimits({
        max_size_kb: 20480,
        allowed_extensions: "nope",
      })
    ).toEqual({
      maxSizeKB: 20480,
      allowedExtensions: DEFAULT_FILE_UPLOAD_LIMITS.allowedExtensions,
    });
  });

  it("compares limits field-by-field for change detection", () => {
    const a = { maxSizeKB: 102400, allowedExtensions: [".pdf", ".png"] };
    const same = { maxSizeKB: 102400, allowedExtensions: [".pdf", ".png"] };
    expect(fileUploadLimitsEqual(a, same)).toBe(true);
    expect(
      fileUploadLimitsEqual(a, { maxSizeKB: 20480, allowedExtensions: [".pdf", ".png"] })
    ).toBe(false);
    expect(
      fileUploadLimitsEqual(a, { maxSizeKB: 102400, allowedExtensions: [".pdf"] })
    ).toBe(false);
  });

  it("wires fileUploadLimits into WKRemoteConfig from appconfig, defaulting to the historical hardcoded values", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    // Fail-safe default: identical to the pre-change hardcoded client behavior.
    expect(source).toContain(
      "fileUploadLimits: FileUploadLimits = { ...DEFAULT_FILE_UPLOAD_LIMITS }"
    );
    expect(source).toContain("const previousFileUploadLimits = this.fileUploadLimits;");
    expect(source).toContain(
      'this.fileUploadLimits = parseFileUploadLimits(\n        result["file_upload_limits"]\n      );'
    );
    // Must participate in change detection so consumers refresh when ops adjusts limits.
    expect(source).toContain(
      "fileUploadLimitsEqual(\n          previousFileUploadLimits,\n          this.fileUploadLimits\n        )"
    );
    expect(source).toContain("notifyConfigChangeListeners");
  });

  it("consumes the live fileUploadLimits for attachment pre-validation without hardcoded thresholds", () => {
    const source = readRepoFile(
      "packages/dmworkbase/src/Components/Conversation/index.tsx"
    );

    // Reads the live configured value at validation time (no component state cache).
    expect(source).toContain("WKApp.remoteConfig.fileUploadLimits");
    // Size threshold is KB × 1024 from the pushed config.
    expect(source).toContain("limits.maxSizeKB * 1024");
    // Extension allowlist is authoritative; the local blacklist guard is retained.
    expect(source).toContain("allowedExtensions.includes(`.${ext}`)");
    expect(source).toContain("BLOCKED_EXTENSIONS.includes(blockedKey)");
    // P1: the batch total check uses a client-owned constant, NOT the server per-file field.
    expect(source).toContain(
      "existingSize + incomingSize > COMPOSER_MAX_TOTAL_BYTES"
    );
    expect(source).toContain("const COMPOSER_MAX_TOTAL_BYTES =");
    // MAX_TOTAL_SIZE is no longer the effective threshold on this path (and is deleted).
    expect(source).not.toContain("MAX_TOTAL_SIZE");
    expect(readRepoFile("packages/dmworkbase/src/Components/Conversation/vm.ts")).not.toContain(
      "MAX_TOTAL_SIZE"
    );
  });

  it("reads the same authoritative limit for the revoked-message re-edit path", () => {
    const source = readRepoFile(
      "packages/dmworkbase/src/Messages/Revoke/reeditableMessage.ts"
    );

    expect(source).toContain(
      "WKApp.remoteConfig.fileUploadLimits.maxSizeKB * 1024"
    );
    // MAX_REEDIT_FILE_BYTES is no longer the effective threshold (and is deleted).
    expect(source).not.toContain("MAX_REEDIT_FILE_BYTES");
    // The toast in Conversation/index.tsx uses the same live source.
    expect(
      readRepoFile("packages/dmworkbase/src/Components/Conversation/index.tsx")
    ).toContain("formatFileSize(liveFileUploadMaxBytes())");
  });

  it("registers the new extension-not-allowed message in both locales", () => {
    const zh = JSON.parse(
      readRepoFile("packages/dmworkbase/src/i18n/locales/zh-CN.json")
    );
    const en = JSON.parse(
      readRepoFile("packages/dmworkbase/src/i18n/locales/en-US.json")
    );

    expect(zh["conversation.upload.extensionNotAllowed"]).toContain("{{extension}}");
    expect(en["conversation.upload.extensionNotAllowed"]).toContain("{{extension}}");
  });
});
