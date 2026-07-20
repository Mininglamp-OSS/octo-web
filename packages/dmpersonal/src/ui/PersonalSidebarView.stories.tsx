import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Cpu, Sparkles } from "lucide-react";
import PersonalSidebarView from "./PersonalSidebarView";
import "../personal.css";

const tabs = [
  {
    key: "runtime" as const,
    icon: <Cpu size={16} />,
    label: "Runtime",
  },
  {
    key: "skill" as const,
    icon: <Sparkles size={16} />,
    label: "Skill",
  },
];

const meta = {
  title: "Personal/PersonalSidebarView",
  component: PersonalSidebarView,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pure Personal sidebar presentation component. Workspace resolution, routeRight writes, and API access stay in the bridge layer.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 240, height: 480 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    title: "Personal",
    betaLabel: "Beta",
    tabs,
    activeTab: "runtime",
    workspaceReady: true,
    machineMode: false,
    workspaceError: null,
    onTabClick: () => undefined,
  },
} satisfies Meta<typeof PersonalSidebarView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SkillActive: Story = {
  args: {
    activeTab: "skill",
  },
};

export const MachineMode: Story = {
  args: {
    machineMode: true,
  },
};

export const Loading: Story = {
  args: {
    workspaceReady: false,
  },
};

export const Error: Story = {
  args: {
    workspaceReady: false,
    workspaceError: "Failed to load workspace information.",
  },
};
