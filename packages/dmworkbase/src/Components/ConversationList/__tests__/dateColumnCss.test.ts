/**
 * Static assertions on `ConversationList/index.css` that pin the date-column
 * layout invariants #1629 introduced. These are stylesheet-string checks, not
 * layout measurements — jsdom has no layout engine, so pixel-width regressions
 * would only be catchable end-to-end (Playwright / real browser). What this
 * file *can* pin is the intent that appears in the CSS itself:
 *
 *   1. `.wk-conversationlist-item-time` carries `max-width` and it is at
 *      least 112px. Round 2 reviewer Octo-Q flagged that the earlier 96px
 *      cap was narrower than the longest label `getTimeStringAutoShort2`
 *      still produces (`12/31/2025 23:59` / `2025/12/31 23:59`), which at
 *      `--wk-text-size-xs: 11px` measures ~95px in the standard fallback
 *      fonts. 112px leaves ~15px of headroom over that longest label. Any
 *      future tightening below 112px trips this test.
 *   2. The container clips overflow (`overflow: hidden`) AND the inner span
 *      carries `text-overflow: ellipsis` — the container's own
 *      `text-overflow` is a no-op on a flex parent, so the child rule is the
 *      one that actually ellipsizes.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(__dirname, "..", "index.css"), "utf8");

function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, `Missing CSS rule: ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
}

describe("ConversationList date column layout (#1629 regression guard)", () => {
    it("caps `.wk-conversationlist-item-time` at ≥ 112px so the longest label the helper still emits fits", () => {
        // The longest label `getTimeStringAutoShort2` currently produces is
        // `formatCalendarDate(...) + " HH:mm"`, e.g. `12/31/2025 23:59`
        // (en-US) or `2025/12/31 23:59` (zh-CN). Reviewer measured ~95px at
        // 11px xs font in the standard fallback fonts; the 96px cap this PR
        // shipped in round 1 truncated the trailing minutes on the >7-day
        // and cross-year buckets. 112px is the tightest safe value.
        const body = ruleBody(".wk-conversationlist-item-time");
        const match = body.match(/max-width:\s*(\d+)px/);
        expect(match, "date-column rule must declare max-width").not.toBeNull();
        const px = Number(match?.[1]);
        expect(
            px,
            "widen or measure the longest label before lowering this cap — see " +
                "packages/dmworkbase/src/Utils/time.ts formatCalendarDate output",
        ).toBeGreaterThanOrEqual(112);
    });

    it("the container clips overflow and the inner span does the ellipsis", () => {
        expect(ruleBody(".wk-conversationlist-item-time"))
            .toMatch(/overflow:\s*hidden/);
        expect(ruleBody(".wk-conversationlist-item-time > span"))
            .toMatch(/text-overflow:\s*ellipsis/);
    });
});
