import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import FormalContentPanel, { type FormalContentPanelProps } from "./FormalContentPanel";
import { i18n, I18nProvider } from "@octo/base";
import zhCN from "../../i18n/zh-CN.json";
import enUS from "../../i18n/en-US.json";
import type { SummaryGenerationSpec, SummaryFormalVersion } from "../../Service/SummaryContentContract";

i18n.registerNamespace("summary", { "zh-CN": zhCN, "en-US": enUS });
const spec: SummaryGenerationSpec = {
  schema_version: 1, collaboration: "single", summary_mode: 2, participants: ["fixture"],
  sources: [{ source_id: "group", source_type: 1, confirmation: "user_confirmed" }],
  requirement: null, template: null, time_selector: { mode: "relative", days: 7, timezone: "Asia/Shanghai" },
  retrieval: { author_ids: [], keywords: [] }, citation_rules: { policy: "message_evidence" }, field_sources: {},
};

const meta: Meta<typeof FormalContentPanel> = {
  title: "Summary/Workbench/FormalContentPanel",
  component: FormalContentPanel,
  decorators: [(Story: React.ComponentType) => <I18nProvider><Story /></I18nProvider>],
  render: (args: FormalContentPanelProps) => {
    const [draft, setDraft] = React.useState(args.state.draftSpec);
    return <FormalContentPanel {...args} state={{ ...args.state, draftSpec: draft }} actions={{ ...args.actions, onDraftSpecChange: setDraft }} />;
  },
};
export default meta;
type Story = StoryObj<typeof FormalContentPanel>;
export const Default: Story = { args: {
  title: "项目总结 / Project summary",
  content: {
    content_id: "sc1_fixture", kind: "personal", is_main: true, content_revision: 1,
    current_version: { content_id: "sc1_fixture", version_id: "sv1_fixture", version: 1, content_revision: 1,
      content: "Summary body", citations: [], team_citations: [], citation_visibility: "not_generated",
      team_citation_visibility: "none", operation_type: "generate", operation_note: "", base_content_revision: 0,
      provisional: false, is_current: true, generated_at: "2026-09-08T09:00:00+08:00" },
    capabilities: { can_edit: true, can_refine: true, can_configure_schedule: true, can_schedule: false,
      can_regenerate_direct: false, can_regenerate_with_config: true, can_save_as_new: false,
      can_view_versions: true, can_delete: false, unavailable_reasons: {} },
    generation_config: { state: "incomplete", revision: 0, missing_fields: ["requirement"], unavailable_reason: null },
    active_generation: null, integrity: "consistent",
  },
  state: {
    configuration: { state: "incomplete", revision: 0, missing_fields: ["requirement"], unavailable_reason: null, spec, schedule: null, next_run_at: null },
    draftSpec: spec, versions: [], hasMore: false, pending: false, errorKey: "", noticeKey: "", sourceLabels: ["Project chat"],
  },
  actions: {
    onChooseSources: () => {}, onDraftSpecChange: () => {}, onConfigure: () => {}, onSaveConfiguration: async () => true,
    onRefine: async () => true, onRegenerate: () => {}, onEdit: async () => true, onRestore: async () => true,
    onVersions: () => {}, onCancel: () => {}, onApply: () => {}, onReload: () => {},
  },
  renderVersion: (version: SummaryFormalVersion) => <p>{version.content}</p>,
} };
export const Loading: Story = { args: { ...Default.args, state: { ...Default.args!.state!, pending: true } } };
export const Error: Story = { args: { ...Default.args, state: { ...Default.args!.state!, errorKey: "summary.formal.errors.request" } } };
export const LongTitle: Story = { args: { ...Default.args, title: "Long project summary title with a detailed description of the completed work and next steps ".repeat(3) } };
export const English: Story = { ...Default, decorators: [(Story: React.ComponentType) => { i18n.setLocale("en-US"); return <Story />; }] };
