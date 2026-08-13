import { describe, expect, it } from "vitest";
import {
  captureSendTarget,
  restoreSendTargetIfVacant,
  type SendTargetHost,
} from "../sendTarget";

function targetHost(replyMessage?: string, handlerType = 0) {
  let reply = replyMessage;
  let handler = handlerType;
  const host: SendTargetHost<string> = {
    getReplyMessage: () => reply,
    setReplyMessage: (value) => {
      reply = value;
    },
    getHandlerType: () => handler,
    setHandlerType: (value) => {
      handler = value;
    },
  };
  return {
    host,
    state: () => ({ reply, handler }),
  };
}

describe("send target ownership", () => {
  it("does not let an older in-flight target overwrite a newer selection", () => {
    const { host, state } = targetHost("old", 1);
    const captured = captureSendTarget(host);
    host.setReplyMessage("new");
    host.setHandlerType(2);

    captured.restore();

    expect(state()).toEqual({ reply: "new", handler: 2 });
  });

  it("does not let recovered state overwrite a newer selection", () => {
    const { host, state } = targetHost("new", 2);

    expect(
      restoreSendTargetIfVacant(host, {
        replyMessage: "old",
        handlerType: 1,
      })
    ).toBe(false);
    expect(state()).toEqual({ reply: "new", handler: 2 });
  });

  it("restores recovered state when the target slot is still empty", () => {
    const { host, state } = targetHost();

    expect(
      restoreSendTargetIfVacant(host, {
        replyMessage: "old",
        handlerType: 1,
      })
    ).toBe(true);
    expect(state()).toEqual({ reply: "old", handler: 1 });
  });
});
