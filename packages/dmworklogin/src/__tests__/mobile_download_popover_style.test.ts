import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "src/MobileDownloadPopover.css"),
  "utf8"
);

function ruleBody(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("mobile download popover visual hierarchy", () => {
  it("uses one token-based Popover shell surface", () => {
    const shell = ruleBody(".wk-login-mobile-download-popover-shell");

    expect(shell).toContain("width: calc(var(--wk-sp-12) * 5)");
    expect(shell).toContain("padding: var(--wk-sp-3)");
    expect(shell).toContain("border: 1px solid var(--wk-border-default)");
    expect(shell).toContain("border-radius: var(--wk-r-md)");
    expect(shell).toContain("background: var(--wk-bg-surface)");
    expect(shell).toContain("box-shadow: var(--wk-shadow-lg)");
  });

  it("keeps the inner content container layout-only", () => {
    const content = ruleBody(".wk-login-mobile-download-popover");

    expect(content).toContain("width: 100%");
    expect(content).not.toMatch(
      /(?:^|\s)(?:padding|border|border-radius|background|box-shadow)\s*:/
    );
  });

  it("uses one compact, scannable QR frame for Android and iOS", () => {
    const qr = ruleBody(".wk-login-mobile-popover-qr");

    expect(qr).toContain("width: calc(var(--wk-sp-12) * 2 + var(--wk-sp-6))");
    expect(qr).toContain("padding: var(--wk-sp-2)");
    expect(qr).toContain("border: 1px solid var(--wk-border-default)");
    expect(qr).toContain("border-radius: var(--wk-r-sm)");
    expect(qr).toContain("background: var(--wk-color-white)");
  });
});
