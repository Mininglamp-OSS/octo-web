/* spec: apps/web/e2e-kit/case-specs/settings-center/voice/TES18-settings-center-voice-persistence.md */
import { test, expect } from "../../../fixtures-authed";
import { closeSettings, getComposerPlaceholder, openVoiceSettings, prepareVoiceConversation } from "./settings-center-voice-support";

test("@TES18 @p1 @settings-center @voice @chat @persistence 刷新后语音设置仍作用于对话", async ({ authedPage }) => {
  await prepareVoiceConversation(authedPage, { shortcutWindows: "alt-right", speakingMode: "toggle" }, "TES18 持久化群");
  const content = await openVoiceSettings(authedPage);
  await content.getByRole("combobox", { name: "快捷键" }).selectOption("shift-left");
  await content.getByRole("combobox", { name: "说话方式" }).selectOption("hold");
  await closeSettings(authedPage);
  await expect.poll(() => getComposerPlaceholder(authedPage)).toContain("按住左 Shift说话");

  // The conversation draft queue writes /extra during page teardown. Route it
  // at the page level because the MSW worker is being unloaded.
  await authedPage.route("**/conversations/*/*/extra", (route) => route.fulfill({ status: 200, body: "{}" }));
  await authedPage.reload();
  await authedPage.getByRole("button", { name: "会话" }).waitFor({ state: "visible", timeout: 15_000 });
  await authedPage.getByText("TES18 持久化群", { exact: true }).click();
  await authedPage.getByRole("textbox").waitFor({ state: "visible", timeout: 15_000 });
  await expect.poll(() => getComposerPlaceholder(authedPage)).toContain("按住左 Shift说话");

  const refreshedContent = await openVoiceSettings(authedPage);
  await expect(refreshedContent.getByRole("combobox", { name: "快捷键" })).toHaveValue("shift-left");
  await expect(refreshedContent.getByRole("combobox", { name: "说话方式" })).toHaveValue("hold");
});
