import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { I18nProvider, i18n } from "@octo/base";
import DocumentSelector from ".";
import enUS from "../../i18n/en-US.json";
import zhCN from "../../i18n/zh-CN.json";

i18n.registerNamespace("summary", { "zh-CN": zhCN, "en-US": enUS });

const documents = [
  {
    docId: "doc-1",
    title: "项目 Alpha 复盘",
    docType: "doc" as const,
    updatedAt: Date.now(),
  },
  {
    docId: "doc-2",
    title: "客户反馈与下一步行动计划",
    docType: "html" as const,
    updatedAt: Date.now() - 86400000,
  },
];

const actions = {
  onSourceChange: () => {},
  onKeywordChange: () => {},
  onToggle: () => {},
  onRetry: () => {},
  onLoadMore: () => {},
  onConfirm: () => {},
  onCancel: () => {},
};

const meta: Meta<typeof DocumentSelector> = {
  title: "Summary/DocumentSelector",
  component: DocumentSelector,
  decorators: [
    (Story) => (
      <I18nProvider>
        <Story />
      </I18nProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DocumentSelector>;

export const Default: Story = {
  args: {
    visible: true,
    state: {
      source: "recent",
      keyword: "项目",
      items: documents,
      selected: [documents[0]],
      isLoading: false,
      error: null,
      maxSelect: 10,
      hasMore: true,
    },
    actions,
  },
};

export const Empty: Story = {
  args: {
    visible: true,
    state: {
      source: "recent",
      keyword: "",
      items: [],
      selected: [],
      isLoading: false,
      error: null,
      maxSelect: 10,
    },
    actions,
  },
};

export const Loading: Story = {
  args: {
    visible: true,
    state: {
      source: "recent",
      keyword: "项目",
      items: [],
      selected: [],
      isLoading: true,
      error: null,
      maxSelect: 10,
    },
    actions,
  },
};

export const Error: Story = {
  args: {
    visible: true,
    state: {
      source: "recent",
      keyword: "项目",
      items: [],
      selected: [],
      isLoading: false,
      error: "文档搜索失败",
      maxSelect: 10,
    },
    actions,
  },
};

export const LongText: Story = {
  args: {
    visible: true,
    state: {
      source: "mine",
      keyword: "方案",
      items: [
        {
          ...documents[0],
          title: "跨部门年度战略协同与客户成功交付方案".repeat(4),
        },
      ],
      selected: [],
      isLoading: false,
      error: null,
      maxSelect: 10,
    },
    actions,
  },
};

export const LoadingMore: Story = {
  args: {
    ...Default.args,
    state: { ...Default.args!.state!, isLoadingMore: true },
  },
};

export const LoadMoreError: Story = {
  args: {
    ...Default.args,
    state: { ...Default.args!.state!, loadMoreError: "加载更多失败，请重试" },
  },
};
