import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceGroupEntry } from "./index";
import { useI18n } from "../../i18n";

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
export const ShortName: Story = {
  args: { workspace: { ...meta.args.workspace, projectName: "98", linkedByName: "will" }, defaultOpen: true },
};
export const UnknownActor: Story = {
  args: { workspace: { ...meta.args.workspace, linkedByName: "" }, defaultOpen: true },
};
export const Empty: Story = { args: { workspace: null } };
export const InitialLoading: Story = { args: { workspace: null, refreshing: true } };
export const InitialFailure: Story = { args: { workspace: null, error: "Unable to update the relation. Please try again." } };
export const Loading: Story = { args: { refreshing: true, defaultOpen: true } };
export const Opening: Story = { args: { busy: "open" } };
export const Error: Story = { args: { error: "Unable to open workspace. Please try again." } };
export const ReadOnly: Story = {
  args: { workspace: { ...meta.args.workspace, canManage: false }, defaultOpen: true },
};
export const AccessDenied: Story = {
  args: { workspace: { ...meta.args.workspace, canOpen: false, canManage: false }, defaultOpen: true },
};
export const Unavailable: Story = {
  args: { defaultOpen: true },
  render: function UnavailableStory(args) {
    const { t } = useI18n();
    return <WorkspaceGroupEntry {...args} workspace={{
      ...meta.args.workspace,
      projectName: t("base.workspaceGroup.workspaceUnavailable"),
      canOpen: false, canManage: false, manageDisabledReason: "unavailable",
    }} />;
  },
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
