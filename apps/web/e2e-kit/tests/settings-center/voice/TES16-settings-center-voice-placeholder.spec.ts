/* spec: apps/web/e2e-kit/case-specs/settings-center/voice/TES16-settings-center-voice-placeholder.md */
import { test, expect } from "../../../fixtures-authed";
import { closeSettings, getComposerPlaceholder, openVoiceSettings, prepareVoiceConversation } from "./settings-center-voice-support";

test("@TES16 @p1 @settings-center @voice @chat @consumer 设置语音后对话输入提示同步", async ({ authedPage }) => {
  await prepareVoiceConversation(authedPage, { shortcutWindows: "alt-right", speakingMode: "toggle" }, "TES16 语音设置群");
  const content = await openVoiceSettings(authedPage);

  await content.getByRole("combobox", { name: "快捷键" }).selectOption("shift-left");
  await content.getByRole("combobox", { name: "说话方式" }).selectOption("hold");
  await expect(content).toContainText("按住左 Shift说话");

  await closeSettings(authedPage);
  await expect.poll(() => getComposerPlaceholder(authedPage)).toContain("按住左 Shift说话");
});
