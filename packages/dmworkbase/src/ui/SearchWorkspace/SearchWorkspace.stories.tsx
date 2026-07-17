import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Filter, X } from "lucide-react";
import SearchWorkspace from "./index";

const tabs = [
  { key: "all", label: "全部" },
  { key: "message", label: "消息" },
  { key: "media", label: "图片/视频" },
  { key: "file", label: "文件" },
];

const meta = {
  title: "UI/SearchWorkspace",
  component: SearchWorkspace,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={{
          width: "min(100%, 720px)",
          height: "560px",
          marginLeft: "auto",
          borderLeft: "1px solid var(--wk-border-subtle)",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    search: {
      value: "octo",
      placeholder: "输入关键字搜索",
      onChange: () => undefined,
    },
    tabs,
    activeTab: "all",
    onTabChange: () => undefined,
    children: (
      <div
        style={{
          padding: "var(--wk-sp-5)",
          color: "var(--wk-text-secondary)",
        }}
      >
        搜索结果区域
      </div>
    ),
  },
} satisfies Meta<typeof SearchWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FiltersActive: Story = {
  args: {
    actions: (
      <>
        <button type="button" aria-label="筛选">
          <Filter size={16} /> 筛选 3
        </button>
        <button type="button" aria-label="关闭">
          <X size={16} />
        </button>
      </>
    ),
  },
};

export const Loading: Story = {
  args: {
    children: (
      <div style={{ margin: "auto", color: "var(--wk-text-tertiary)" }}>
        搜索中...
      </div>
    ),
  },
};

export const Empty: Story = {
  args: {
    search: {
      value: "",
      placeholder: "输入关键字搜索",
      onChange: () => undefined,
    },
    children: (
      <div style={{ margin: "auto", color: "var(--wk-text-tertiary)" }}>
        输入关键字或使用筛选查找消息记录
      </div>
    ),
  },
};

export const Error: Story = {
  args: {
    error: "搜索失败，请稍后重试",
    children: null,
  },
};

export const LongText: Story = {
  args: {
    search: {
      value: "A very long search phrase used to verify constrained layouts",
      placeholder: "Search messages, contacts, groups, media, and files",
      trailing: "Up to 64 characters",
      onChange: () => undefined,
    },
    tabs: [
      { key: "all", label: "All results" },
      { key: "message", label: "Messages with very long labels" },
      { key: "media", label: "Images and videos" },
      { key: "file", label: "Files" },
    ],
  },
};
