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

/** Grab the declaration block of a top-level class rule by exact selector. */
function classRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `missing rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("emoji popover positioning (XIN-1048 #2)", () => {
  it("anchors .octo-emoji-popover under its trigger with top:100% and left:0", () => {
    const rule = classRule(".octo-emoji-popover");
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/top:\s*100%/);
    expect(rule).toMatch(/left:\s*0/);
  });
});

describe("document scroll container overflow (XIN-1048 #5)", () => {
  it("pins .octo-doc-scroll to vertical-only scrolling (overflow-x:hidden)", () => {
    const rule = classRule(".octo-doc-scroll");
    expect(rule).toMatch(/overflow-y:\s*auto/);
    // Without overflow-x:hidden the sticky toolbar bleeds into a document-level horizontal
    // scroll and the right-side buttons drift out of view.
    expect(rule).toMatch(/overflow-x:\s*hidden/);
  });
});
