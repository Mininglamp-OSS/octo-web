import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";

import GroupCreateDialog from "./index";

const members = [
  { uid: "alice", name: "Alice" },
  { uid: "assistant", name: "Octo Assistant", robot: true },
];

const meta: Meta<typeof GroupCreateDialog> = {
  title: "Contacts/GroupCreateDialog",
  component: GroupCreateDialog,
};
export default meta;
type Story = StoryObj<typeof GroupCreateDialog>;

const common = {
  isOpen: true,
  copy: {
    title: "New group chat",
    avatarLabel: "Group avatar",
    editAvatar: "Edit avatar",
    nameLabel: "Group name",
    namePlaceholder: "e.g. Project name",
    membersLabel: "Select members",
    confirm: "Confirm",
    cancel: "Cancel",
  },
  form: {
    groupName: "Project Octo",
    avatarText: "PO",
    avatarColorIndex: 1,
    maxNameLength: 20,
    isAvatarEditorOpen: false,
  },
  memberPicker: {
    mode: "createGroup" as const,
    candidates: members,
    selected: [members[0]],
    selectedUids: new Set(["alice"]),
    keyword: "",
    copy: {
      searchPlaceholder: "Search",
      selectedTitle: "1 selected",
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
  },
  actions: {
    onCancel: () => undefined,
    onConfirm: () => undefined,
    onGroupNameChange: () => undefined,
    onOpenAvatarEditor: () => undefined,
    onCloseAvatarEditor: () => undefined,
    onSaveAvatar: () => undefined,
  },
};

export const CreateGroup: Story = { args: { ...common, mode: "createGroup" } };

export const AddMembers: Story = {
  args: {
    ...common,
    mode: "addMember",
    memberPicker: {
      ...common.memberPicker,
      mode: "addMember",
      copy: { ...common.memberPicker.copy, selectedTitle: "Select contacts" },
    },
  },
};

export const EmptySelection: Story = {
  args: {
    ...common,
    mode: "createGroup",
    memberPicker: {
      ...common.memberPicker,
      selected: [],
      selectedUids: new Set<string>(),
      copy: { ...common.memberPicker.copy, selectedTitle: "0 selected" },
    },
  },
};
