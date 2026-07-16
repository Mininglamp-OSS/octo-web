import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import GlobalChatSearchLayout from "./index";

const conversations = [
  {
    key: "group:octo",
    name: "OCTO 研发内部群",
    countLabel: "39 条相关聊天记录",
    avatarUrl: "https://api.dicebear.com/9.x/shapes/svg?seed=octo",
  },
  {
    key: "thread:native",
    name: "IM Native 小分队",
    subtitle: "客户端协作群 · 子区",
    countLabel: "28 条相关聊天记录",
    avatarUrl: "https://api.dicebear.com/9.x/shapes/svg?seed=native",
    isThread: true,
  },
  {
    key: "dm:li",
    name: "李信茹",
    countLabel: "2 条相关聊天记录",
    avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=li",
  },
];

const meta = {
  title: "UI/GlobalChatSearchLayout",
  component: GlobalChatSearchLayout,
  parameters: { layout: "fullscreen" },
  args: {
    conversations,
    selectedKey: conversations[0].key,
    labels: {
      filterTitle: "筛选",
      startHint: "输入关键词或选择发送人开始搜索",
      emptyHint: "没有找到相关聊天记录",
      errorHint: "搜索失败，请稍后重试",
      truncatedHint: "仅展示最近匹配的会话",
    },
    state: { status: "ready" },
    result: {
      countLabel: "39 条相关聊天记录",
      content: (
        <div style={{ padding: "var(--wk-sp-4)" }}>
          <p>Gitlab CI · 7/14 16:53</p>
          <p>octo-web 同步中，等待 CI Changes</p>
        </div>
      ),
    },
    onSelectConversation: () => undefined,
  },
} satisfies Meta<typeof GlobalChatSearchLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FiltersOpen: Story = {
  args: {
    filterContent: (
      <div style={{ padding: "var(--wk-sp-4)" }}>
        发送人 / 包含成员 / 聊天类型 / 消息类型
      </div>
    ),
  },
};

export const ThreadSelected: Story = {
  args: {
    selectedKey: conversations[1].key,
    result: {
      countLabel: "28 条相关聊天记录",
      content: (
        <div style={{ padding: "var(--wk-sp-4)" }}>
          <p>Jeff · 刚刚</p>
          <p>子区中的匹配聊天记录</p>
        </div>
      ),
    },
  },
};

export const Empty: Story = {
  args: {
    conversations: [],
    selectedKey: undefined,
    state: { status: "ready" },
    result: {
      content: null,
    },
  },
};

export const Loading: Story = {
  args: {
    conversations: [],
    selectedKey: undefined,
    state: { status: "loading" },
    result: {
      content: null,
    },
  },
};
