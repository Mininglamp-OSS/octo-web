/* spec: apps/web/e2e-kit/case-specs/settings-center/voice/TES18-settings-center-voice-persistence.md */
import { test, expect } from "../../../fixtures-authed";
import { closeSettings, getComposerPlaceholder, openVoiceSettings, prepareVoiceConversation } from "./settings-center-voice-support";

test("@TES18 @p1 @settings-center @voice @chat @persistence 刷新后语音设置仍作用于对话", async ({ authedPage }) => {
  await prepareVoiceConversation(authedPage, { shortcutWindows: "alt-right", speakingMode: "toggle" }, "TES18 持久化群");
  const content = await openVoiceSettings(authedPage);
  await content.getByRole("combobox", { name: "快捷键" }).selectOption("shift-left");
  await content.getByRole("combobox", { name: "说话方式" }).selectOption("hold");
  await closeSettings(authedPage);
  await expect.poll(() => getComposerPlaceholder(authedPage)).toBe("发送给 TES18 持久化群");
  await expect(authedPage.locator(".wk-messageinput-shortcut-hint")).toHaveCount(0);

  // Leave the conversation while the current document is still controlled by
  // MSW, then wait for the asynchronous draft/viewport persistence to finish.
  // Reloading the active conversation directly can close the MSW client before
  // this POST starts, allowing it to escape to Vite's intentionally dead proxy.
  const conversationExtraSaved = authedPage.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/conversations/voice-settings-group/2/extra"
      && response.ok();
  });
  await authedPage.getByRole("button", { name: "通讯录" }).click();
  await conversationExtraSaved;

  await authedPage.reload();
  await authedPage.getByRole("button", { name: "会话" }).click();
  await authedPage.getByRole("button", { name: "最近" }).click();
  await authedPage.getByText("TES18 持久化群", { exact: true }).click();
  await authedPage.getByRole("textbox").waitFor({ state: "visible", timeout: 15_000 });
  await expect.poll(() => getComposerPlaceholder(authedPage)).toBe("发送给 TES18 持久化群");
  await expect(authedPage.locator(".wk-messageinput-shortcut-hint")).toHaveCount(0);

  const refreshedContent = await openVoiceSettings(authedPage);
  await expect(refreshedContent.getByRole("combobox", { name: "快捷键" })).toHaveValue("shift-left");
  await expect(refreshedContent.getByRole("combobox", { name: "说话方式" })).toHaveValue("hold");
});
