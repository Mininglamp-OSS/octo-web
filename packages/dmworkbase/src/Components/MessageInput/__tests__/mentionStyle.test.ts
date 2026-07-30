import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = path.resolve(__dirname, "../index.css");
const css = fs.readFileSync(cssPath, "utf8");

function blockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? "";
}

describe("MessageInput mention style", () => {
  it("renders ordinary member mentions as visible pills", () => {
    const mentionBlock = blockFor(".wk-messageinput-editor .mention");

    expect(mentionBlock).toContain("background-color: var(--wk-accent-tint-08");
    expect(mentionBlock).toContain("border-radius: var(--wk-r-xs)");
    expect(mentionBlock).toContain("padding: 0 var(--wk-sp-1)");
    expect(mentionBlock).not.toContain("background-color: transparent");
  });

  it("keeps broadcast mention sentinels as text-only highlights", () => {
    for (const uid of ["-1", "-2", "-3"]) {
      expect(css).toContain(`.wk-messageinput-editor .mention[data-id="${uid}"]`);
    }

    const broadcastBlock = blockFor('.wk-messageinput-editor .mention[data-id="-3"]');
    expect(broadcastBlock).toContain("background-color: transparent");
    expect(broadcastBlock).toContain("padding: 0 var(--wk-sp-0-5)");
  });
});
