import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "../ChatComposer.tsx"),
  "utf8",
);

describe("ChatComposer UI dependency boundary", () => {
  it("does not reach into SDK or Conversation runtime globals", () => {
    expect(source).not.toContain("wukongimjssdk");
    expect(source).not.toContain("Components/Conversation");
    expect(source).not.toContain('from "../../../App"');
    expect(source).not.toContain('from "hotkeys-js"');
  });
});
