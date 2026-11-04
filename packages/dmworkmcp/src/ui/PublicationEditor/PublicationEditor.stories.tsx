import { i18n } from "@octo/base";
import skillZh from "@dmwork/skillmarket/src/i18n/zh-CN.json";
import skillEn from "@dmwork/skillmarket/src/i18n/en-US.json";
import mcpZh from "../../i18n/zh-CN.json";
import mcpEn from "../../i18n/en-US.json";
i18n.registerNamespace("skillMarket", { "zh-CN": skillZh, "en-US": skillEn });
i18n.registerNamespace("mcp", { "zh-CN": mcpZh, "en-US": mcpEn });
import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PublicationEditorFields, type PublicationEditorFieldsProps } from ".";

const meta: Meta<typeof PublicationEditorFields> = {
  title: "Marketplace/PublicationEditor",
  component: PublicationEditorFields,
  excludeStories: ["initial"],
};
export default meta;
type Story = StoryObj<typeof PublicationEditorFields>;
const draft: NonNullable<PublicationEditorFieldsProps["draft"]> = {
  draft_revision: "local",
  plugin: {
    plugin_id: "expert",
    plugin_name: "方案设计专家",
    plugin_type: "expert",
    owner_id: "local",
    tags: [],
    visibility: "private",
    creator_name: "预览",
    created_by_type: "human",
    view_count: 0,
    install_count: 0,
    download_count: 0,
    created_at: "",
    updated_at: "",
    current_version: "1.0.1",
    published_version: "1.0.0",
    published_version_id: "released",
    listing_state: "published",
    manifest_json: {
      plugin_name: "方案设计专家",
      description: "梳理需求并输出可复核的产品方案。",
    },
    plugin_json: { attachments: [] },
  },
  relations: [],
};
export const initial: PublicationEditorFieldsProps = {
  item: { name: "方案设计专家", kind: "agent" },
  draft,
  fields: {
    name: "方案设计专家",
    description: "梳理需求并输出可复核的产品方案。",
    instruction: "依据用户提供的目标、约束与已有资料，输出有依据的方案。",
    version: "1.0.1",
    changelog: "更新方案检查步骤",
    versions: { skill: "s1" },
  },
  deps: [
    {
      id: "skill",
      name: "产品设计指南",
      type: "skill",
      current: "s1",
      versions: [
        { id: "s1", label: "1.0.0" },
        { id: "s2", label: "1.1.0" },
      ],
    },
    { id: "connector", name: "文档服务", type: "connector", versions: [] },
  ],
  alerts: [
    {
      plugin_id: "skill",
      name: "产品设计指南",
      plugin_type: "skill",
      from_version_id: "s1",
      from_version: "1.0.0",
      target_version_id: "s2",
      target_version: "1.1.0",
      is_skipped: false,
    },
  ],
  busy: false,
  blocked: false,
  error: "",
  canSave: true,
  versionError: null,
  publishError: null,
  initialVisibility: "private",
  onFieldChange: () => {},
  onRetry: () => {},
  onBotUpdate: () => {},
  onShowUpdates: () => {},
  onInitialVisibilityChange: () => {},
};
export const Default: Story = {
  args: initial,
  render: (args) => {
    const [fields, setFields] = useState(args.fields);
    return (
      <PublicationEditorFields
        {...args}
        fields={fields}
        onFieldChange={(key, value) =>
          setFields((old) => ({ ...old, [key]: value }))
        }
      />
    );
  },
};
export const Loading: Story = {
  args: { ...initial, draft: null, canSave: false },
};
export const Error: Story = {
  args: {
    ...initial,
    draft: null,
    error: "暂时无法读取草稿，请重试。",
    canSave: false,
  },
};
export const PendingReview: Story = {
  args: { ...initial, blocked: true, canSave: false },
};
export const LongContent: Story = {
  args: {
    ...initial,
    fields: {
      ...initial.fields,
      name: "跨团队产品需求分析与方案评审专家",
      instruction: initial.fields.instruction.repeat(20),
    },
  },
};
export const Team: Story = {
  args: {
    ...initial,
    item: { name: "产品设计专家团", kind: "squad" },
    deps: [
      {
        id: "member",
        name: "方案设计专家",
        type: "expert",
        current: "e1",
        versions: [
          { id: "e1", label: "1.0.0" },
          { id: "e2", label: "1.1.0" },
        ],
      },
    ],
    fields: { ...initial.fields, versions: { member: "e1" } },
    alerts: [],
  },
};

export const UnavailableDependency: Story = {
  args: {
    ...initial,
    dependencyIssues: [{ targetName: "内容创作规范", reason: "delisted" }],
    dependencySuspended: true,
    draft: { ...draft, plugin: { ...draft.plugin, listing_state: "delisted" } },
    deps: [{ id: "skill", name: "内容创作规范", type: "skill", current: "s1", versions: [{ id: "s1", label: "1.0.0" }], unavailable: true }],
  },
};
