import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import LoopWorkspaceEmptyState from "./LoopWorkspaceEmptyState";
import "../pages/loop.css";

const meta = {
  title: "Loop/LoopWorkspaceEmptyState",
  component: LoopWorkspaceEmptyState,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ width: "100%", height: 520 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    title: "No workspace yet",
    desc: "Create a workspace before managing loops, projects, agents, or squads.",
  },
} satisfies Meta<typeof LoopWorkspaceEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
