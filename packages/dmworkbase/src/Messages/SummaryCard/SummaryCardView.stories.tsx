import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SummaryCardView } from "./SummaryCardView";

const meta: Meta<typeof SummaryCardView> = {
  title: "Messages/SummaryCardView",
  component: SummaryCardView,
  args: {
    title: "本周增长实验复盘",
    preview: "新手引导 A/B 实验使激活率提升约 4.8%，但高价值客户样本量仍不足。渠道 B 的付费转化下降，主要集中在行业标签不准和试用期触达偏慢。",
    meta: { sourceName: "增长实验群", timeRange: "覆盖 7月15日 至 7月16日", participantText: "8 人参与", messageText: "38 条消息" },
    labels: { generated: "总结已生成", ai: "AI 总结", sourcePrefix: "总结自", sourceSuffix: "的群聊", viewAll: "查看全部", viewDetail: "查看总结详情", footer: "智能总结" },
    onViewAll: () => {},
    onViewDetail: () => {},
  },
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof SummaryCardView>;

export const Default: Story = {};

export const EmptyPreview: Story = {
  args: { preview: "" },
};

export const MissingMetadata: Story = {
  args: {
    meta: { sourceName: "", timeRange: "覆盖 7月15日 至 7月16日", participantText: "", messageText: "38 条消息" },
  },
};

export const LongContent: Story = {
  args: {
    title: "跨区域增长实验与高价值客户转化漏斗阶段性复盘及下一步行动建议",
    meta: { sourceName: "全球增长策略与商业化实验协作群", timeRange: "覆盖 7月15日 至 7月16日", participantText: "8 人参与", messageText: "38 条消息" },
    preview: "这是一段很长的总结预览，用于验证卡片在极端内容下仍然保持稳定的三行截断、按钮位置和整体节奏。正文继续增加也不会把消息卡片无限撑高。",
  },
};

export const English: Story = {
  args: {
    title: "Weekly growth experiment review",
    meta: { sourceName: "Growth experiments", timeRange: "Jul 15 – Jul 16", participantText: "8 participants", messageText: "38 messages" },
    labels: { generated: "Summary generated", ai: "AI summary", sourcePrefix: "Summarized from ", sourceSuffix: "", viewAll: "View all", viewDetail: "View summary details", footer: "Smart summary" },
  },
};
