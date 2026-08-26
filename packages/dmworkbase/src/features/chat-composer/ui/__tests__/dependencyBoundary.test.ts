import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const value = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(value);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [value];
  });
}

const featureRoot = path.resolve(__dirname, "../..");
const sources = sourceFiles(featureRoot).map((file) => ({
  file: path.relative(featureRoot, file),
  source: fs.readFileSync(file, "utf8"),
}));
const voiceSettingSource = fs.readFileSync(
  path.resolve(featureRoot, "../voice-input/useSpaceFeedbackSetting.ts"),
  "utf8",
);

describe("ChatComposer feature dependency boundary", () => {
  it("keeps application globals out and SDK access inside its adapter", () => {
    const violations = sources.flatMap(({ file, source }) => {
      const forbiddenEverywhere = [
        /from\s+["'][^"']*Components\/Conversation[^"']*["']/,
        /from\s+["'][^"']*\/App["']/,
        /from\s+["']hotkeys-js["']/,
      ];
      const importsSdk = /from\s+["'][^"']*wukongimjssdk[^"']*["']/.test(
        source,
      );
      const sdkAllowed = file.startsWith("adapters/conversation/");
      return forbiddenEverywhere.some((pattern) => pattern.test(source)) ||
        (importsSdk && !sdkAllowed)
        ? [file]
        : [];
    });

    expect(violations).toEqual([]);
    expect(voiceSettingSource).not.toMatch(
      /from\s+["'][^"']*\/App["']/,
    );
  });
});
