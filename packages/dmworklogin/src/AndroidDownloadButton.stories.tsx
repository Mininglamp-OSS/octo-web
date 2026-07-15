import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import {
  AndroidDownloadButton,
  AndroidDownloadPopoverContent,
} from "./AndroidDownloadButton";
import "./login.css";

const meta: Meta<typeof AndroidDownloadButton> = {
  title: "Login/AndroidDownloadButton",
  component: AndroidDownloadButton,
  parameters: {
    docs: {
      description: {
        component:
          "登录页 Android 下载入口。悬停入口展示当前部署域名下的 APK 下载二维码，并保留 GitHub 最新 Release 备用入口。",
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          display: "grid",
          minHeight: 320,
          placeItems: "center",
          background: "var(--wk-bg-surface)",
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AndroidDownloadButton>;

export const Trigger: Story = {};

export const PopoverContent: Story = {
  render: () => (
    <div className="wk-login-mobile-download-popover-shell">
      <AndroidDownloadPopoverContent />
    </div>
  ),
};
