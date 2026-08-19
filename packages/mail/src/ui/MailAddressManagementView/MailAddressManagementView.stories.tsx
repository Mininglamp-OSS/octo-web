import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import MailAddressManagementView from ".";

const copy: Record<string, string> = {
  "mail.addresses.title": "Agent 邮箱管理",
  "mail.addresses.description":
    "为不同 Agent 创建独立的工作邮箱，邮件和接入权限互相隔离。",
  "mail.addresses.listTitle": "Agent 邮箱",
  "mail.addresses.count": "共 2 个邮箱",
  "mail.addresses.loading": "正在读取 Agent 邮箱…",
  "mail.addresses.copy": "复制邮箱地址",
  "mail.addresses.createTitle": "新建 Agent 邮箱",
  "mail.addresses.createDescription":
    "每个地址拥有独立的收件箱、发件记录和 Agent 接入权限。",
  "mail.addresses.localpart": "邮箱名称",
  "mail.addresses.placeholder": "例如 alerts",
  "mail.addresses.create": "创建邮箱",
  "mail.addresses.createHint":
    "可使用小写字母、数字、点、短横线和下划线；创建后可选择任意自己的 Bot 完成接入。",
  "mail.addresses.createLimitHint":
    "每个 Space 最多创建 2 个 Agent 邮箱，当前已创建 2 个。",
  "mail.agentMailboxes.unconnected": "未接入 Agent",
  "mail.agentMailboxes.connected": "已接入",
  "mail.agentMailboxes.connectedTo": "已接入 localhost",
  "mail.agentMailboxes.connect": "接入 Agent",
  "mail.agentMailboxes.current": "当前操作邮箱",
  "mail.agentMailboxes.switchTo": "切换到此邮箱",
  "mail.agentMailboxes.connectTitle": "Agent 一键接入",
  "mail.agentMailboxes.createdTitle": "地址已创建，去接入 Agent",
  "mail.agentMailboxes.createdAddress": "邮箱地址：support@demo.octo.test",
  "mail.agentMailboxes.setupMethod": "选择接入方式",
  "mail.agentMailboxes.openClawSetup": "OpenClaw 接入",
  "mail.agentMailboxes.cliSetup": "octo-cli 接入",
  "mail.agentMailboxes.copyPromptTitle": "复制提示词，发送给 Agent",
  "mail.agentMailboxes.copyPromptDescription":
    "请将以下提示词发送到你选择的 Bot 对话窗口，根据引导完成配置。",
  "mail.agentMailboxes.copyPrompt": "复制提示词",
  "mail.agentMailboxes.promptCopied": "提示词已复制",
  "mail.agentMailboxes.userChoosesAgent":
    "你把提示词发送给哪个 Bot，就由哪个 Bot 发起邮箱接入；邮箱页面不会替你选择 Bot。",
  "mail.agentMailboxes.disconnect": "解除接入",
  "mail.agentMailboxes.manualReviewMode": "人工确认",
  "mail.agentMailboxes.automaticSendMode": "自动发信",
  "mail.agentMailboxes.outboundMode": "发信模式",
  "mail.agentMailboxes.manualReviewDescription":
    "Agent 主动发信或回复邮件前都需要你确认。",
  "mail.agentMailboxes.automaticSendDescription":
    "Agent 可在规则和系统安全限制内自动发信。",
  "mail.rules.manage": "规则",
  "mail.actions.refresh": "刷新",
  "mail.actions.retry": "重试",
  "mail.actions.delete": "删除",
  "mail.error.title": "邮箱暂时不可用",
};

const meta = {
  title: "Mail/MailAddressManagementView",
  component: MailAddressManagementView,
  parameters: { layout: "fullscreen" },
  args: {
    mailboxes: [
      {
        id: "1",
        address: "demo@demo.octo.test",
        botId: "review_bot",
        agentName: "代码审查助手",
        connectState: "connected",
        outboundMode: "manual_confirmation",
      },
      {
        id: "2",
        address: "alerts@demo.octo.test",
        connectState: "unconnected",
        outboundMode: "manual_confirmation",
        deletable: true,
      },
    ],
    loading: false,
    submitting: false,
    error: "",
    actionError: "",
    localpart: "",
    domain: "demo.octo.test",
    maxMailboxes: 2,
    copiedId: "",
    createdMailbox: null,
    setupMethod: "openclaw",
    setupPrompt:
      "请使用已安装的 OCTO Agent Mail 插件，调用 mail_connect，并在我完成网页批准后调用 mail_connection_status。",
    promptCopied: false,
    disconnectingId: "",
    deletingId: "",
    updatingAutomationId: "",
    currentMailboxId: "1",
    t: (key: string) => copy[key] || key,
    onLocalpartChange: () => undefined,
    onCreate: () => undefined,
    onCopy: () => undefined,
    onCopySetupPrompt: () => undefined,
    onSetupMethodChange: () => undefined,
    onConnect: () => undefined,
    onDisconnect: () => undefined,
    onDelete: () => undefined,
    onAutomationChange: () => undefined,
    onSelectMailbox: () => undefined,
    onManageRules: () => undefined,
    onCloseSetup: () => undefined,
    onRefresh: () => undefined,
  },
} satisfies Meta<typeof MailAddressManagementView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Loading: Story = {
  args: { mailboxes: [], loading: true },
};
export const Error: Story = {
  args: { mailboxes: [], error: "The mail service did not respond." },
};
export const CreatedSetupDialog: Story = {
  args: {
    createdMailbox: {
      id: "3",
      address: "support@demo.octo.test",
      connectState: "unconnected",
      outboundMode: "manual_confirmation",
    },
  },
};
