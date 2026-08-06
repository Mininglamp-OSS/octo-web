// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from "vitest";
import { AdaptiveCard } from "adaptivecards";
import { sendActionWithCurrentUserMessage } from "../../../Service/ActionMessageSender";
import {
  resolveActionMessageEffect,
  resolveActionMessageText,
} from "../sdk/actionMessage";

beforeAll(() => {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
  }
  AdaptiveCard.onProcessMarkdown = (text, result) => {
    result.outputHtml = text;
    result.didProcess = true;
  };
});

function makeCard() {
  const card = new AdaptiveCard();
  card.parse({
    type: "AdaptiveCard",
    version: "1.5",
    body: [
      {
        type: "Input.ChoiceSet",
        id: "decision_choice",
        isMultiSelect: true,
        value: "interaction,mobile",
        choices: [
          {
            title: "补全消息交互（推荐）\n这是卡片内的说明",
            value: "interaction",
          },
          { title: "完善移动端布局", value: "mobile" },
        ],
      },
      { type: "Input.Text", id: "decision_note", value: "先做交互" },
    ],
    actions: [
      {
        type: "Action.Submit",
        id: "decision_send",
        title: "发送选择",
        data: {
          effect: "send_current_user_message",
          effect_version: 1,
          message_source: {
            type: "compose",
            parts: [
              { type: "choice_labels", input_id: "decision_choice" },
              { type: "input_text", input_id: "decision_note" },
            ],
          },
        },
      },
    ],
  });
  const target = document.createElement("div");
  document.body.appendChild(target);
  const rendered = card.render();
  if (rendered) target.appendChild(rendered);
  return { card, action: card.getActionById("decision_send")!, target };
}

describe("card runtime message source", () => {
  it("maps selected ChoiceSet values to their displayed labels", () => {
    const { card, action, target } = makeCard();
    const effect = resolveActionMessageEffect(action, card);
    expect(effect).not.toBeNull();
    expect(resolveActionMessageText(effect!, action, card)).toBe(
      "补全消息交互（推荐）\n完善移动端布局\n先做交互"
    );
    target.remove();
  });

  it("does not silently fall back when an explicit source is malformed", () => {
    const { card, action, target } = makeCard();
    (action as any).data = {
      effect: "append_user_message",
      message_source: { type: "unknown_source", input_id: "decision_choice" },
    };
    expect(() => resolveActionMessageEffect(action, card)).toThrow(
      "message_source is malformed"
    );
    target.remove();
  });

  it("uses dialog values when composing the message", () => {
    const { card, action, target } = makeCard();
    (action as any).data = {
      effect: "send_current_user_message",
      message_source: { type: "input_text", input_id: "decision_note" },
    };
    const effect = resolveActionMessageEffect(action, card);
    expect(
      resolveActionMessageText(effect!, action, card, {
        decision_note: "来自弹窗的原因",
      })
    ).toBe("来自弹窗的原因");
    target.remove();
  });

  it("falls back to the normal submit path for an optional unsupported version", () => {
    const { card, action, target } = makeCard();
    (action as any).data = {
      effect: "send_current_user_message",
      effect_version: 2,
      effect_required: false,
      message_source: { type: "choice_labels", input_id: "decision_choice" },
    };
    expect(resolveActionMessageEffect(action, card)).toBeNull();

    (action as any).data = {
      effect: "send_current_user_message",
      effect_version: 2,
      effect_required: true,
      message_source: { type: "choice_labels", input_id: "decision_choice" },
    };
    expect(() => resolveActionMessageEffect(action, card)).toThrow(
      "send_current_user_message@2"
    );
    target.remove();
  });
});

describe("sendActionWithCurrentUserMessage", () => {
  it("does not resend the user message when the card action is retried", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      messageID: "user-message-1",
      clientMsgNo: "client-message-1",
    });
    const submitAction = vi
      .fn()
      .mockRejectedValueOnce(new Error("card action unavailable"))
      .mockResolvedValueOnce({ accepted: true });
    const options = {
      operationKey: "card-1:decision_send:user-1",
      content: "补全消息交互（推荐）",
      sendMessage,
      submitAction,
    };

    await expect(sendActionWithCurrentUserMessage(options)).rejects.toThrow(
      "card action unavailable"
    );
    await sendActionWithCurrentUserMessage(options);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(submitAction).toHaveBeenCalledTimes(2);
  });

  it("sends again for a new card frame while reusing the same-frame retry", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageID: "message-1" });
    const submitAction = vi
      .fn()
      .mockRejectedValueOnce(new Error("card action unavailable"))
      .mockResolvedValue({ accepted: true });

    const retry = {
      operationKey: "card-1:frame-1:decision_send:user-1",
      content: "补全消息交互（推荐）",
      sendMessage,
      submitAction,
    };
    await expect(sendActionWithCurrentUserMessage(retry)).rejects.toThrow();
    await sendActionWithCurrentUserMessage(retry);

    await sendActionWithCurrentUserMessage({
      ...retry,
      operationKey: "card-1:frame-2:decision_send:user-1",
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(submitAction).toHaveBeenCalledTimes(3);
  });
});
