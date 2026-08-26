import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAgentMailboxContext,
  registerAgentMailboxSwitchGuard,
  replaceAgentMailboxContext,
  requestAgentMailboxSwitch,
  requestMailWorkspaceSwitch,
  resetAgentMailboxContextForTests,
  subscribeAgentMailboxContext,
} from "./mailboxContext";

const first = {
  spaceId: "space-a",
  mailbox: {
    id: "11",
    address: "alice@demo.octo.test",
    connectState: "connected" as const,
    outboundMode: "manual_confirmation" as const,
  },
};
const second = {
  spaceId: "space-a",
  mailbox: {
    id: "12",
    address: "alice-bot@demo.octo.test",
    connectState: "unconnected" as const,
    outboundMode: "manual_confirmation" as const,
  },
};

describe("Agent mailbox context", () => {
  afterEach(() => resetAgentMailboxContextForTests());

  it("shares the selected mailbox across independent route trees", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentMailboxContext(listener);

    replaceAgentMailboxContext(first);

    expect(getAgentMailboxContext()).toEqual(first);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("lets an unsaved composer cancel a mailbox switch", () => {
    replaceAgentMailboxContext(first);
    const removeGuard = registerAgentMailboxSwitchGuard(() => false);

    expect(requestAgentMailboxSwitch(second)).toBe(false);
    expect(getAgentMailboxContext()).toEqual(first);

    removeGuard();
    expect(requestAgentMailboxSwitch(second)).toBe(true);
    expect(getAgentMailboxContext()).toEqual(second);
  });

  it("updates metadata for the current mailbox without invoking guards", () => {
    replaceAgentMailboxContext(first);
    const guard = vi.fn(() => false);
    const replacePane = vi.fn();
    registerAgentMailboxSwitchGuard(guard);

    expect(
      requestAgentMailboxSwitch(
        {
          ...first,
          mailbox: { ...first.mailbox, agentName: "Support Agent" },
        },
        replacePane
      )
    ).toBe(true);
    expect(guard).not.toHaveBeenCalled();
    expect(replacePane).not.toHaveBeenCalled();
    expect(getAgentMailboxContext()?.mailbox.agentName).toBe("Support Agent");
  });

  it("publishes an outbound mode-only context update", () => {
    const listener = vi.fn();
    replaceAgentMailboxContext(first);
    subscribeAgentMailboxContext(listener);

    replaceAgentMailboxContext({
      ...first,
      mailbox: { ...first.mailbox, outboundMode: "automatic_send" },
    });

    expect(getAgentMailboxContext()?.mailbox.outboundMode).toBe(
      "automatic_send"
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("lets an unsaved composer cancel mailbox-folder and management navigation", () => {
    const action = vi.fn();
    registerAgentMailboxSwitchGuard(() => false);

    expect(requestMailWorkspaceSwitch(action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("runs workspace navigation after all unsaved-content guards approve", () => {
    const action = vi.fn();
    registerAgentMailboxSwitchGuard((proceed) => proceed());

    expect(requestMailWorkspaceSwitch(action)).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("lets a deferred confirmation continue the original navigation once", () => {
    const action = vi.fn();
    let continueNavigation: (() => boolean) | undefined;
    registerAgentMailboxSwitchGuard((proceed) => {
      continueNavigation = proceed;
      return false;
    });

    expect(requestMailWorkspaceSwitch(action)).toBe(false);
    expect(action).not.toHaveBeenCalled();

    expect(continueNavigation?.()).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("defers the mailbox context and its complete pane replacement together", () => {
    replaceAgentMailboxContext(first);
    const replacePane = vi.fn();
    let confirmDiscard: (() => boolean) | undefined;
    registerAgentMailboxSwitchGuard((proceed) => {
      confirmDiscard = proceed;
      return false;
    });

    expect(requestAgentMailboxSwitch(second, replacePane)).toBe(false);
    expect(getAgentMailboxContext()).toEqual(first);
    expect(replacePane).not.toHaveBeenCalled();

    expect(confirmDiscard?.()).toBe(true);
    expect(getAgentMailboxContext()).toEqual(second);
    expect(replacePane).toHaveBeenCalledTimes(1);
  });
});
