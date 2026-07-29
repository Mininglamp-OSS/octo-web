import type { Meta, StoryObj } from "@storybook/react";
import React from "react";

import {
  ChannelSettingActionRow,
  ChannelSettingIconRow,
  ChannelSettingInlineEditRow,
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
    <div
      className="wk-channelsetting-content"
      style={{ width: "var(--wk-wdith-chat-channelsetting)", height: "auto" }}
    >
      <div className="wk-sections">
        <div className="wk-section">
          <div className="wk-channelsetting-section-rows">{children}</div>
        </div>
      </div>
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

export const LongContent: Story = {
  render: () => (
    <Frame>
      <ChannelSettingInfoRow
        title="群聊名称"
        value="这是一个用于检查超长群聊名称在加宽卡片中是否正确截断的项目讨论群"
        onClick={() => undefined}
      />
      <ChannelSettingInfoRow
        title="群公告"
        value="这里展示一段较长的多行公告内容，用于验证换行、卡片内边距以及深色主题下的文字层级。"
        multiline
        onClick={() => undefined}
      />
    </Frame>
  ),
};

export const InlineEditing: Story = {
  render: () => (
    <Frame>
      <ChannelSettingInlineEditRow
        title="备注"
        value=""
        placeholder="群聊的备注仅自己可见"
        maxCount={15}
        allowEmpty
        onSave={async () => undefined}
      />
    </Frame>
  ),
};
