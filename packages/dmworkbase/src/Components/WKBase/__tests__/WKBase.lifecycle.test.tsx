// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toast } from "@douyinfe/semi-ui";
import { Channel, Message, WKSDK } from "wukongimjssdk";
import type { DocForwardOpen, ForwardGrant, ForwardGrantResult } from "../../ForwardModal/grant";

const runtime = vi.hoisted(() => ({
  subscribers: new Map<string, Array<{ uid: string }>>(),
  disbanded: new Set<string>(),
  syncSubscribers: vi.fn(async () => {}),
  currentSpaceId: "sender-space",
}));

vi.mock("../../ConversationSelect", () => ({ default: () => null }));
vi.mock("../../WKModal", () => ({ default: () => null }));
vi.mock("../../UserInfo", () => ({ default: () => null }));
vi.mock("../../BotDetailModal", () => ({ default: () => null }));
vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelSubscribers: (channel: Channel) => runtime.subscribers.get(channel.channelID) ?? [],
  syncCurrentImChannelSubscribers: runtime.syncSubscribers,
}));
vi.mock("../../../im-runtime/channelRuntime", () => ({
  getImChannelInfo: () => ({ orgData: { receipt: 1 } }),
}));
vi.mock("../../../Utils/groupDisband", () => ({
  isConversationDisbanded: (channel: Channel) => runtime.disbanded.has(channel.channelID),
}));
vi.mock("../../../App", () => ({
  default: {
    shared: { get currentSpaceId() { return runtime.currentSpaceId; } },
    apiClient: { config: { apiURL: "https://test.invalid/api/v1/" } },
    endpoints: {},
  },
}));

import WKBase from "../index";
import ConversationSelect from "../../ConversationSelect";
import WKModal from "../../WKModal";

const documentInput: DocForwardOpen = {
  messageTitle: "Quarterly plan",
  link: "https://docs.test/d/doc-a",
  docId: "doc-a",
  spaceId: "document-home",
  shareAsCard: true,
  kind: "html",
  canGrant: true,
};
const recipient = new Channel("peer", 1);
const group = new Channel("group", 2);
const grant: ForwardGrant = {
  role: "writer",
  principalsByTarget: [{ channelID: "peer", channelType: 1, uids: ["peer"] }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeBase(): WKBase {
  const base = new WKBase({ children: null });
  base.context = { t: (key: string) => key } as WKBase["context"];
  base.setState = (update) => {
    const next = typeof update === "function" ? update(base.state, base.props) : update;
    if (next) base.state = { ...base.state, ...next };
  };
  return base;
}

function findElement(node: React.ReactNode, type: unknown, className?: string): React.ReactElement {
  let found: React.ReactElement | undefined;
  function visit(children: React.ReactNode): void {
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === type && (!className || child.props.className === className)) found = child;
      else visit(child.props.children);
    });
  }
  visit(node);
  if (!found) throw new Error("Expected forwarding element in the actual WKBase render tree");
  return found;
}

// Exercise production render callbacks and ForwardService; only the SDK transport is replaced.
function picker(base: WKBase) {
  const tree = base.render();
  const select = findElement(tree, ConversationSelect);
  const modal = findElement(tree, WKModal, "wk-base-modal wk-base-modal-forward");
  return {
    confirm: select.props.onFinished as (channels: Channel[], grant?: ForwardGrant) => void,
    cancel: select.props.onCancel as () => void,
    dismiss: modal.props.onCancel as () => void,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  runtime.subscribers.clear();
  runtime.disbanded.clear();
  runtime.currentSpaceId = "sender-space";
  runtime.syncSubscribers.mockReset().mockResolvedValue(undefined);
  send = vi.spyOn(WKSDK.shared().chatManager, "send").mockImplementation(async (content, channel) => {
    const message = new Message();
    message.content = content;
    message.channel = channel;
    return message;
  });
  vi.spyOn(Toast, "success").mockReturnValue("success");
  vi.spyOn(Toast, "warning").mockReturnValue("warning");
  vi.spyOn(Toast, "error").mockReturnValue("error");
});

afterEach(() => vi.restoreAllMocks());

describe("document forwarding through WKBase render callbacks", () => {
  it("accepts forwards after React's development lifecycle remount", async () => {
    const base = makeBase();
    base.componentDidMount();
    base.componentWillUnmount();
    base.componentDidMount();
    const onResult = vi.fn();
    base.showConversationSelect(undefined, undefined, { ...documentInput, onResult });
    picker(base).confirm([group]);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledOnce();
  });

  it("confirms once, closes the picker and sends an actual type-18 card", async () => {
    const base = makeBase();
    const onResult = vi.fn();
    const cancel = base.showConversationSelect(undefined, "Forward", { ...documentInput, onResult });
    const ui = picker(base);
    ui.confirm([group]);
    ui.confirm([group]);
    expect(base.state.showConversationSelect).toBe(false);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].encodeJSON()).toMatchObject({
      type: 18, doc_id: "doc-a", space_id: "document-home", kind: "html",
      title: "Quarterly plan", url: documentInput.link, permission: "reader",
    });
    expect(send.mock.calls[0][2].receiptEnabled).toBe(true);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ sent: 1, failed: 0 }));
    cancel?.();
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("keeps AI instruction forwards as text with the original anchored link", async () => {
    const base = makeBase();
    const onResult = vi.fn();
    const link = "https://docs.test/d/doc-a?instruction=revise#paragraph-3";
    base.showConversationSelect(undefined, undefined, { ...documentInput, shareAsCard: false, link, onResult });
    picker(base).confirm([recipient]);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][0].contentType).toBe(1);
    expect(send.mock.calls[0][0].encodeJSON()).toMatchObject({
      content: expect.stringContaining(link), space_id: "sender-space",
    });
  });

  it.each(["cancel", "dismiss", "handle"] as const)("cancels via %s once without sending", async (method) => {
    const base = makeBase();
    const onCancel = vi.fn();
    const onError = vi.fn();
    const cancel = base.showConversationSelect(undefined, undefined, { ...documentInput, onError }, onCancel);
    const ui = picker(base);
    if (method === "handle") cancel?.();
    else ui[method]();
    ui.cancel();
    cancel?.();
    ui.confirm([recipient]);
    await flush();
    expect(base.state.showConversationSelect).toBe(false);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores stale confirm/dismiss callbacks without closing a replacement picker", async () => {
    const base = makeBase();
    const onCancel = vi.fn();
    const oldResult = vi.fn();
    const oldCancel = base.showConversationSelect(undefined, "Old", { ...documentInput, onResult: oldResult }, onCancel);
    const stale = picker(base);
    const onResult = vi.fn();
    base.showConversationSelect(undefined, "New", { ...documentInput, messageTitle: "New", onResult });
    stale.confirm([recipient]);
    stale.dismiss();
    oldCancel?.();
    expect(base.state.showConversationSelect).toBe(true);
    expect(base.state.conversationSelectTitle).toBe("New");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    picker(base).confirm([group]);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].encodeJSON().title).toBe("New");
    expect(oldResult).not.toHaveBeenCalled();
  });

  it("preserves the plain selection callback used by existing Web callers", () => {
    const base = makeBase();
    const onFinished = vi.fn();
    const onCancel = vi.fn();
    const cancel = base.showConversationSelect(onFinished, "Select", undefined, onCancel);
    const ui = picker(base);
    ui.confirm([recipient]);
    ui.confirm([recipient]);
    cancel?.();
    expect(onFinished).toHaveBeenCalledExactlyOnceWith([recipient]);
    expect(onCancel).not.toHaveBeenCalled();
    expect(base.state.showConversationSelect).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("waits for opt-in grants before sending and preserves partial grant feedback", async () => {
    const base = makeBase();
    const pending = deferred<ForwardGrantResult>();
    const grantAccess = vi.fn(() => pending.promise);
    const onResult = vi.fn();
    base.showConversationSelect(undefined, undefined, { ...documentInput, grantAccess, onResult });
    picker(base).confirm([recipient], grant);
    expect(grantAccess).toHaveBeenCalledExactlyOnceWith(["peer"], "writer");
    expect(send).not.toHaveBeenCalled();
    pending.resolve({ granted: 0, failed: 1, failures: ["peer"], rejected: ["peer"] });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith({ sent: 1, failed: 0, grantFailures: ["peer"], grantRejections: ["peer"] });
    expect(Toast.warning).toHaveBeenCalledWith("base.forwardModal.grant.grantRejected");
  });

  it("keeps ordinary grant transport failure nonfatal", async () => {
    const base = makeBase();
    const onResult = vi.fn();
    const onError = vi.fn();
    base.showConversationSelect(undefined, undefined, {
      ...documentInput, onResult, onError, grantAccess: async () => { throw new Error("grant unavailable"); },
    });
    picker(base).confirm([recipient], grant);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledOnce();
    expect(Toast.warning).toHaveBeenCalledWith("base.forwardModal.grant.grantFailed");
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["cancel", "unmount", "space", "inactive"] as const)(
    "stops after a pending grant when the source is invalidated by %s",
    async (reason) => {
      const base = makeBase();
      const pending = deferred<ForwardGrantResult>();
      const onResult = vi.fn();
      const onError = vi.fn();
      let active = true;
      const cancel = base.showConversationSelect(undefined, undefined, {
        ...documentInput, onResult, onError, isActive: () => active, grantAccess: () => pending.promise,
      });
      picker(base).confirm([recipient], grant);
      if (reason === "cancel") cancel?.();
      if (reason === "unmount") base.componentWillUnmount();
      if (reason === "space") runtime.currentSpaceId = "other-space";
      if (reason === "inactive") active = false;
      pending.resolve({ granted: 1, failed: 0 });
      await flush();
      expect(send).not.toHaveBeenCalled();
      expect(onResult).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledOnce();
      expect(Toast.success).not.toHaveBeenCalled();
    },
  );

  it("cancels before a legacy member lookup resolves without granting access", async () => {
    const base = makeBase();
    const pending = deferred<void>();
    runtime.syncSubscribers.mockImplementation(() => pending.promise);
    runtime.subscribers.set("group", [{ uid: "peer" }]);
    const grantAccess = vi.fn(async () => ({ granted: 1, failed: 0 }));
    const onError = vi.fn();
    const cancel = base.showConversationSelect(undefined, undefined, { ...documentInput, grantAccess, onError });
    picker(base).confirm([group], { role: "reader" });
    cancel?.();
    pending.resolve();
    await flush();
    expect(grantAccess).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not cancel a confirmed forward when another picker opens", async () => {
    const base = makeBase();
    const pending = deferred<ForwardGrantResult>();
    const onResult = vi.fn();
    const cancelFirst = base.showConversationSelect(undefined, undefined, {
      ...documentInput, onResult, grantAccess: () => pending.promise,
    });
    picker(base).confirm([recipient], grant);
    const onFinished = vi.fn();
    base.showConversationSelect(onFinished, "Next selection");
    pending.resolve({ granted: 1, failed: 0 });
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    cancelFirst?.();
    expect(base.state.showConversationSelect).toBe(true);
    picker(base).confirm([group]);
    expect(onFinished).toHaveBeenCalledExactlyOnceWith([group]);
  });

  it("awaits host authorization at every actual SDK send", async () => {
    const base = makeBase();
    const authorization = deferred<void>();
    const beforeSend = vi.fn(() => authorization.promise);
    const onResult = vi.fn();
    base.showConversationSelect(undefined, undefined, { ...documentInput, beforeSend, onResult });
    picker(base).confirm([recipient, group]);
    expect(beforeSend).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    authorization.resolve();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each(["reject", "cancel", "space"] as const)("rejects late send authorization after %s", async (reason) => {
    const base = makeBase();
    const authorization = deferred<void>();
    const onError = vi.fn();
    const onResult = vi.fn();
    const cancel = base.showConversationSelect(undefined, undefined, {
      ...documentInput, onError, onResult, beforeSend: () => authorization.promise,
    });
    picker(base).confirm([recipient, group]);
    if (reason === "reject") authorization.reject(new Error("source revoked"));
    else {
      if (reason === "cancel") cancel?.();
      else runtime.currentSpaceId = "other-space";
      authorization.resolve();
    }
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onResult).not.toHaveBeenCalled();
    expect(Toast.success).not.toHaveBeenCalled();
  });

  it("guards later SDK sends after an ordinary Web caller changes space mid-forward", async () => {
    const base = makeBase();
    const onError = vi.fn();
    const onResult = vi.fn();
    send.mockImplementationOnce(async () => {
      runtime.currentSpaceId = "other-space";
      return new Message();
    });
    base.showConversationSelect(undefined, undefined, { ...documentInput, onError, onResult });
    picker(base).confirm([recipient, group]);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledOnce();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("keeps disbanded and transport-failed targets in ordinary Web result accounting", async () => {
    const base = makeBase();
    const onResult = vi.fn();
    const onError = vi.fn();
    runtime.disbanded.add("disbanded");
    send.mockRejectedValueOnce(new Error("transport failure"));
    base.showConversationSelect(undefined, undefined, { ...documentInput, onResult, onError });
    picker(base).confirm([recipient, group, new Channel("disbanded", 2)]);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ sent: 1, failed: 2 }));
    expect(Toast.error).toHaveBeenCalledWith("base.forwardModal.grant.partialSendFailed");
    expect(onError).not.toHaveBeenCalled();
  });
});
