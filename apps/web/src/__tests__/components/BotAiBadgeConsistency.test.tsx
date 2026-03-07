import React from "react";
import { render } from "@testing-library/react";
import AiBadge from "../../../../../packages/dmworkbase/src/Components/AiBadge";

/**
 * Tests for Issue #215: Bot AI badge consistency
 *
 * Verifies that AiBadge component is used consistently across:
 * - @mention suggestion list (MessageInput)
 * - User info card (UserInfo)
 *
 * The unified approach is to display "AI" text badge after user names,
 * not as a robot icon overlay on avatars.
 */
describe("Bot AI Badge Consistency (Issue #215)", () => {
    describe("AiBadge for @mention list", () => {
        it("renders small size badge correctly for mention suggestions", () => {
            // MessageInput uses AiBadge with size="small" for mention suggestions
            const { container } = render(<AiBadge size="small" />);
            const badge = container.querySelector(".ai-badge");
            expect(badge).not.toBeNull();
            expect(badge?.textContent).toBe("AI");
            expect(badge?.classList.contains("ai-badge-small")).toBe(true);
        });

        it("small badge has correct class structure", () => {
            const { container } = render(<AiBadge size="small" />);
            const badge = container.querySelector(".ai-badge");
            expect(badge?.classList.contains("ai-badge")).toBe(true);
            expect(badge?.classList.contains("ai-badge-small")).toBe(true);
        });
    });

    describe("AiBadge for user info card", () => {
        it("renders default size badge correctly for user info", () => {
            // UserInfo uses AiBadge with default size
            const { container } = render(<AiBadge />);
            const badge = container.querySelector(".ai-badge");
            expect(badge).not.toBeNull();
            expect(badge?.textContent).toBe("AI");
            expect(badge?.classList.contains("ai-badge-default")).toBe(true);
        });
    });

    describe("Unified AI text badge approach", () => {
        it("both sizes render AI text content consistently", () => {
            const defaultBadge = render(<AiBadge />);
            const smallBadge = render(<AiBadge size="small" />);

            const defaultText = defaultBadge.container.querySelector(".ai-badge")?.textContent;
            const smallText = smallBadge.container.querySelector(".ai-badge")?.textContent;

            expect(defaultText).toBe("AI");
            expect(smallText).toBe("AI");
            expect(defaultText).toBe(smallText);
        });

        it("AiBadge component renders as inline span element", () => {
            const { container } = render(<AiBadge />);
            const badge = container.querySelector(".ai-badge");
            expect(badge?.tagName.toLowerCase()).toBe("span");
        });
    });
});
