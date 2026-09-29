import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(__dirname, "..", "index.css"), "utf8");
const theme = readFileSync(resolve(__dirname, "../../../theme/semantic.css"), "utf8");

function matchRule(selector: string, source = styles): RegExpMatchArray | null {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match the complete selector at a rule's start, never a descendant suffix.
    return source.match(new RegExp(`^[\\t ]*${escapedSelector}\\s*\\{([^}]*)\\}`, "m"));
}

function ruleFor(selector: string, source = styles): string {
    const match = matchRule(selector, source);
    expect(match, `Missing CSS rule: ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
}

describe("NavRail CSS rule lookup", () => {
    const selector = ".wk-navrail__item-label";

    it("reads the base rule rather than an earlier descendant rule", () => {
        const source = `.wk-layout-tab-expanded ${selector} { display: block; }
    ${selector} { display: none; }`;
        expect(ruleFor(selector, source)).toContain("display: none");
        expect(matchRule(selector, source)?.index).toBeGreaterThan(source.indexOf("}"));
    });

    it("does not substitute a descendant when the exact rule is missing", () => {
        expect(matchRule(selector, `.wk-layout-tab-expanded ${selector} { display: block; }`)).toBeNull();
    });
});

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
    const SHARED_RULE = /^[\t ]*\.wk-layout-tab-expanded\s+\.wk-navrail__item-label\s*\{/m;

    function overrideIndex(variant: "short" | "full"): { compound: number; plain: number } {
        // compound 形式必须带底类点后紧跟变体类,`.wk-navrail__item-label\.wk-navrail__item-label--x`。
        // plain 形式:`.wk-layout-tab-expanded ` (至少一个空白) 后直接跟变体类;
        // 前面的 `\s+` 挡掉 compound (compound 里变体类前面是 `.` 不是空白),
        // 所以 plain regex 不会误吃 compound 那一行。
        const compoundPat = new RegExp(
            `^[\\t ]*\\.wk-layout-tab-expanded\\s+\\.wk-navrail__item-label\\.wk-navrail__item-label--${variant}\\s*\\{`, "m",
        );
        const plainPat = new RegExp(
            `^[\\t ]*\\.wk-layout-tab-expanded\\s+\\.wk-navrail__item-label--${variant}\\s*\\{`, "m",
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
        const baseIdx = matchRule(".wk-navrail__item-label")?.index ?? -1;
        const fullHideIdx = matchRule(".wk-navrail__item-label--full")?.index ?? -1;
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

describe("NavRail Space badge CSS contract (CI)", () => {
    it("anchors to the icon when collapsed and to the switcher row when expanded", () => {
        expect(ruleFor(".wk-navrail__space-icon-anchor")).toContain("position: relative");
        expect(ruleFor(".wk-navrail__space-icon-anchor")).toContain("width: var(--wk-sp-5)");
        expect(ruleFor(".wk-navrail__space-icon-anchor")).toContain("height: var(--wk-sp-5)");
        expect(ruleFor(".wk-layout-tab-expanded .wk-navrail__space-icon-anchor")).toContain("position: static");
        expect(ruleFor(".wk-navrail__switcher")).toContain("position: relative");
        const badge = ruleFor(".wk-navrail__space-unread-badge");
        expect(badge).toContain("position: absolute");
        expect(badge).toContain("top: 0");
        expect(badge).toContain("right: 0");
        expect(badge).toContain("transform: translate(50%, -50%)");
        const expanded = ruleFor(".wk-layout-tab-expanded .wk-navrail__space-unread-badge");
        expect(expanded).toContain("top: 50%");
        expect(expanded).toContain("right: var(--wk-sp-3)");
        expect(expanded).toContain("transform: translateY(-50%)");
    });

    it("preserves the badge size and reserves room beside truncated Space names", () => {
        expect(theme).toMatch(/--wk-nav-badge-size:\s*14px;/);
        expect(theme).toMatch(/--wk-nav-badge-padding-x:\s*3px;/);
        expect(theme).toMatch(/--wk-text-size-badge:\s*9px;/);
        const badge = ruleFor(".wk-navrail__space-unread-badge");
        expect(badge).toContain("min-width: var(--wk-nav-badge-size)");
        expect(badge).toMatch(/(?:^|;)\s*height:\s*var\(--wk-nav-badge-size\);/);
        expect(badge).toContain("font-size: var(--wk-text-size-badge)");
        expect(badge).toContain("padding: 0 var(--wk-nav-badge-padding-x)");
        const label = ruleFor(".wk-layout-tab-expanded .wk-navrail__bottom .wk-navrail__space-icon-btn > .wk-navrail__item-label");
        expect(label).toContain("display: block");
        expect(label).toContain("min-width: 0");
        expect(label).toContain("overflow: hidden");
        expect(label).toContain("text-overflow: ellipsis");
        expect(ruleFor(".wk-layout-tab-expanded .wk-navrail__bottom .wk-navrail__space-icon-btn--unread > .wk-navrail__item-label"))
            .toContain("margin-right: var(--wk-sp-8)");
    });
});
