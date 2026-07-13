import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(__dirname, "styles.css"), "utf8");

function headingRule(level: number): string {
  const matches = [
    ...css.matchAll(
      new RegExp(`\\.octo-prose \\.ProseMirror h${level}\\s*\\{([^}]*)\\}`, "g")
    ),
  ];
  const rule = matches.find((match) => match[1].includes("font-size"))?.[1];
  expect(rule, `missing scoped H${level} font-size rule`).toBeDefined();
  return rule ?? "";
}

describe("editor heading hierarchy styles", () => {
  it("assigns a distinct descending font-size token to every heading level", () => {
    const sizeTokens = [
      "--wk-text-size-4xl",
      "--wk-text-size-3xl",
      "--wk-text-size-xl",
      "--wk-text-size-md",
      "--wk-text-size-base",
      "--wk-text-size-sm",
    ];

    sizeTokens.forEach((token, index) => {
      expect(headingRule(index + 1)).toMatch(
        new RegExp(`font-size:\\s*var\\(${token}\\)`)
      );
    });
    expect(new Set(sizeTokens).size).toBe(6);
  });
});
