import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import SummaryShareContent from ".";

const snapshot = {
    id: 1, task_id: 10, task_no: "ST10", space_id: "space-1",
    title: "本周增长实验复盘", source_name: "增长实验群", source_count: 1,
    participant_count: 8, message_count: 38,
    time_range_start: "2026-07-15T00:00:00Z", time_range_end: "2026-07-16T00:00:00Z",
    summary_mode: 1, result_version: 2, preview: "增长实验复盘",
    content: "本周讨论集中在新手引导实验和渠道转化。\n\n## 本周关键结论\n\n- 激活率提升约 **4.8%**。\n- 渠道 B 转化下降。\n\n## 事项状态\n\n| 事项 | 当前结论 | 下一步 |\n| --- | --- | --- |\n| 新手引导实验 | 激活率正向提升 | 继续观察 |\n| 渠道 B | 转化下降 | 拆分漏斗核对 |\n\n> 当前结论基于近 7 天群聊消息。",
    created_at: "2026-07-16T12:00:00Z",
};

const meta: Meta<typeof SummaryShareContent> = {
    title: "Summary/SummaryShareContent",
    component: SummaryShareContent,
    args: { snapshot, locale: "zh-CN", metaLabel: "总结范围", participantText: "8 人", messageText: "38 条消息" },
    decorators: [(Story) => <div style={{ width: 720, padding: "var(--wk-sp-6)", background: "var(--wk-bg-surface)" }}><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof SummaryShareContent>;
export const Default: Story = {};
export const Empty: Story = { args: { snapshot: { ...snapshot, content: "" } } };
export const LongContent: Story = { args: { snapshot: { ...snapshot, content: snapshot.content.repeat(10) } } };
