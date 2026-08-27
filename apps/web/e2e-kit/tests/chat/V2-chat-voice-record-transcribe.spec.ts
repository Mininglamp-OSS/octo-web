/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/chat/V2-chat-voice-record-transcribe.md
 *
 * V2: Chat 语音录音、停止、转写回填.
 */
import { test, expect } from "../../fixtures-authed";
import { registerV2ChatVoiceRecordTranscribe } from "../../msw-handlers/v2-chat-voice-record-transcribe";
import { prepareVoiceConversation } from "../settings-center/voice/settings-center-voice-support";

test("@V2 @p1 @chat @voice @transcription Chat 录音停止后转写回填", async ({ authedPage }) => {
  await authedPage.evaluate(() => sessionStorage.setItem("__e2e_scenario", "v1-chat-voice-input"));
  await registerV2ChatVoiceRecordTranscribe(authedPage);
  await prepareVoiceConversation(authedPage, { shortcutWindows: "shift-right", speakingMode: "toggle" }, "V2 语音群");

  const voiceEntry = authedPage.getByRole("button", { name: "语音输入 (长按 Shift)" });
  await expect(voiceEntry).toBeVisible({ timeout: 15_000 });
  await voiceEntry.click();
  await expect(authedPage.getByText("语音输入", { exact: true })).toBeVisible();
  const stopEntry = authedPage.getByTitle("停止录音");
  await expect(stopEntry).toBeVisible();

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await stopEntry.click();
  const composer = authedPage.getByRole("textbox");
  await expect(authedPage.getByText("转写中", { exact: true })).toBeVisible();
  await expect(composer).toContainText("V2 语音转写结果", { timeout: 15_000 });
});
