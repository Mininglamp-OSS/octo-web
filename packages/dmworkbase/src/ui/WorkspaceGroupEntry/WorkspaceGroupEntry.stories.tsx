import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceGroupEntry } from "./index";

const meta = {
  title: "UI/WorkspaceGroupEntry",
  component: WorkspaceGroupEntry,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => (
    <div style={{ padding: "var(--wk-sp-4)", minHeight: 360 }}>
      <div className="wk-workspace-group-title-row">
        <span className="wk-workspace-group-title">Customer access review</span>
        <Story />
      </div>
    </div>
  )],
  args: {
    workspace: {
      projectName: "Data Intelligence",
      linkedByName: "Evan",
      source: "linked_existing",
      canOpen: true,
      canManage: true,
      isAllMemberGroup: false,
    },
    onOpen: () => {},
    onManage: () => {},
    onRetry: () => {},
  },
} satisfies Meta<typeof WorkspaceGroupEntry>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Details: Story = { args: { defaultOpen: true } };
export const Empty: Story = { args: { workspace: null } };
export const Loading: Story = { args: { refreshing: true, defaultOpen: true } };
export const Opening: Story = { args: { busy: "open" } };
export const Error: Story = { args: { error: "Unable to open workspace. Please try again." } };
export const ReadOnly: Story = {
  args: { workspace: { ...meta.args.workspace, canManage: false }, defaultOpen: true },
};
export const AccessDenied: Story = {
  args: { workspace: { ...meta.args.workspace, canOpen: false, canManage: false }, defaultOpen: true },
};
export const AllMembers: Story = {
  args: { workspace: { ...meta.args.workspace, isAllMemberGroup: true }, defaultOpen: true },
};
export const LongText: Story = {
  args: {
    workspace: { ...meta.args.workspace, projectName: "Cross-organization Customer Data Access and Intelligence", linkedByName: "Alexandria Montgomery" },
    defaultOpen: true,
  },
};
