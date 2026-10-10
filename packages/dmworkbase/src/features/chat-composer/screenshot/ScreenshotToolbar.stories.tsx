import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ScreenshotConversationPort } from "./port";
import { i18n } from "../../../i18n";
import { ScreenshotToolbar } from "./ScreenshotToolbar";
import zhCN from "./i18n/zh-CN.json";
import enUS from "./i18n/en-US.json";

i18n.registerNamespace("screenshot", { "zh-CN": zhCN, "en-US": enUS });
const conversation: ScreenshotConversationPort = {
  channel: () => ({ channelID: "story", channelType: 1 }),
  addPendingAttachments: async () => null,
  messageInputContext: () => ({ focus() {} }),
};
const meta = { title: "Chat/Composer/Screenshot", component: ScreenshotToolbar,
  args: { conversation, scopeKey: () => "story", host: { captureScreenshot: async () => ({ status: "cancelled" as const }) } },
} satisfies Meta<typeof ScreenshotToolbar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Capturing: Story = { args: { host: { captureScreenshot: () => new Promise(() => {}) } } };
export const PermissionDenied: Story = { args: { host: { captureScreenshot: async () => ({ status: "error", code: "permission" }) } } };
export const Unsupported: Story = { args: { host: {} } };
