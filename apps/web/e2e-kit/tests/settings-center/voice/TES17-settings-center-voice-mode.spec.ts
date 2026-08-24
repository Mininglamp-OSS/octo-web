/* spec: apps/web/e2e-kit/case-specs/settings-center/voice/TES17-settings-center-voice-mode.md */
import { test, expect } from "../../../fixtures-authed";
import { openVoiceSettings, prepareVoiceConversation } from "./settings-center-voice-support";

test("@TES17 @p1 @settings-center @voice @chat @interaction 说话方式说明跟随设置切换", async ({ authedPage }) => {
  await prepareVoiceConversation(authedPage, { shortcutEnabled: true, speakingMode: "toggle" }, "TES17 语音交互群");
  const content = await openVoiceSettings(authedPage);

  await content.getByRole("combobox", { name: "快捷键使用方式" }).selectOption("toggle");
  await expect(content).toContainText("点按右 Alt 开始语音输入，再按一次结束");
  await expect(content.locator(".wk-settings-center__row-description").filter({ hasText: "松开结束" })).toHaveCount(0);

  await content.getByRole("combobox", { name: "快捷键使用方式" }).selectOption("hold");
  await expect(content).toContainText("按住右 Alt 进行语音输入，松开结束");
  await expect(content.locator(".wk-settings-center__row-description").filter({ hasText: "再按一次结束" })).toHaveCount(0);
});
