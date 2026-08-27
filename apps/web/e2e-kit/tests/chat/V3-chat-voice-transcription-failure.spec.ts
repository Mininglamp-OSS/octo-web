/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/chat/V3-chat-voice-transcription-failure.md
 *
 * V3: Chat 语音转写失败提示.
 */
import { test, expect } from "../../fixtures-authed";
import { registerV3ChatVoiceTranscriptionFailure } from "../../msw-handlers/v3-chat-voice-transcription-failure";
import { prepareVoiceConversation } from "../settings-center/voice/settings-center-voice-support";

test("@V3 @p1 @chat @voice @transcription @error Chat 录音后转写失败提示", async ({ authedPage }) => {
  await authedPage.evaluate(() => sessionStorage.setItem("__e2e_scenario", "v1-chat-voice-input"));
  await registerV3ChatVoiceTranscriptionFailure(authedPage);
  await prepareVoiceConversation(authedPage, { shortcutWindows: "shift-right", speakingMode: "toggle" }, "V3 语音失败群");

  const voiceEntry = authedPage.getByRole("button", { name: "语音输入 (长按 Shift)" });
  await expect(voiceEntry).toBeVisible({ timeout: 15_000 });
  await voiceEntry.click();
  await expect(authedPage.getByText("语音输入", { exact: true })).toBeVisible();
  const stopEntry = authedPage.getByTitle("停止录音");
  await expect(stopEntry).toBeVisible();

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await stopEntry.click();
  await expect(authedPage.getByText("转写失败，请重试", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(authedPage.getByRole("textbox")).toHaveText("", { exact: true });
});
