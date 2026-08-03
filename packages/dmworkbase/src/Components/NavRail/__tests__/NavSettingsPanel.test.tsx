import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChangelogMarkdown from "../ChangelogMarkdown";

describe("ChangelogMarkdown", () => {
    it("renders headings, emphasis, lists, links, and inline code", () => {
        const html = renderToStaticMarkup(
            <ChangelogMarkdown
                content={"## 版本说明\n\n**新增**\n\n- 支持列表\n- 查看 [官网](https://example.com)\n\n使用 `code`"}
            />,
        );

        expect(html).toContain("<h2>版本说明</h2>");
        expect(html).toContain("<strong>新增</strong>");
        expect(html).toContain("<ul>");
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain('target="_blank"');
        expect(html).toContain("<code>code</code>");
    });

    it("drops raw HTML and unsafe link targets", () => {
        const html = renderToStaticMarkup(
            <ChangelogMarkdown content={'<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))'} />,
        );

        expect(html).not.toContain("<script");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("<a");
        expect(html).toContain("危险链接");
    });
});
