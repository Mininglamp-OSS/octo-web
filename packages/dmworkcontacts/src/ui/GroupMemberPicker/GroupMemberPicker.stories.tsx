import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";

import GroupMemberPicker from "./index";

const candidates = [
  { uid: "alice", name: "Alice" },
  { uid: "assistant", name: "Octo Assistant", robot: true },
  { uid: "long", name: "A very long member name used to verify truncation" },
];

const meta: Meta<typeof GroupMemberPicker> = {
  title: "Contacts/GroupMemberPicker",
  component: GroupMemberPicker,
};
export default meta;
type Story = StoryObj<typeof GroupMemberPicker>;

const common = {
  mode: "createGroup" as const,
  candidates,
  selected: [],
  selectedUids: new Set<string>(),
  keyword: "",
  copy: {
    searchPlaceholder: "Search",
    selectedTitle: "0 selected",
    confirm: "Confirm",
    cancel: "Cancel",
  },
  avatarForUid: (uid: string) => `https://example.com/avatar/${uid}.png`,
  actions: {
    onKeywordChange: () => undefined,
    onToggleMember: () => undefined,
    onCancel: () => undefined,
    onConfirm: () => undefined,
  },
};

export const Default: Story = { args: common };

export const Selected: Story = {
  args: {
    ...common,
    selected: candidates.slice(0, 2),
    selectedUids: new Set(["alice", "assistant"]),
    copy: { ...common.copy, selectedTitle: "2 selected" },
  },
};

export const Empty: Story = {
  args: { ...common, candidates: [], keyword: "missing" },
};

export const LongText: Story = {
  args: {
    ...common,
    selected: [candidates[2]],
    selectedUids: new Set(["long"]),
    copy: { ...common.copy, selectedTitle: "1 selected" },
  },
};

export const AddMembers: Story = {
  args: {
    ...common,
    mode: "addMember",
    copy: { ...common.copy, selectedTitle: "Select contacts" },
  },
};
