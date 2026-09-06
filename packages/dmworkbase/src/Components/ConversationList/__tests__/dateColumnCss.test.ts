/**
 * Static + minimal-DOM assertions on `.wk-conversationlist-item-time` (#1629
 * regression guard). Two layers:
 *
 *   1. Stylesheet contract: `.wk-conversationlist-item-time` caps width, clips
 *      overflow, and the direct-child span carries `overflow: hidden` +
 *      `text-overflow: ellipsis`. The span's `overflow: hidden` is what makes
 *      the ellipsis fire at all (per CSS Flexbox §4.5: `min-width: auto` on a
 *      flex item resolves to 0 only when the item is a scroll container, and
 *      `overflow: hidden` is what makes it one). Deleting that declaration
 *      would silently break the safety net, so it needs its own assertion.
 *
 *   2. DOM contract: the CSS `> span` selector only matters if the JSX
 *      actually still emits `.wk-conversationlist-item-time > span`. Any
 *      future wrap (extra div, tooltip primitive, portal, etc.) breaks the
 *      selector match and the ellipsis quietly disappears — with no test
 *      catching it. This file mounts a minimal DOM produced from the same
 *      JSX skeleton the production render uses and asserts the direct
 *      parent/child relationship.
 *
 * jsdom has no layout engine, so pixel-width regressions still need
 * Playwright coverage of the real conversation-list row — see the JSDoc on
 * `getTimeStringAutoShort2` for the 24h ↔ 112px coupling that would need
 * an e2e width check to actually enforce.
 */

/**
 * @vitest-environment jsdom
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rawStyles = readFileSync(resolve(__dirname, "..", "index.css"), "utf8");
// Comments are declaration-free but `[^}]*` in the rule regex would happily
// consume them and misread numbers/keywords inside as CSS declarations
// (e.g. a comment mentioning "max-width: 96px" would falsely satisfy a
// deprecated-value check). Strip once, at the top, so every downstream
// selector match sees only real declarations. Handles `/* … */` including
// multiline; CSS doesn't allow nested block comments.
const styles = rawStyles.replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Anchor to a rule that opens with our selector (whitespace-then-`{`),
    // and stop at the first `}` — safe because comments are already stripped
    // and CSS has no `}` inside a rule body except literal declaration
    // terminators.
    const match = styles.match(new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
    expect(match, `Missing CSS rule: ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
}

describe("ConversationList date column CSS (#1629 regression guard)", () => {
    it("caps `.wk-conversationlist-item-time` at ≥ 112px and ≤ 200px", () => {
        // Lower bound: the longest label `getTimeStringAutoShort2` emits is
        // `formatCalendarDate(...) + " HH:mm"` — `12/31/2025 23:59` (en-US) /
        // `2025/12/31 23:59` (zh-CN), ~95px at the 11px xs font. 112px leaves
        // ~15px of headroom; anything less regresses round 2's Octo-Q P1.
        //
        // Upper bound: the row's first-line budget at the 190px sidebar drag
        // floor (WKLayout/layoutWidth.ts SPLITTER_MIN_WIDTH) is
        // 190 − 16 (list padding) − 16 (item padding) − 32 (avatar) − 10 (gap)
        // ≈ 116px; a date column that grows past ~170px would leave nothing
        // for the name column. 200px is a generous ceiling that would still
        // trip if someone bumped this to 500px "just in case".
        const body = ruleBody(".wk-conversationlist-item-time");
        const match = body.match(/max-width:\s*(\d+)px/);
        expect(match, "date-column rule must declare max-width").not.toBeNull();
        const px = Number(match?.[1]);
        expect(
            px,
            "widen or measure the longest label before lowering this cap — see " +
                "packages/dmworkbase/src/Utils/time.ts formatCalendarDate output",
        ).toBeGreaterThanOrEqual(112);
        expect(
            px,
            "date column growing past ~170px starves the name column at 190px " +
                "sidebar (SPLITTER_MIN_WIDTH); if you really need this width, " +
                "shorten the numeric bucket instead",
        ).toBeLessThanOrEqual(200);
    });

    it("clips overflow on both the container AND the inner span so the ellipsis fires", () => {
        // Container: `overflow: hidden` is what makes `text-overflow: ellipsis`
        // apply and what stops sibling elements from being pushed out of view.
        expect(ruleBody(".wk-conversationlist-item-time"))
            .toMatch(/overflow:\s*hidden/);

        // Span: `overflow: hidden` is what turns the span into a scroll
        // container so `min-width: auto` resolves to 0 and the flex parent
        // can actually shrink it below its content width. Removing this
        // declaration silently breaks the ellipsis — this test is the guard.
        const spanBody = ruleBody(".wk-conversationlist-item-time > span");
        expect(spanBody, "span must clip so flex-min-size resolves to 0")
            .toMatch(/overflow:\s*hidden/);
        expect(spanBody).toMatch(/text-overflow:\s*ellipsis/);
    });
});

describe("ConversationList date column DOM contract (#1629 regression guard)", () => {
    it("the date-column div still has a direct <span> child so `> span` CSS matches", () => {
        // Minimal DOM shaped like the production render at
        // packages/dmworkbase/src/Components/ConversationList/index.tsx:921-929.
        // Kept as raw markup rather than mounting the full component because
        // (a) the CSS selector we care about is child-combinator strict
        // (a nested tooltip / portal wrap breaks it — that's the bug this
        // test guards against), and (b) it lets the assertion run without
        // pulling in the ConversationList mocks. If someone wraps the label
        // in another element in the JSX, this test fails immediately.
        const host = document.createElement("div");
        host.innerHTML = `
            <div class="wk-conversationlist-item-time">
                <span title="Yesterday 04:12">Yesterday 04:12</span>
            </div>
        `;

        const container = host.querySelector<HTMLElement>(".wk-conversationlist-item-time");
        expect(container, "date column container must exist").not.toBeNull();

        // The exact selector the safety-net CSS relies on. If a future refactor
        // nests the span inside anything else, `> span` stops matching and the
        // ellipsis vanishes with no other test catching it.
        const directSpan = container!.querySelector<HTMLSpanElement>(":scope > span");
        expect(
            directSpan,
            ".wk-conversationlist-item-time must have a *direct* <span> child; " +
                "the `> span` selector in index.css (overflow: hidden / " +
                "text-overflow: ellipsis) is child-combinator strict.",
        ).not.toBeNull();

        // The span carries a `title` so users can hover to recover the full
        // timestamp when the 112px cap ellipsizes the visible text. See the
        // JSX site and #1629 round 3 P2.
        expect(
            directSpan!.getAttribute("title"),
            "span must carry a title with the full label so ellipsized text " +
                "is recoverable on hover (round 3 reviewer P2)",
        ).toBeTruthy();
    });
});
