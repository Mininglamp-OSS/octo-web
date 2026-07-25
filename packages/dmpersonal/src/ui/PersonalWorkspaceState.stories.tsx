import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import PersonalWorkspaceState from "./PersonalWorkspaceState";
import "@octo/loop/src/pages/loop.css";
import "../personal.css";

const meta = {
  title: "Personal/PersonalWorkspaceState",
  component: PersonalWorkspaceState,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Pure Personal workspace state view. It renders bridge-provided loading or error state without reading app runtime context.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: "100%", height: 520 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PersonalWorkspaceState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: {
    status: "loading",
    title: "Loading workspace...",
  },
};

export const Error: Story = {
  args: {
    status: "error",
    title: "Failed to load workspace",
    desc: "Check the current Space and retry.",
  },
};
