import type { Meta, StoryObj } from "@storybook/react";
import React from "react";

import {
  ChannelSettingActionRow,
  ChannelSettingIconRow,
  ChannelSettingInfoRow,
  ChannelSettingToggleRow,
} from ".";

const meta: Meta = {
  title: "UI/ChannelSettingRows",
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: "var(--wk-wdith-chat-channelsetting)" }}>
      {children}
    </div>
  );
}

export const Information: Story = {
  render: () => (
    <Frame>
      <ChannelSettingInfoRow
        title="群聊名称"
        value="项目讨论群"
        onClick={() => undefined}
      />
      <ChannelSettingInfoRow
        title="群公告"
        value="这里展示多行公告内容"
        multiline
        onClick={() => undefined}
      />
      <ChannelSettingIconRow
        title="群二维码"
        icon={<span aria-hidden>▦</span>}
        onClick={() => undefined}
      />
    </Frame>
  ),
};

export const Preferences: Story = {
  render: () => (
    <Frame>
      <ChannelSettingToggleRow
        title="消息免打扰"
        checked
        onChange={() => undefined}
      />
      <ChannelSettingToggleRow
        title="聊天置顶"
        checked={false}
        onChange={() => undefined}
      />
    </Frame>
  ),
};

export const Actions: Story = {
  render: () => (
    <Frame>
      <ChannelSettingActionRow title="取消归档" onClick={() => undefined} />
      <ChannelSettingActionRow
        title="删除并退出"
        danger
        onClick={() => undefined}
      />
    </Frame>
  ),
};
