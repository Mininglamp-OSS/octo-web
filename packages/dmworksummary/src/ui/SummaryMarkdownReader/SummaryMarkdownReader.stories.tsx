import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import SummaryMarkdownReader from ".";

const meta: Meta<typeof SummaryMarkdownReader> = {
    title: "Summary/SummaryMarkdownReader",
    component: SummaryMarkdownReader,
    args: {
        outlineLabel: "本文目录",
        content: "## 关键结论\n\n- 已完成引用阅读体验 [1]\n- [x] 支持任务列表\n\n### 数据\n\n| 指标 | 结果 |\n| --- | --- |\n| 完成率 | 90% |\n\n> 结论来自所选聊天。",
        citations: [],
    },
    decorators: [(Story) => <div style={{ padding: "var(--wk-sp-6)", background: "var(--wk-bg-surface)" }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof SummaryMarkdownReader>;
export const Default: Story = {};
