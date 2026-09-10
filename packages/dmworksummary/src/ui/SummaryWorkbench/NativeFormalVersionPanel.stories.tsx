import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NativeFormalVersionPanel } from "./NativeFormalVersionPanel";
import { formalContentFixture } from "../../__tests__/formalContentFixtures";
import "../../index.css";
import { i18n, I18nProvider } from "@octo/base";
import zhCN from "../../i18n/zh-CN.json";
import enUS from "../../i18n/en-US.json";

i18n.registerNamespace("summary", { "zh-CN": zhCN, "en-US": enUS });

const content = formalContentFixture();
const current = content.current_version!;
const previous = { ...current, version_id: "history-opaque", version: 0, is_current: false, operation_note: "Earlier summary" };
const meta: Meta<typeof NativeFormalVersionPanel> = {
  title: "Summary/NativeFormalVersionPanel", component: NativeFormalVersionPanel,
  args: { content, versions: [current, previous], selected: previous, pending: false, hasMore: false,
    actions: { onClose() {}, onSelect() {}, onMore() {}, onRestore: async () => true, onApply: async () => true } },
  decorators: [(Story) => <I18nProvider><div className="summary-detail-layout has-version-panel"><Story /></div></I18nProvider>],
};
export default meta;
type Story = StoryObj<typeof NativeFormalVersionPanel>;
export const Default: Story = {};
export const Empty: Story = { args: { versions: [], selected: null } };
export const Loading: Story = { args: { versions: [], selected: null, pending: true } };
export const ReadOnly: Story = { args: { content: { ...content, capabilities: { ...content.capabilities, can_edit: false } } } };
export const LongText: Story = { args: { versions: [{ ...previous, operation_note: "Long version description ".repeat(25) }], hasMore: true } };
