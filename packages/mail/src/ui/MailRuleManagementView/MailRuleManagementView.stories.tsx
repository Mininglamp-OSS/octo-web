import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import MailRuleManagementView from ".";

const copy: Record<string, string> = {
  "mail.actions.back": "返回",
  "mail.actions.refresh": "刷新",
  "mail.actions.retry": "重试",
  "mail.actions.delete": "删除",
  "mail.actions.cancel": "取消",
  "mail.actions.save": "保存",
  "mail.rules.title": "邮件规则",
  "mail.rules.description": "管理 support@example.com 收到邮件后的自动流转",
  "mail.rules.create": "新建规则",
  "mail.rules.securityTitle": "规则只负责邮件流转",
  "mail.rules.securityDescription":
    "邮件内容不会获得 Agent 工具或命令执行权限。",
  "mail.rules.listTitle": "规则列表",
  "mail.rules.count": "共 2 条规则",
  "mail.rules.loading": "正在读取规则…",
  "mail.rules.emptyTitle": "还没有邮件规则",
  "mail.rules.emptyDescription": "创建一条规则，让符合条件的邮件自动转发。",
  "mail.rules.enabled": "已启用",
  "mail.rules.disabled": "已停用",
  "mail.rules.enable": "启用规则",
  "mail.rules.disable": "停用规则",
  "mail.rules.edit": "编辑规则",
  "mail.rules.when": "当",
  "mail.rules.then": "则",
  "mail.rules.from": "发件人",
  "mail.rules.subject": "主题",
  "mail.rules.equals": "等于",
  "mail.rules.contains": "包含",
  "mail.rules.summary.and": "，并且",
  "mail.rules.summary.forward": "转发到 owner@example.com",
  "mail.error.title": "邮箱暂时不可用",
};

const meta = {
  title: "Mail/MailRuleManagementView",
  component: MailRuleManagementView,
  parameters: { layout: "fullscreen" },
  args: {
    mailbox: {
      id: "2",
      address: "support@example.com",
      agentName: "Support Bot",
      connectState: "connected",
    },
    rules: [
      {
        id: "1",
        name: "VIP 客户紧急邮件",
        enabled: true,
        priority: 10,
        matchMode: "all",
        conditions: [
          { field: "from", operator: "equals", value: "vip@example.com" },
          { field: "subject", operator: "contains", value: "紧急" },
        ],
        matchFrom: "vip@example.com",
        matchSubject: "紧急",
        forwardTargets: ["owner@example.com"],
        createdAt: "2026-07-29T09:00:00Z",
        updatedAt: "2026-07-29T09:00:00Z",
      },
      {
        id: "2",
        name: "账单邮件",
        enabled: false,
        priority: 0,
        matchMode: "all",
        conditions: [
          { field: "subject", operator: "contains", value: "invoice" },
        ],
        matchSubject: "invoice",
        forwardTargets: ["finance@example.com"],
        createdAt: "2026-07-29T09:00:00Z",
        updatedAt: "2026-07-29T09:00:00Z",
      },
    ],
    loading: false,
    error: "",
    actionError: "",
    saving: false,
    deletingId: "",
    t: (key: string, options?: { values?: Record<string, unknown> }) =>
      key === "mail.rules.summary.condition"
        ? `${String(options?.values?.field)}${String(
            options?.values?.operator
          )}${String(options?.values?.value)}`
        : copy[key] || key,
    onBack: () => undefined,
    onRefresh: () => undefined,
    onSave: async () => true,
    onSetEnabled: () => undefined,
    onDelete: () => undefined,
  },
} satisfies Meta<typeof MailRuleManagementView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { rules: [] } };
export const Loading: Story = {
  args: { rules: [], loading: true },
};
export const Error: Story = {
  args: { rules: [], error: "The mail service timed out." },
};
