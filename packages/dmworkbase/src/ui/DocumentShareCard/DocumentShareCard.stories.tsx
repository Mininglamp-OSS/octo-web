import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { DocumentShareCard, type DocumentShareCardStrings } from "./index";

const meta: Meta<typeof DocumentShareCard> = {
  title: "UI/DocumentShareCard",
  component: DocumentShareCard,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof DocumentShareCard>;

const strings = (over: Partial<DocumentShareCardStrings> = {}): DocumentShareCardStrings => ({
  subtitle: "Sophie 创建",
  permissionLabel: "可查看",
  copyLabel: "复制链接",
  openLabel: "打开文档",
  ...over,
});

/** 文档 · 可查看 · 首屏预览。 */
export const DocReader: Story = {
  args: {
    kind: "doc",
    title: "Q3 产品路线图与发布计划",
    state: "reader",
    strings: strings(),
    preview: {
      type: "doc",
      heading: "一、发布节奏",
      paragraphs: [
        "本季度聚焦新手引导、权限模型和文档转发链路。",
        "7 月完成方案评审与开发联调，8 月进入灰度验证。",
      ],
    },
  },
};

/** 表格 · 可查看 · 首屏网格。 */
export const SheetReader: Story = {
  args: {
    kind: "sheet",
    title: "Q3 渠道投放与转化复盘",
    state: "reader",
    strings: strings({ subtitle: "林澈 创建" }),
    preview: {
      type: "sheet",
      headers: ["渠道", "目标", "本周状态"],
      rows: [
        ["自然流量", "激活", "进行中"],
        ["合作伙伴", "转化", "待复盘"],
        ["内容投放", "留资", "进行中"],
      ],
    },
  },
};

/** 画板 · 可编辑 · 节点首屏。 */
export const BoardWriter: Story = {
  args: {
    kind: "board",
    title: "Onboarding 用户旅程与关键触点",
    state: "writer",
    strings: strings({ subtitle: "Brooks 创建", permissionLabel: "可编辑" }),
    preview: { type: "board", nodes: ["首次进入", "创建 Space", "邀请成员", "完成协作"] },
  },
};

/** 无权限 → 需申请占位（预览不下发）。 */
export const NoAccess: Story = {
  args: {
    kind: "doc",
    title: "财务预算（受限）",
    state: "no_access",
    strings: strings({ subtitle: "Sophie 创建", permissionLabel: "需申请" }),
    placeholder: { icon: "lock", title: "需要访问权限", desc: "打开文档后可以申请访问" },
  },
};

/** 已失效 → 不可用占位。 */
export const Unavailable: Story = {
  args: {
    kind: "doc",
    title: "已归档的旧方案",
    state: "unavailable",
    strings: strings({ subtitle: undefined, permissionLabel: "不可用" }),
    placeholder: { icon: "warning", title: "文档不可用", desc: "该文档可能已被删除或归档" },
  },
};

/** 检查中 → 中性占位。 */
export const Checking: Story = {
  args: {
    kind: "doc",
    title: "Q3 产品路线图与发布计划",
    state: "checking",
    strings: strings({ permissionLabel: "检查中" }),
    placeholder: { icon: "info", title: "正在确认访问权限…" },
  },
};
