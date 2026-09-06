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

describe("NavRail dual-span short/full label cascade (#1635 regression guard)", () => {
    // NavItem 在 shortLabel≠label 时同时渲染两个 span (--full + --short);两者都
    // 带底类 .wk-navrail__item-label。这个测试守的是 round 2 的翻车:如果 short
    // 的 hide override 只用 `.wk-layout-tab-expanded .wk-navrail__item-label--short`
    // (specificity 0,2,0),后面的共享规则 `.wk-layout-tab-expanded .wk-navrail__item-label`
    // (同 0,2,0) 会靠 source order 把 --short 也拉成 inline-flex,expanded rail
    // 一次显示两个 span ("AI Summary Summary")。要么用复合选择器把
    // specificity 拉到 0,3,0,要么把 override 排在共享规则之后 —— 任一都行,
    // 但纯 selector-presence 断言挡不住,得测 specificity 或顺序。
    const EXPANDED_SHORT_HIDE_COMPOUND =
        /\.wk-layout-tab-expanded\s+\.wk-navrail__item-label\.wk-navrail__item-label--short\s*\{[^}]*display:\s*none/;
    const EXPANDED_FULL_SHOW_COMPOUND =
        /\.wk-layout-tab-expanded\s+\.wk-navrail__item-label\.wk-navrail__item-label--full\s*\{[^}]*display:\s*inline-flex/;
    const EXPANDED_BASE_RULE =
        /\.wk-layout-tab-expanded\s+\.wk-navrail__item-label\s*\{/;
    // 只匹配变体自己 (`.--short`) 的简单选择器,不吃 `.foo.--short` 的复合形式;
    // 依赖 `(?<![.\w-])` 断言把左边卡死不是类名的一部分。
    const EXPANDED_SHORT_HIDE_PLAIN =
        /(?<![.\w-])\.wk-layout-tab-expanded\s+\.wk-navrail__item-label--short\s*\{/;
    const EXPANDED_FULL_SHOW_PLAIN =
        /(?<![.\w-])\.wk-layout-tab-expanded\s+\.wk-navrail__item-label--full\s*\{/;

    it("uses compound-class selectors (specificity 0,3,0) so overrides beat the shared expanded rule", () => {
        expect(styles, "expanded --short hide must use compound selector")
            .toMatch(EXPANDED_SHORT_HIDE_COMPOUND);
        expect(styles, "expanded --full show must use compound selector")
            .toMatch(EXPANDED_FULL_SHOW_COMPOUND);
        expect(styles, "plain-selector overrides tie the shared rule on specificity and are order-fragile")
            .not.toMatch(EXPANDED_SHORT_HIDE_PLAIN);
        expect(styles, "plain-selector overrides tie the shared rule on specificity and are order-fragile")
            .not.toMatch(EXPANDED_FULL_SHOW_PLAIN);
    });

    it("keeps the shared expanded rule so the visible label picks up the expanded typography", () => {
        expect(styles).toMatch(EXPANDED_BASE_RULE);
        expect(ruleFor(".wk-layout-tab-expanded .wk-navrail__item-label"))
            .toContain("display: inline-flex");
    });

    it("hides --full by default so collapsed rail only shows the short span", () => {
        // 单独规则 `.wk-navrail__item-label--full { display: none }` 不能被别的规则
        // 反超:collapsed 状态下没有 `.wk-layout-tab-expanded` 祖先,唯一同 specificity
        // 的规则是底类 `.wk-navrail__item-label { display: block }`,而 --full 排在
        // 底类之后,source order 让 none 赢。变体 --short 不写单独规则,继承底类 block。
        expect(ruleFor(".wk-navrail__item-label--full")).toContain("display: none");
        const baseIdx = styles.indexOf(".wk-navrail__item-label {");
        const fullHideIdx = styles.indexOf(".wk-navrail__item-label--full {");
        expect(baseIdx).toBeGreaterThanOrEqual(0);
        expect(fullHideIdx).toBeGreaterThan(baseIdx);
    });
});
