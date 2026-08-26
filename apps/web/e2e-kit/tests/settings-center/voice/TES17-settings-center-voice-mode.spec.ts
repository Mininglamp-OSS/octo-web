/* spec: apps/web/e2e-kit/case-specs/settings-center/voice/TES17-settings-center-voice-mode.md */
import { test, expect } from "../../../fixtures-authed";
import { openVoiceSettings, prepareVoiceConversation } from "./settings-center-voice-support";

test("@TES17 @p1 @settings-center @voice @chat @interaction 说话方式说明跟随设置切换", async ({ authedPage }) => {
  await prepareVoiceConversation(authedPage, { shortcutWindows: "shift-left", speakingMode: "toggle" }, "TES17 语音交互群");
  const content = await openVoiceSettings(authedPage);
  await content.getByRole("combobox", { name: "快捷键" }).selectOption("shift-left");

  await content.getByRole("combobox", { name: "说话方式" }).selectOption("toggle");
  await expect(content).toContainText("按左 Shift 开始说话，再按一次结束");
  await expect(content).not.toContainText("松开结束");

  await content.getByRole("combobox", { name: "说话方式" }).selectOption("hold");
  await expect(content).toContainText("按住左 Shift 说话，松开结束");
  await expect(content).not.toContainText("再按一次结束");
});
