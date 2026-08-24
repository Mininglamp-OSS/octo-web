/* spec: apps/web/e2e-kit/case-specs/settings-center/voice/TES20-settings-center-voice-shortcuts-visibility.md */
import { test, expect } from "../../../fixtures-authed";
import { openVoiceSettings, prepareVoiceConversation } from "./settings-center-voice-support";

test("@TES20 @p1 @settings-center @voice @visibility 语音关闭时隐藏快捷键页面", async ({ authedPage }) => {
  await prepareVoiceConversation(authedPage, { enabled: false, shortcutEnabled: true, speakingMode: "toggle" }, "TES20 语音关闭群");
  await openVoiceSettings(authedPage);

  await expect(authedPage.getByTestId("settings-center-nav-shortcuts")).toHaveCount(0);
});

test("@TES20 @p1 @settings-center @voice @visibility 快捷键关闭时隐藏快捷键页面", async ({ authedPage }) => {
  await prepareVoiceConversation(authedPage, { shortcutEnabled: false, speakingMode: "toggle" }, "TES20 快捷键关闭群");
  await openVoiceSettings(authedPage);

  await expect(authedPage.getByTestId("settings-center-nav-shortcuts")).toHaveCount(0);
});
