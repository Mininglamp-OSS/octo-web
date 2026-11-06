import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { i18n } from "@octo/base";
import zh from "../../i18n/zh-CN.json";
import en from "../../i18n/en-US.json";
import LoopRuntimePicker from ".";
import type { LoopRuntimePickerProps, RuntimeGroup } from "./types";
i18n.registerNamespace("mcp", { "zh-CN": zh, "en-US": en });
const groups: RuntimeGroup[] = [
  {
    key: "one",
    label: "localhost · be44a7fd",
    items: [
      {
        id: "hermes",
        name: "Hermes",
        provider: "hermes",
        version: "Hermes Agent v0.16.0",
        available: true,
        cloud: false,
        visibility: "private",
        reason: "",
      },
      {
        id: "claude",
        name: "Claude",
        provider: "claude",
        version: "2.1.198 (Claude Code)",
        available: true,
        cloud: false,
        visibility: "private",
        reason: "",
      },
      {
        id: "codex",
        name: "Codex",
        provider: "codex",
        version: "codex-cli 0.164.0",
        available: true,
        cloud: false,
        visibility: "private",
        reason: "",
      },
    ],
  },
  {
    key: "two",
    label: "localhost · d5a751d2",
    items: [
      {
        id: "second",
        name: "Codex",
        provider: "codex",
        version: "codex-cli 0.164.0",
        available: true,
        cloud: false,
        visibility: "workspace",
        reason: "",
      },
      {
        id: "offline",
        name: "Claude (research)",
        provider: "claude",
        version: "2.1.198 (Claude Code)",
        available: false,
        cloud: false,
        visibility: "private",
        reason: "claude-research: command not found",
      },
    ],
  },
];
const otherMachine: RuntimeGroup = {
  key: "other",
  label: "Team workstation · 12345678",
  items: [
    {
      id: "shared",
      name: "Claude",
      provider: "claude",
      version: "2.1.198 (Claude Code)",
      available: true,
      selectable: true,
      owned: false,
      cloud: false,
      visibility: "workspace",
      reason: "",
    },
    {
      id: "private",
      name: "Codex",
      provider: "codex",
      version: "codex-cli 0.164.0",
      available: true,
      selectable: false,
      owned: false,
      cloud: false,
      visibility: "private",
      reason: "Private runtime",
    },
  ],
};
function Preview(args: LoopRuntimePickerProps) {
  const [value, setValue] = useState(args.value);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  return (
    <div style={{ width: "min(100%, 432px)", padding: "var(--wk-sp-6)" }}>
      <LoopRuntimePicker
        {...args}
        value={value}
        onChange={setValue}
        scope={scope}
        groups={
          scope === "all" && args.groups.length
            ? [...args.groups, otherMachine]
            : args.groups
        }
        onScopeChange={(next) => {
          setScope(next);
          if (next === "mine" && ["shared", "private"].includes(value))
            setValue("");
        }}
      />
    </div>
  );
}
const meta: Meta<typeof LoopRuntimePicker> = {
  title: "Marketplace/LoopRuntimePicker",
  component: LoopRuntimePicker,
  render: Preview,
  args: { groups, value: "codex" },
};
export default meta;
type Story = StoryObj<typeof LoopRuntimePicker>;
export const Default: Story = {};
export const Empty: Story = { args: { groups: [], value: "" } };
export const Loading: Story = {
  args: { groups: [], value: "", loading: true },
};
export const Error: Story = {
  args: { groups: [], value: "", error: "Failed to load runtimes" },
};
export const LongNames: Story = {
  args: {
    groups: [
      {
        ...groups[1],
        label: "Research workstation with a very long machine name · d5a751d2",
        items: [
          {
            ...groups[1].items[0],
            name: "Research configuration with a very long name · 00000001",
          },
          groups[1].items[1],
        ],
      },
    ],
    value: "second",
  },
};

export const ProviderIcons: Story = {
  args: {
    value: "codex",
    groups: [
      {
        key: "brands",
        label: "Workstation · be44a7fd",
        items: [
          "hermes",
          "claude",
          "codex",
          "codebuddy",
          "opencode",
          "openclaw",
          "pi",
          "copilot",
          "cursor",
          "kimi",
          "kiro",
          "qoder",
          "unknown",
        ].map((provider) => ({
          id: provider,
          name: provider,
          provider,
          version: "",
          available: true,
          cloud: false,
          reason: "",
        })),
      },
    ],
  },
};
