import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import LoopCreateWorkspaceModal from "./LoopCreateWorkspaceModal";
import "../pages/loop.css";

const meta = {
  title: "Loop/LoopCreateWorkspaceModal",
  component: LoopCreateWorkspaceModal,
  parameters: {
    layout: "centered",
  },
  args: {
    visible: true,
    busy: false,
    name: "Alpha Workspace",
    slug: "alpha-workspace",
    labels: {
      title: "Create workspace",
      create: "Create",
      cancel: "Cancel",
      name: "Name",
      slug: "Slug",
      namePlaceholder: "Workspace name",
      slugPlaceholder: "my-workspace",
    },
    onSubmit: () => undefined,
    onCancel: () => undefined,
    onNameChange: () => undefined,
    onSlugChange: () => undefined,
  },
} satisfies Meta<typeof LoopCreateWorkspaceModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Busy: Story = {
  args: {
    busy: true,
  },
};
