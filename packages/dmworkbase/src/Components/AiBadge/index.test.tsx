import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiBadge from "./index";

describe("AiBadge", () => {
    it("keeps AI as the default label", () => {
        const html = renderToStaticMarkup(<AiBadge />);
        expect(html).toContain(">AI</span>");
        expect(html).toContain("ai-badge-default");
    });

    it("renders a product-specific label and forwards span accessibility attributes", () => {
        const html = renderToStaticMarkup(
            <AiBadge
                size="small"
                className="docs-bot-badge"
                title="机器人"
                aria-label="机器人"
            >
                机器人
            </AiBadge>,
        );
        expect(html).toContain("ai-badge-small docs-bot-badge");
        expect(html).toContain('title="机器人"');
        expect(html).toContain('aria-label="机器人"');
        expect(html).toContain(">机器人</span>");
        expect(html).not.toContain(">AI</span>");
    });
});
