import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import {
  IOSDownloadButton,
  IOSDownloadPopoverContent,
} from "./IOSDownloadButton";
import "./login.css";

const meta: Meta<typeof IOSDownloadButton> = {
  title: "Login/IOSDownloadButton",
  component: IOSDownloadButton,
  parameters: {
    docs: {
      description: {
        component:
          "登录页 iOS 二维码入口。悬停或点击入口只展示动态生成的 TestFlight 二维码，触发按钮本身不执行跳转。",
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
type Story = StoryObj<typeof IOSDownloadButton>;

export const Trigger: Story = {};

export const PopoverContent: Story = {
  render: () => (
    <div className="wk-login-mobile-download-popover-shell">
      <IOSDownloadPopoverContent />
    </div>
  ),
};
