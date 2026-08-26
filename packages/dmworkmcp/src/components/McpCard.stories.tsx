import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { i18n } from "@octo/base";
import McpCard from "./McpCard";
import type { McpListItem } from "../types/mcp";
import enUS from "../i18n/en-US.json";
import zhCN from "../i18n/zh-CN.json";
import "../index.css";

i18n.registerNamespace("mcp", {
  "zh-CN": zhCN,
  "en-US": enUS,
});
i18n.setLocale("zh-CN", { notify: false, persist: false });

const officialItem: McpListItem = {
  id: "official-search",
  name: "Search MCP",
  slogan: "平台维护的搜索服务，提供稳定的网页与新闻检索能力。",
  category: "search",
  tags: ["搜索", "热门"],
  toolCount: 6,
  icon: "🔎",
  visibility: "system",
  source: "system",
  creatorName: "Internal Admin",
  matchReasons: ["creator:Internal Admin", "tool:web_search"],
};

const normalItem: McpListItem = {
  ...officialItem,
  id: "community-search",
  name: "Community Search MCP",
  visibility: "public",
  source: "space",
  creatorName: "Alice",
  matchReasons: ["creator:Alice", "tool:web_search"],
};

const meta = {
  title: "MCP/McpCard",
  component: McpCard,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    item: officialItem,
    onClick: () => undefined,
  },
} satisfies Meta<typeof McpCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Official: Story = {};

export const Normal: Story = {
  args: { item: normalItem },
};

export const Comparison: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16, width: 360 }}>
      <McpCard item={officialItem} onClick={() => undefined} />
      <McpCard item={normalItem} onClick={() => undefined} />
    </div>
  ),
};
