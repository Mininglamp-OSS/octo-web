/* spec: apps/web/e2e-kit/case-specs/settings-center/voice/TES16-settings-center-voice-placeholder.md */
import { test, expect } from "../../../fixtures-authed";
import { closeSettings, getComposerPlaceholder, getComposerVoiceShortcutHint, openVoiceSettings, prepareVoiceConversation } from "./settings-center-voice-support";

test("@TES16 @p1 @settings-center @voice @chat @consumer 设置语音后对话输入提示同步", async ({ authedPage }) => {
  await prepareVoiceConversation(authedPage, { shortcutEnabled: true, speakingMode: "toggle" }, "TES16 语音设置群");
  const content = await openVoiceSettings(authedPage);

  await content.getByRole("combobox", { name: "快捷键使用方式" }).selectOption("hold");
  await expect(content).toContainText("按住右 Alt 进行语音输入");

  await closeSettings(authedPage);
  await expect.poll(() => getComposerPlaceholder(authedPage)).toBe("发送给 TES16 语音设置群");
  await expect.poll(() => getComposerVoiceShortcutHint(authedPage)).toBe("按住右 Alt 进行语音输入");

  await authedPage.getByRole("textbox").type("测试");
  await expect.poll(() => getComposerVoiceShortcutHint(authedPage)).toBe("");

  await authedPage.getByRole("textbox").press("ControlOrMeta+A");
  await authedPage.getByRole("textbox").press("Backspace");
  await expect.poll(() => getComposerVoiceShortcutHint(authedPage)).toBe("按住右 Alt 进行语音输入");
});
