import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const avatarStyles = readFileSync(
  resolve(__dirname, "..", "index.css"),
  "utf8"
);

describe("WKAvatar layout", () => {
  it("does not participate in inline baseline layout", () => {
    const avatarRule =
      avatarStyles.match(/\.wk-avatar\s*\{([^}]*)\}/m)?.[1] ?? "";

    expect(avatarRule).toContain("display: block");
  });
});
