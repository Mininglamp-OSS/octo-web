import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_STICKER_UPLOAD_LIMITS,
  parseStickerUploadLimits,
} from "../../../../packages/dmworkbase/src/Service/StickerUploadConfig";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("sticker_upload_limits appconfig web integration", () => {
  it("falls back to the historical hardcoded defaults when the field is missing", () => {
    expect(parseStickerUploadLimits(undefined)).toEqual(
      DEFAULT_STICKER_UPLOAD_LIMITS
    );
  });

  it("parses a well-formed sticker_upload_limits object from appconfig", () => {
    expect(
      parseStickerUploadLimits({
        max_size_kb: 3072,
        max_dimension: 900,
        allowed_formats: [".png", ".gif"],
      })
    ).toEqual({ maxSizeKB: 3072, maxDimension: 900, allowedFormats: [".png", ".gif"] });
  });

  it("wires stickerUploadLimits into WKRemoteConfig from appconfig, defaulting to the historical hardcoded values", () => {
    const source = readRepoFile("packages/dmworkbase/src/App.tsx");

    // Fail-safe default: identical to the pre-#544/#547 hardcoded client behavior.
    expect(source).toContain(
      "stickerUploadLimits: StickerUploadLimits = { ...DEFAULT_STICKER_UPLOAD_LIMITS }"
    );
    expect(source).toContain(
      'this.stickerUploadLimits = parseStickerUploadLimits(\n        result["sticker_upload_limits"]\n      );'
    );
    // Must participate in change detection so EmojiPanel refreshes when ops adjusts limits.
    expect(source).toContain("previousStickerUploadLimits");
    expect(source).toContain(
      "stickerUploadLimitsEqual(\n          previousStickerUploadLimits,\n          this.stickerUploadLimits\n        )"
    );
    expect(source).toContain("notifyConfigChangeListeners");
  });

  it("consumes stickerUploadLimits in EmojiToolbar for local pre-upload validation", () => {
    const source = readRepoFile(
      "packages/dmworkbase/src/Components/EmojiToolbar/index.tsx"
    );

    // Read live (not cached) both at render time and inside onFileChange, matching the
    // TOCTOU-safe discipline already established for stickerCustomEnabled.
    expect(source).toContain("WKApp.remoteConfig.stickerUploadLimits");
    // Format check is extension-based (server's own contract), not MIME-based.
    expect(source).toContain("getStickerFileExtension(file.name)");
    expect(source).toContain("limits.allowedFormats.includes(");
    // Size check reads the configured limit instead of a hardcoded byte constant.
    expect(source).toContain("file.size > limits.maxSizeKB * 1024");
    // Dimension check is new: no hardcoded MAX_STICKER_BYTES/ACCEPTED_STICKER_TYPES remain.
    expect(source).toContain("readStickerImageDimensions(file)");
    // Re-read live after the decode await rather than reusing the pre-await snapshot
    // (the one check in this file that spans an await, so it needs its own fresh read).
    expect(source).toContain("freshLimits.maxDimension");
    expect(source).not.toContain("MAX_STICKER_BYTES");
    expect(source).not.toContain("ACCEPTED_STICKER_TYPES");
    // A local decode failure must fail OPEN (proceed to upload), not block a legitimate file.
    expect(source).toContain("if (this.isUnmounted) {\n            return\n        }");
    // File picker's accept attribute reflects the live configured formats.
    expect(source).toContain("accept={stickerUploadLimits.allowedFormats.join(\",\")}");
  });

  it("registers dimensionTooLarge and a parameterized formatUnsupported message in both locales", () => {
    const zh = readRepoFile(
      "packages/dmworkbase/src/i18n/locales/zh-CN.json"
    );
    const en = readRepoFile(
      "packages/dmworkbase/src/i18n/locales/en-US.json"
    );

    for (const source of [zh, en]) {
      const messages = JSON.parse(source);
      expect(messages["sticker.formatUnsupported"]).toContain("{{formats}}");
      expect(messages["sticker.tooLarge"]).toContain("{{size}}");
      expect(messages["sticker.dimensionTooLarge"]).toContain("{{dimension}}");
    }
  });
});
