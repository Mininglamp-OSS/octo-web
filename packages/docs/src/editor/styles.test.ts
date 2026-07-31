import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(__dirname, "styles.css"), "utf8");
const docsHome = fs.readFileSync(path.resolve(__dirname, "../pages/DocsHome.tsx"), "utf8");
const sheetView = fs.readFileSync(path.resolve(__dirname, "../sheet/SheetView.tsx"), "utf8");

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

describe("document typography controls match Sheet selectors", () => {
  it("keeps font family and size borderless without a persistent ring", () => {
    const rule = classRule(".octo-tb-sel--font .octo-tb-sheet-select,\n.octo-tb-sel--size .octo-tb-sheet-select");
    expect(rule).toMatch(/height:\s*24px/);
    expect(rule).toMatch(/border:\s*0/);
    expect(rule).toMatch(/background:\s*transparent/);
    expect(rule).toMatch(/box-shadow:\s*none/);
  });
});

describe("Docs list tabs follow the Octo tab contract", () => {
  it("uses a fixed 48px strip and black active indicator instead of legacy blue", () => {
    const tabs = classRule(".octo-docs-tabs");
    const tab = classRule(".octo-docs-tab");
    const active = classRule(".octo-docs-tab-active");

    expect(tabs).toMatch(/height:\s*48px/);
    expect(tabs).not.toMatch(/border-bottom/);
    expect(tab).toMatch(/height:\s*48px/);
    expect(active).toMatch(/font-weight:\s*600/);
    expect(active).toMatch(/color:\s*var\(--wk-text-primary/);
    expect(active).toMatch(/border-bottom-color:\s*var\(--wk-brand-primary/);
    expect(`${tabs}${tab}${active}`).not.toMatch(/#1664ff/i);
  });
});

describe("Docs list selected state follows the Octo theme", () => {
  it("uses the shared selected token without a legacy blue accent", () => {
    const row = classRule(
      ".octo-docs-list-item-active > .octo-docs-list-row,\n.octo-docs-list-row[aria-current='true']"
    );
    const icon = classRule(
      ".octo-docs-list-item-active > .octo-docs-list-row .octo-docs-list-row-icon,\n.octo-docs-list-row[aria-current='true'] .octo-docs-list-row-icon"
    );
    const title = classRule(
      ".octo-docs-list-item-active > .octo-docs-list-row .octo-docs-list-row-title,\n.octo-docs-list-row[aria-current='true'] .octo-docs-list-row-title"
    );

    expect(row).toMatch(/background:\s*var\(--wk-bg-selected/);
    expect(row).toMatch(/border-left-color:\s*transparent/);
    expect(icon).toMatch(/color:\s*var\(--wk-icon-default/);
    expect(title).toMatch(/color:\s*var\(--wk-text-primary/);
    expect(`${row}${icon}${title}`).not.toMatch(/#(?:1664ff|e8f3ff)/i);
  });
});

describe("Docs and Sheet semantic theme contract", () => {
  it("maps the legacy Octo variables to WK semantic tokens", () => {
    const theme = classRule(".octo-theme");
    expect(theme).toMatch(/--octo-bg:\s*var\(--wk-bg-surface\)/);
    expect(theme).toMatch(/--octo-fg:\s*var\(--wk-text-primary\)/);
    expect(theme).toMatch(/--octo-accent:\s*var\(--wk-brand-primary\)/);
    expect(theme).toMatch(/--octo-border:\s*var\(--wk-border-default\)/);
    expect(theme).toMatch(/--octo-hover:\s*var\(--wk-bg-hover\)/);
  });

  it("themes both DocsHome roots", () => {
    expect(docsHome).toContain('className="octo-doc octo-docs-list-only octo-theme"');
    expect(docsHome).toContain('className="octo-doc octo-docs-split octo-theme"');
  });

  it("keeps Univer body portals narrow and never globally themes every dialog", () => {
    expect(css).toContain("#octo-univer-portal,");
    expect(css).toContain(".octo-univer-color-dialog,");
    expect(css).toContain('[role="tooltip"][class*="univer-"]');
    expect(css).not.toMatch(/(?:^|,)\s*\[role=["']dialog["']\]\s*(?:,|\{)/m);
  });

  it("leaves Sheet shell colors to semantic CSS instead of inline dark literals", () => {
    expect(sheetView).toContain('className="octo-doc octo-doc--editor octo-theme"');
    expect(sheetView).toContain('<header className="octo-doc-header">');
    expect(sheetView).not.toMatch(/background:\s*dark\s*\?/);
    expect(sheetView).not.toMatch(/color:\s*dark\s*\?/);
    expect(sheetView).not.toContain("#1f1f1f");
    expect(sheetView).not.toContain("#e8eaed");
  });

  it("lets the Sheet title use the same remaining header width as a text document", () => {
    expect(sheetView).toContain("flex: '1 1 auto', minWidth: 0");
    expect(sheetView).not.toMatch(/maxWidth:\s*['\"]55%['\"]/);
  });
});
