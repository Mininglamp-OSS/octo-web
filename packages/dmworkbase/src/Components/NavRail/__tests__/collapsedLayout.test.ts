import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(__dirname, "..", "index.css"), "utf8");

function ruleFor(selector: string): string {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));

    expect(match, `Missing CSS rule: ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
}

describe("NavRail collapsed bottom layout", () => {
    it("hides utility labels without hiding the current Space name", () => {
        expect(ruleFor(".wk-navrail__item-label")).toContain("display: block");
        expect(ruleFor(".wk-navrail__bottom .wk-navrail__item > .wk-navrail__item-label"))
            .toContain("display: none");
        expect(styles).not.toMatch(/(?:^|\n)\.wk-navrail__bottom\s+\.wk-navrail__item-label\s*\{/);
    });
});
