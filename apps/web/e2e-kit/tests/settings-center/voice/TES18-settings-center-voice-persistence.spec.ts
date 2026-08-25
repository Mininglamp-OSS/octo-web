/* spec: apps/web/e2e-kit/case-specs/settings-center/voice/TES18-settings-center-voice-persistence.md */
import { test, expect } from "../../../fixtures-authed";
import { closeSettings, getComposerPlaceholder, getComposerVoiceShortcutHint, openVoiceSettings, prepareVoiceConversation } from "./settings-center-voice-support";

test("@TES18 @p1 @settings-center @voice @chat @persistence 刷新后语音设置仍作用于对话", async ({ authedPage }) => {
  // Closing Settings can asynchronously flush the conversation draft. Install
  // the page-level fallback before any interaction so that flush cannot escape
  // while the MSW worker is being unloaded or replaced by a reload.
  await authedPage.route("**/conversations/*/*/extra", (route) => route.fulfill({ status: 200, body: "{}" }));
  await prepareVoiceConversation(authedPage, { shortcutWindows: "alt-right", speakingMode: "toggle" }, "TES18 持久化群");
  const content = await openVoiceSettings(authedPage);
  await content.getByRole("combobox", { name: "快捷键" }).selectOption("shift-left");
  await content.getByRole("combobox", { name: "说话方式" }).selectOption("hold");
  await closeSettings(authedPage);
  await expect.poll(() => getComposerPlaceholder(authedPage)).toBe("发送给 TES18 持久化群");
  await expect(authedPage.locator(".wk-messageinput-shortcut-hint")).toHaveCount(1);
  await expect.poll(() => getComposerVoiceShortcutHint(authedPage)).toBe("按住左 Shift 进行语音输入");

  await authedPage.reload();
  await authedPage.getByRole("button", { name: "会话" }).waitFor({ state: "visible", timeout: 15_000 });
  await authedPage.getByText("TES18 持久化群", { exact: true }).click();
  await authedPage.getByRole("textbox").waitFor({ state: "visible", timeout: 15_000 });
  await expect.poll(() => getComposerPlaceholder(authedPage)).toBe("发送给 TES18 持久化群");
  await expect(authedPage.locator(".wk-messageinput-shortcut-hint")).toHaveCount(1);
  await expect.poll(() => getComposerVoiceShortcutHint(authedPage)).toBe("按住左 Shift 进行语音输入");

  const refreshedContent = await openVoiceSettings(authedPage);
  await expect(refreshedContent.getByRole("combobox", { name: "快捷键" })).toHaveValue("shift-left");
  await expect(refreshedContent.getByRole("combobox", { name: "说话方式" })).toHaveValue("hold");
});
