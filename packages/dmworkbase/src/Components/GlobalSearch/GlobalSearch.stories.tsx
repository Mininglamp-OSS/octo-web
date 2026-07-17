import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Filter } from "lucide-react";
import SearchWorkspace from "../../ui/SearchWorkspace";
import "../../features/globalSearch/global-search-panel.css";

interface GlobalSearchPreviewProps {
  keyword?: string;
  state?: "ready" | "loading" | "empty" | "error";
  filters?: number;
  longText?: boolean;
}

function GlobalSearchPreview({
  keyword = "octo",
  state = "ready",
  filters = 0,
  longText = false,
}: GlobalSearchPreviewProps) {
  const tabs = [
    {
      key: "contacts",
      label: longText ? "Contacts and external members" : "联系人",
    },
    {
      key: "groups",
      label: longText ? "Groups and discussion spaces" : "群组",
    },
    {
      key: "messages",
      label: longText ? "Messages in all conversations" : "聊天",
    },
    { key: "files", label: longText ? "Files and attachments" : "文件" },
  ];
  return (
    <div style={{ height: "640px" }}>
      <SearchWorkspace
        search={{
          value: keyword,
          placeholder: longText
            ? "Search contacts, groups, messages, or files"
            : "搜索联系人、群组、聊天或文件",
          onChange: () => undefined,
        }}
        tabs={tabs}
        activeTab="messages"
        onTabChange={() => undefined}
        error={state === "error" ? "搜索失败，请稍后重试" : undefined}
        actions={
          <button type="button" className="wk-search-tabs__filter-trigger">
            <Filter size={16} />
            {filters > 0 && (
              <span className="wk-search-tabs__filter-count">{filters}</span>
            )}
            筛选
          </button>
        }
      >
        <div
          style={{
            margin: state === "ready" ? undefined : "auto",
            padding: "var(--wk-sp-5)",
            color: "var(--wk-text-secondary)",
          }}
        >
          {state === "loading" && "搜索中..."}
          {state === "empty" && "没有找到相关结果"}
          {state === "error" && "可修改关键字后重试"}
          {state === "ready" && (
            <>
              <p>OCTO 研发内部群 · 39 条相关聊天记录</p>
              <p>
                {longText
                  ? "A very long matching result used to verify layout behavior"
                  : "搜索结果内容"}
              </p>
            </>
          )}
        </div>
      </SearchWorkspace>
    </div>
  );
}

const meta = {
  title: "Chat/GlobalSearch",
  component: GlobalSearchPreview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GlobalSearchPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const FiltersOpen: Story = { args: { filters: 3 } };
export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = { args: { state: "empty", keyword: "not-found" } };
export const Error: Story = { args: { state: "error" } };
export const LongText: Story = { args: { longText: true } };
