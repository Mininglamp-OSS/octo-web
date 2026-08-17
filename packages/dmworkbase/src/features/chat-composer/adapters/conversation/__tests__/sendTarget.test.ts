import { describe, expect, it } from "vitest";
import {
  captureSendTarget,
  reconcileRecoveredSendTarget,
  restoreSendTargetIfVacant,
  type SendTargetHost,
} from "../sendTarget";

function targetHost<T = string>(replyMessage?: T, handlerType = 0) {
  let reply = replyMessage;
  let handler = handlerType;
  const host: SendTargetHost<T> = {
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

  it("prepares a neutral target without clearing a newer selection", () => {
    const occupied = targetHost("new", 1);
    expect(reconcileRecoveredSendTarget(occupied.host)).toBe(false);
    expect(occupied.state()).toEqual({ reply: "new", handler: 1 });

    const vacant = targetHost(undefined, 2);
    expect(reconcileRecoveredSendTarget(vacant.host)).toBe(true);
    expect(vacant.state()).toEqual({ reply: undefined, handler: 0 });
  });

  it("accepts the same recovered target but rejects a different active one", () => {
    const reply = { id: "reply" };
    const matching = targetHost(reply, 1);
    expect(
      reconcileRecoveredSendTarget(matching.host, {
        replyMessage: reply,
        handlerType: 1,
      })
    ).toBe(true);

    const different = targetHost("new", 1);
    expect(
      reconcileRecoveredSendTarget(different.host, {
        replyMessage: "old",
        handlerType: 1,
      })
    ).toBe(false);
    expect(different.state()).toEqual({ reply: "new", handler: 1 });
  });
});
