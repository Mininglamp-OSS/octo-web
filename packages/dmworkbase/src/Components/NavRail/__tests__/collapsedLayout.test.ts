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
    // 带底类 .wk-navrail__item-label。round 2 的翻车:如果 --short 的 hide override
    // 只用 `.wk-layout-tab-expanded .wk-navrail__item-label--short` (specificity 0,2,0),
    // 后面共享规则 `.wk-layout-tab-expanded .wk-navrail__item-label` (同 0,2,0) 会靠
    // source order 把 --short 也拉成 inline-flex,expanded rail 同时显示两个 span
    // ("AI Summary Summary")。
    //
    // 有效的 cascade *outcome* 有两条路:
    //   (a) 复合选择器 (0,3,0),无论 source order 都赢 —— 当前实现走这条;
    //   (b) plain override (0,2,0) + 排在共享规则之后,靠 source order 赢。
    // 只测复合形式会误 reject 合法的 (b) 变体;只测规则存在又抓不住 round 2 的 bug。
    // 这里断言的是 *outcome*:override 要么复合,要么 plain-index > shared-index。
    const SHARED_RULE = /\.wk-layout-tab-expanded\s+\.wk-navrail__item-label\s*\{/;

    function overrideIndex(variant: "short" | "full"): { compound: number; plain: number } {
        // compound 形式必须带底类点后紧跟变体类,`.wk-navrail__item-label\.wk-navrail__item-label--x`。
        // plain 形式:`.wk-layout-tab-expanded ` (至少一个空白) 后直接跟变体类;
        // 前面的 `\s+` 挡掉 compound (compound 里变体类前面是 `.` 不是空白),
        // 所以 plain regex 不会误吃 compound 那一行。
        const compoundPat = new RegExp(
            `\\.wk-layout-tab-expanded\\s+\\.wk-navrail__item-label\\.wk-navrail__item-label--${variant}\\s*\\{`,
        );
        const plainPat = new RegExp(
            `\\.wk-layout-tab-expanded\\s+\\.wk-navrail__item-label--${variant}\\s*\\{`,
        );
        return { compound: styles.search(compoundPat), plain: styles.search(plainPat) };
    }

    it.each([
        { variant: "short" as const, expectedDisplay: "display: none" },
        { variant: "full" as const, expectedDisplay: "display: inline-flex" },
    ])("keeps expanded --$variant cascade winning against the shared expanded rule", ({ variant, expectedDisplay }) => {
        const sharedIdx = styles.search(SHARED_RULE);
        expect(sharedIdx, "shared expanded rule missing").toBeGreaterThanOrEqual(0);

        const { compound, plain } = overrideIndex(variant);
        expect(
            compound >= 0 || plain >= 0,
            `Missing override for .wk-layout-tab-expanded .wk-navrail__item-label--${variant}`,
        ).toBe(true);

        if (compound < 0) {
            // Route (b): plain selector must beat the shared rule via source order.
            expect(
                plain,
                `plain --${variant} override (specificity 0,2,0) must be defined after the shared expanded rule (source-order tiebreak) — otherwise the shared rule wins and #1635 regresses`,
            ).toBeGreaterThan(sharedIdx);
        }

        // The override rule itself carries the right `display` value.
        const targetSelector = compound >= 0
            ? `.wk-layout-tab-expanded .wk-navrail__item-label.wk-navrail__item-label--${variant}`
            : `.wk-layout-tab-expanded .wk-navrail__item-label--${variant}`;
        expect(ruleFor(targetSelector)).toContain(expectedDisplay);
    });

    it("keeps the shared expanded rule so the visible label picks up the expanded typography", () => {
        expect(styles).toMatch(SHARED_RULE);
        expect(ruleFor(".wk-layout-tab-expanded .wk-navrail__item-label"))
            .toContain("display: inline-flex");
    });

    it("hides --full by default so collapsed rail only shows the short span", () => {
        // 单独规则 `.wk-navrail__item-label--full { display: none }` 不能被别的规则
        // 反超:collapsed 状态下没有 `.wk-layout-tab-expanded` 祖先,唯一同 specificity
        // 的规则是底类 `.wk-navrail__item-label { display: block }`,而 --full 排在
        // 底类之后,source order 让 none 赢。变体 --short 不写单独 display 规则,继承底类 block。
        expect(ruleFor(".wk-navrail__item-label--full")).toContain("display: none");
        const baseIdx = styles.indexOf(".wk-navrail__item-label {");
        const fullHideIdx = styles.indexOf(".wk-navrail__item-label--full {");
        expect(baseIdx).toBeGreaterThanOrEqual(0);
        expect(fullHideIdx).toBeGreaterThan(baseIdx);
    });

    it("gives --short zero inline padding so DejaVu Sans (Linux fallback) `Summary` fits the 52px label box", () => {
        // 底类 `.wk-navrail__item-label { padding-inline: 4px }` 把 52px 的 label
        // 边框盒缩到 44px 文字盒。DejaVu Sans 下 `Summary` 测得 48.33px,44px 盒
        // 装不下会继续截成 `Summar…`。给 --short 单独把 padding-inline 归零,拿回
        // 8px,文字盒还原到 52px,DejaVu 也能装下。round 3 reviewer 实测的最后一档。
        expect(ruleFor(".wk-navrail__item-label--short")).toContain("padding-inline: 0");
    });
});
