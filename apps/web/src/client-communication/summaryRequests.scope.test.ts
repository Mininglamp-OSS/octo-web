import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Channel } from "wukongimjssdk";
import { installSummaryRequests } from "./summaryRequests";
import type { OctoBuddyCommunicationBridge, SummaryCapabilityRequest } from "./hostBridge";
import type { SummaryDetail } from "@dmwork/summary/src/types/summary";
import { readNotifiedGroups, resetGroupSummaryNotifyRuntimeForTests } from "@dmwork/summary/src/utils/groupSummaryNotify";
import { legacySummaryMessagingPort } from "@dmwork/summary/messaging";

const f = vi.hoisted(() => ({
  send: vi.fn(),
  select: vi.fn(),
  apply: vi.fn(),
  setSender: vi.fn(),
  app: { shared: { currentSpaceId: "a" }, loginInfo: { uid: "creator", name: "Creator" } },
}));
vi.mock("wukongimjssdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("wukongimjssdk")>();
  const sdk = { shared: () => ({ chatManager: { send: f.send } }) };
  return { ...original, default: sdk, WKSDK: sdk };
});
vi.mock("@octo/base/src/im-runtime/channelRuntime", () => ({ getImChannelInfo: () => undefined }));
vi.mock("@octo/base/src/Utils/groupDisband", () => ({ isConversationDisbanded: () => false }));
vi.mock("@octo/base/src/Utils/sendContentProxy", () => ({ wrapSendContentForInjection: (content: unknown) => content }));
vi.mock("@octo/base/src/Service/Convert", () => ({ applyMsgLevelExternalFieldsWithFallback: f.apply }));
vi.mock("@octo/base", async () => ({
  ...(await import("@octo/base/src/Service/ForwardService")),
  interpretForwardResult: () => ({ kind: "success", failed: 0, total: 2 }),
  isConversationDisbanded: () => false,
  SummaryTipContent: class { setSender() { f.setSender(); return this; } },
  WKApp: {
    loginInfo: f.app.loginInfo,
    shared: Object.assign(f.app.shared, { baseContext: { showConversationSelect: f.select } }),
  },
  t: () => "Summary",
}));

const detail: SummaryDetail = {
  task_id: 42, task_no: "task-42", title: "Summary", summary_mode: 2, status: 3, trigger_type: 1,
  time_range_start: "", time_range_end: "", sources: [
    { source_type: 1, source_id: "g1" }, { source_type: 1, source_id: "g2" },
  ],
  participants: [], result: null, error_message: null, creator_id: "creator",
  origin_channel_id: "g1", origin_channel_type: 2, created_at: "", updated_at: "",
};
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetGroupSummaryNotifyRuntimeForTests();
  f.app.shared.currentSpaceId = "a";
  f.send.mockResolvedValue({});
});
afterEach(() => { dispose?.(); dispose = undefined; vi.restoreAllMocks(); });

function fixture(operation: SummaryCapabilityRequest["operation"]) {
  let receive!: (request: SummaryCapabilityRequest) => void;
  let epoch = 1;
  const respond = vi.fn();
  const notify = vi.spyOn(legacySummaryMessagingPort, "notifySummaryCompleted");
  const host = {
    onSummaryRequest: (callback: typeof receive) => { receive = callback; return vi.fn(); },
    respondSummaryRequest: respond,
  };
  dispose = installSummaryRequests(host as unknown as OctoBuddyCommunicationBridge, {
    capture: () => {
      const captured = epoch;
      return () => epoch === captured;
    },
  });
  receive({
    requestId: "r", spaceId: "a", operation,
    payload: operation === "notifySummaryCompleted" ? { previousStatus: 2, detail }
      : { content: "x".repeat(4600), title: "Forward" },
  });
  return {
    respond,
    notification: () => notify.mock.results[0].value,
    switchSpace(space: string) { epoch++; f.app.shared.currentSpaceId = space; },
  };
}

describe("summary request scope at the real serial sender", () => {
  it.each(["switch", "roundtrip", "dispose"] as const)(
    "stops completion tips after %s while the first send is pending", async (transition) => {
      let finish!: () => void;
      f.send.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      const h = fixture("notifySummaryCompleted");
      await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
      if (transition === "dispose") dispose!();
      else {
        h.switchSpace("b");
        if (transition === "roundtrip") h.switchSpace("a");
      }
      finish();
      await h.notification();
      await vi.waitFor(() => expect(h.respond).toHaveBeenCalledWith({
        requestId: "r", ok: false, error: "Summary request context expired",
      }));
      expect(f.send.mock.calls.map(([, channel]) => channel.channelID)).toEqual(["g1"]);
      expect(readNotifiedGroups(42)).toEqual(new Set(["g1"]));
      expect(h.respond).toHaveBeenCalledOnce();
    },
  );

  it("does not send or rewrite notification claims after a stale rejection", async () => {
    let reject!: (error: Error) => void;
    f.send.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const h = fixture("notifySummaryCompleted");
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    h.switchSpace("b");
    h.switchSpace("a");
    reject(new Error("late failure"));
    await h.notification();
    await vi.waitFor(() => expect(h.respond).toHaveBeenCalledOnce());
    expect(f.send).toHaveBeenCalledOnce();
    expect(readNotifiedGroups(42)).toEqual(new Set(["g1"]));
  });

  it("sends all completion tips when the captured scope stays active", async () => {
    const h = fixture("notifySummaryCompleted");
    await vi.waitFor(() => expect(h.respond).toHaveBeenCalledWith({ requestId: "r", ok: true }));
    expect(f.send.mock.calls.map(([, channel]) => channel.channelID)).toEqual(["g1", "g2"]);
  });

  it("does not touch notification state when scope expires during import", async () => {
    const h = fixture("notifySummaryCompleted");
    h.switchSpace("b");
    h.switchSpace("a");
    await vi.waitFor(() => expect(h.respond).toHaveBeenCalledWith({
      requestId: "r", ok: false, error: "Summary request context expired",
    }));
    expect(f.send).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("preserves unguarded legacy completion sends", async () => {
    await legacySummaryMessagingPort.notifySummaryCompleted({ previousStatus: 2, detail });
    expect(f.send.mock.calls.map(([, channel]) => channel.channelID)).toEqual(["g1", "g2"]);
    expect(readNotifiedGroups(42)).toEqual(new Set(["g1", "g2"]));
  });

  it("rechecks scope after constructing a completion tip before SDK send", async () => {
    let active = true;
    f.setSender.mockImplementationOnce(() => { active = false; });
    await legacySummaryMessagingPort.notifySummaryCompleted({ previousStatus: 2, detail }, {
      isActive: () => active,
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("preserves active forwarding across all chunks and targets", async () => {
    const h = fixture("requestForward");
    await vi.waitFor(() => expect(f.select).toHaveBeenCalledOnce());
    await f.select.mock.calls[0][0]([new Channel("g1", 2), new Channel("g2", 2)]);
    expect(f.send.mock.calls.map(([, channel]) => channel.channelID)).toEqual(["g1", "g1", "g2", "g2"]);
    expect(f.apply).toHaveBeenCalledTimes(4);
    expect(h.respond).toHaveBeenCalledWith({
      requestId: "r", ok: true, result: { kind: "success", failed: 0, total: 2 },
    });
  });

  it("stops remaining forward chunks and targets after A-B-A", async () => {
    let finish!: () => void;
    f.send.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const h = fixture("requestForward");
    await vi.waitFor(() => expect(f.select).toHaveBeenCalledOnce());
    const pending = f.select.mock.calls[0][0]([new Channel("g1", 2), new Channel("g2", 2)]);
    expect(f.send).toHaveBeenCalledOnce();
    h.switchSpace("b");
    h.switchSpace("a");
    finish();
    await pending;
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.apply).not.toHaveBeenCalled();
    expect(h.respond).toHaveBeenCalledWith({
      requestId: "r", ok: false, error: "Summary request context expired",
    });
  });
});
