// 回归背景（2026-09-23，本地混合 chat+文档总结 task ST20260923*）：
// 模型输出「段落行 + 紧跟 --- 」被 CommonMark 解析成 setext H2，整个引导段
// 变成 <h2>。历史上 .summary-content-markdown h2 用 display:flex + ::before
// counter 渲染编号徽章，段内 plain 与 **bold** 文本被拆成独立 flex item，
// 呈现成「01 | 段A | 加粗段 | 段B」多列错排。CSS 已改为 inline ::before
// （badge 与标题文本同行流式排列），本测试把修复钉住：h2 的直接子元素不得
// 再被 flex 布局拆列 —— 用 DOM 结构断言 h2 内文本与 strong 内联共存，
// 且 ::before 编号由 CSS 提供（jsdom 不算样式，通过样式表文本断言）。
// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render } from "@testing-library/react";
import SummaryContent from "../SummaryContent";

const here = dirname(fileURLToPath(import.meta.url));
const readCss = () => readFileSync(join(here, "../../index.css"), "utf8");

describe("SummaryContent h2 layout contract", () => {
    it("renders mixed plain+bold h2 content as inline children (no flex splitting)", () => {
        // ATX h2 with an inline bold run — the shape a setext-misparsed
        // paragraph would produce after backend normalization or directly
        // from the model. All runs must stay in one inline heading flow.
        const { container } = render(
            <SummaryContent
                content={
                    "## 根据提供的 45 条混合证据（含聊天记录与文档），现将项目当前进展按 **已完成、进行中、风险阻塞、下一步计划** 四类整理如下：\n"
                }
            />
        );
        const h2 = container.querySelector(".summary-content-markdown h2");
        expect(h2).not.toBeNull();
        // The strong run must stay inside the same heading flow as its
        // surrounding text (inline siblings), not be lifted into separate
        // flex items by heading-level layout.
        expect(h2!.querySelector("strong")).not.toBeNull();
        expect(h2!.textContent).toContain("现将项目当前进展按");
        expect(h2!.textContent).toContain("已完成、进行中、风险阻塞、下一步计划");
        expect(h2!.textContent).toContain("四类整理如下");
    });

    it("keeps the h2 numbering badge inline in CSS (counter + nbsp, no flex on h2)", () => {
        // The regression shipped as a CSS change; jsdom cannot compute layout,
        // so pin the stylesheet contract directly: h2 must not be display:flex
        // and the ::before badge must carry its own inline spacing.
        const css = readCss();
        const h2Block = css.match(/\.summary-content-markdown h2 \{[\s\S]*?\n\}/);
        expect(h2Block).not.toBeNull();
        expect(h2Block![0]).not.toContain("display: flex");
        const beforeBlock = css.match(
            /\.summary-content-markdown h2::before \{[\s\S]*?\n\}/
        );
        expect(beforeBlock).not.toBeNull();
        expect(beforeBlock![0]).toContain("decimal-leading-zero");
        expect(beforeBlock![0]).toContain("\\00a0");
        expect(beforeBlock![0]).not.toContain("flex:");
    });
});
