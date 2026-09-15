import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import HtmlAttachmentPreviewPage from "./index";
import { i18n } from "../../i18n";

const meta: Meta<typeof HtmlAttachmentPreviewPage> = {
  title: "Base/HtmlAttachmentPreviewPage",
  component: HtmlAttachmentPreviewPage,
  parameters: { layout: "fullscreen" },
  args: {
    name: "季度报告 Q3.html",
    viewMode: "preview",
    onViewModeChange: () => undefined,
    onReturn: () => undefined,
    download: { pending: false, onClick: () => undefined },
    children: <p>HTML attachment preview</p>,
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading")).toHaveTextContent(
      "季度报告 Q3.html"
    );
    await userEvent.click(canvas.getAllByRole("button")[1]);
  },
};
export const Loading: Story = {
  args: { download: { pending: true, onClick: () => undefined } },
};
export const Expired: Story = {
  args: {
    name: "",
    download: undefined,
    error: "Preview expired. Reopen this attachment from chat.",
    children: null,
  },
};
export const LongFilename: Story = {
  args: {
    name:
      "季度报告中文文件名称 and long English filename ".repeat(10) + ".html",
  },
};
export const EnglishDark: Story = {
  globals: { theme: "dark" },
  beforeEach: () => {
    const previous = i18n.getLocale();
    i18n.setLocale("en-US");
    return () => i18n.setLocale(previous);
  },
};
