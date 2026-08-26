import { test, expect } from "../../fixtures-authed";
import { registerV1ChatVoiceInput } from "../../msw-handlers/v1-chat-voice-input";
import { prepareVoiceConversation } from "../settings-center/voice/settings-center-voice-support";

test("@V1 @p1 @chat @voice Chat 语音配置开启后显示语音入口", async ({ authedPage }) => {
  await authedPage.evaluate(() => sessionStorage.setItem("__e2e_scenario", "v1-chat-voice-input"));
  await registerV1ChatVoiceInput(authedPage);
  await prepareVoiceConversation(authedPage, { shortcutWindows: "shift-right", speakingMode: "toggle" }, "V1 语音群");
  const voiceButton = authedPage.getByRole("button", { name: "语音输入 (长按 Shift)" });
  await expect(voiceButton).toBeVisible({ timeout: 15_000 });
  await expect(voiceButton).not.toHaveClass(/wk-vib__btn--disabled/);
});
