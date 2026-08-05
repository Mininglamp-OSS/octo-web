import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { SpaceMemberOption } from "../../bridge/spaceMembers/types";
import SpaceMemberSelect from "./index";

const labels = {
  searchPlaceholder: "Search by name, UID, or pinyin",
  loading: "Loading members...",
  empty: "No members available",
  noResults: "No matching members",
};

const members: SpaceMemberOption[] = [
  {
    uid: "u-alice",
    name: "Alice Chen",
    avatar: "https://api.dicebear.com/9.x/notionists/svg?seed=alice",
  },
  { uid: "u-zhangsan", name: "张三" },
  { uid: "u-bob", name: "Bob Li" },
];

const meta = {
  title: "UI/SpaceMemberSelect",
  component: SpaceMemberSelect,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: "calc(var(--wk-sp-12) * 8)" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    members,
    labels,
    onChange: () => undefined,
  },
} satisfies Meta<typeof SpaceMemberSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [selectedUid, setSelectedUid] = useState<string | null>("u-alice");
    return (
      <SpaceMemberSelect
        {...args}
        selectedUid={selectedUid}
        onChange={setSelectedUid}
      />
    );
  },
};

export const Loading: Story = {
  args: { state: { isLoading: true } },
};

export const Empty: Story = {
  args: { members: [] },
};

export const ErrorState: Story = {
  args: { state: { error: "Members could not be loaded" } },
};

export const Disabled: Story = {
  args: { selectedUid: "u-zhangsan", isDisabled: true },
};

export const LongList: Story = {
  args: {
    members: Array.from({ length: 30 }, (_, index) => ({
      uid: `member-${index + 1}`,
      name:
        index === 0
          ? "A member with a very long display name that must be truncated"
          : `Member ${index + 1}`,
    })),
  },
};
