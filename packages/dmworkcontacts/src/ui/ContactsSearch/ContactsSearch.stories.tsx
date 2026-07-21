import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import ContactsSearch from "./index";

const copy = {
  placeholder: "搜索联系人、AI 或群聊",
  emptyText: "未找到结果",
  contactsTitle: "联系人",
  groupsTitle: "群聊",
};

const meta: Meta<typeof ContactsSearch> = {
  title: "Contacts/ContactsSearch",
  component: ContactsSearch,
  parameters: {
    docs: {
      description: {
        component:
          "通讯录搜索的纯 UI，包括默认、结果、空状态和长文本状态。数据与点击行为由 Contacts 容器提供。",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ContactsSearch>;

const handlers = {
  onKeywordChange: () => undefined,
  onClear: () => undefined,
};

export const Default: Story = {
  args: {
    copy,
    state: { keyword: "", isSearching: false, hasResults: false },
    results: {},
    ...handlers,
  },
};

export const AllVariants: Story = {
  args: {
    copy,
    state: { keyword: "Octo", isSearching: true, hasResults: true },
    results: {
      contacts: <div className="wk-contacts-section-item">Octo AI</div>,
      groups: <div className="wk-contacts-section-item">Octo 群聊</div>,
    },
    ...handlers,
  },
};

export const States: Story = {
  args: {
    copy,
    state: { keyword: "missing", isSearching: true, hasResults: false },
    results: {},
    ...handlers,
  },
};

export const EdgeCases: Story = {
  args: {
    copy: { ...copy, placeholder: "搜索名称很长的联系人、AI 助手或群聊" },
    state: {
      keyword: "very-long-search-keyword-for-contact",
      isSearching: true,
      hasResults: true,
    },
    results: {
      contacts: (
        <div className="wk-contacts-section-item">名称非常长的联系人示例</div>
      ),
    },
    ...handlers,
  },
};
