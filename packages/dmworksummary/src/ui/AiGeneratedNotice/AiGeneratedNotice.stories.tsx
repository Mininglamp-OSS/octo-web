import type { Meta, StoryObj } from "@storybook/react-vite";
import AiGeneratedNotice from ".";
import zhCN from "../../i18n/zh-CN.json";
import enUS from "../../i18n/en-US.json";

const meta: Meta<typeof AiGeneratedNotice> = {
    title: "Summary/AiGeneratedNotice",
    component: AiGeneratedNotice,
    args: { text: zhCN.common.aiGeneratedNotice },
};

export default meta;
type Story = StoryObj<typeof AiGeneratedNotice>;
export const Default: Story = {};
export const English: Story = { args: { text: enUS.common.aiGeneratedNotice } };
