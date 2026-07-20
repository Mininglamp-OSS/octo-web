import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Bot,
  Briefcase,
  CircleUserRound,
  ClipboardList,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import type { Workspace } from "../api/types";
import type { LoopTabItem } from "../bridge/types";
import LoopSidebarView from "./LoopSidebarView";
import "../pages/loop.css";
import "./loopControls.css";

const workspaces: Workspace[] = [
  {
    id: "workspace-alpha",
    name: "Alpha Workspace",
    slug: "alpha-workspace",
  },
  {
    id: "workspace-research",
    name: "Research Workspace",
    slug: "research-workspace",
  },
] as Workspace[];

const myTab: LoopTabItem = {
  key: "myloop",
  icon: <CircleUserRound size={16} />,
  label: "My Loop",
};

const workspaceTabs: LoopTabItem[] = [
  { key: "issue", icon: <ClipboardList size={16} />, label: "Issues" },
  { key: "project", icon: <Briefcase size={16} />, label: "Projects" },
  { key: "automation", icon: <Zap size={16} />, label: "Automation" },
  { key: "agent", icon: <Bot size={16} />, label: "Agents" },
  { key: "squad", icon: <Users size={16} />, label: "Squads" },
];

const settingsTab: LoopTabItem = {
  key: "settings",
  icon: <Settings size={16} />,
  label: "Settings",
};

const meta = {
  title: "Loop/LoopSidebarView",
  component: LoopSidebarView,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pure Loop sidebar presentation component. Workspace loading, routeRight writes, and API access stay in the bridge layer.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 260, height: 620 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    activeTab: "issue",
    workspaces,
    currentWorkspace: workspaces[0],
    hasWorkspace: true,
    loaded: true,
    myTab,
    workspaceTabs,
    settingsTab,
    labels: {
      title: "Loop",
      workspaceTitle: "Workspace",
      noWorkspace: "No workspace",
      createWorkspace: "Create workspace",
      newIssue: "New loop",
      workspaceGroup: "Workspace",
    },
    onTabClick: () => undefined,
    onNewLoop: () => undefined,
    onCreateWorkspace: () => undefined,
    onSwitchWorkspace: () => undefined,
  },
} satisfies Meta<typeof LoopSidebarView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const MyLoopActive: Story = {
  args: {
    activeTab: "myloop",
  },
};

export const NoWorkspace: Story = {
  args: {
    activeTab: "issue",
    workspaces: [],
    currentWorkspace: null,
    hasWorkspace: false,
    loaded: true,
  },
};

export const Loading: Story = {
  args: {
    activeTab: "issue",
    workspaces: [],
    currentWorkspace: null,
    hasWorkspace: false,
    loaded: false,
  },
};
