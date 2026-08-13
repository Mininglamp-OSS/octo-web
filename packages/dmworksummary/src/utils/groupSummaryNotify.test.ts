import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryDetail } from "../types/summary";
import {
  collectGroupSourceIds,
  isAgentSummaryNotificationEligible,
  markAgentSummaryNotificationEligible,
  readNotifiedGroups,
  resetGroupSummaryNotifyRuntimeForTests,
  sendGroupSummaryCompletionTips,
  shouldNotifyGroupSummaryCompletion,
} from "./groupSummaryNotify";

const COMPLETED = 3;

function detail(overrides: Partial<SummaryDetail> = {}): SummaryDetail {
  return {
    task_id: 42,
    task_no: "task-42",
    title: "Summary",
    summary_mode: 2,
    status: COMPLETED,
    trigger_type: 1,
    time_range_start: "2026-08-13T00:00:00Z",
    time_range_end: "2026-08-13T01:00:00Z",
    sources: [
      { source_type: 1, source_id: "group-a" },
      { source_type: 1, source_id: "group-b" },
    ],
    participants: [],
    result: null,
    error_message: null,
    creator_id: "creator",
    origin_channel_id: "group-a",
    origin_channel_type: 2,
    created_at: "2026-08-13T00:00:00Z",
    updated_at: "2026-08-13T01:00:00Z",
    ...overrides,
  } as SummaryDetail;
}

describe("groupSummaryNotify", () => {
  beforeEach(() => {
    localStorage.clear();
    resetGroupSummaryNotifyRuntimeForTests();
  });

  it("only accepts a creator transition into completed", () => {
    expect(
      shouldNotifyGroupSummaryCompletion(2, detail(), "creator", COMPLETED)
    ).toBe(true);
    expect(
      shouldNotifyGroupSummaryCompletion(
        undefined,
        detail(),
        "creator",
        COMPLETED
      )
    ).toBe(false);
    expect(
      shouldNotifyGroupSummaryCompletion(
        undefined,
        detail({ trigger_type: 3 }),
        "creator",
        COMPLETED,
        true
      )
    ).toBe(true);
    expect(
      shouldNotifyGroupSummaryCompletion(
        COMPLETED,
        detail(),
        "creator",
        COMPLETED
      )
    ).toBe(false);
    expect(
      shouldNotifyGroupSummaryCompletion(2, detail(), "participant", COMPLETED)
    ).toBe(false);
  });

  it("collects unique group sources only", () => {
    expect(
      collectGroupSourceIds({
        sources: [
          { source_type: 1, source_id: " group-a " },
          { source_type: 1, source_id: "group-a" },
          { source_type: 2, source_id: "thread-a" },
          { source_type: 3, source_id: "dm-a" },
        ],
        origin_channel_id: "group-origin",
        origin_channel_type: 1,
      })
    ).toEqual(["group-a"]);
    expect(
      collectGroupSourceIds({
        sources: [],
        origin_channel_id: "group-origin",
        origin_channel_type: 1,
      })
    ).toEqual(["group-origin"]);
  });

  it("only notifies a newly created agent summary using its origin group", async () => {
    const sendToChannel = vi.fn().mockResolvedValue(undefined);
    const agentDetail = detail({
      trigger_type: 3,
      sources: [],
      origin_channel_id: "group-origin",
      origin_channel_type: 1,
    });

    await sendGroupSummaryCompletionTips(
      undefined,
      agentDetail,
      "creator",
      COMPLETED,
      2,
      { sendToChannel, isDisbanded: () => false }
    );
    expect(sendToChannel).not.toHaveBeenCalled();

    markAgentSummaryNotificationEligible(42);
    expect(isAgentSummaryNotificationEligible(42)).toBe(true);

    await sendGroupSummaryCompletionTips(
      undefined,
      agentDetail,
      "creator",
      COMPLETED,
      2,
      { sendToChannel, isDisbanded: () => false }
    );

    expect(sendToChannel).toHaveBeenCalledTimes(1);
    expect(sendToChannel.mock.calls[0][0].channelID).toBe("group-origin");
    expect(readNotifiedGroups(42)).toEqual(new Set(["group-origin"]));
    expect(isAgentSummaryNotificationEligible(42)).toBe(false);
  });

  it("sends once per task and group, including after runtime reset", async () => {
    const sendToChannel = vi.fn().mockResolvedValue(undefined);
    const deps = { sendToChannel, isDisbanded: () => false };

    await sendGroupSummaryCompletionTips(
      2,
      detail(),
      "creator",
      COMPLETED,
      2,
      deps
    );
    resetGroupSummaryNotifyRuntimeForTests();
    await sendGroupSummaryCompletionTips(
      2,
      detail(),
      "creator",
      COMPLETED,
      2,
      deps
    );

    expect(sendToChannel).toHaveBeenCalledTimes(2);
    expect(readNotifiedGroups(42)).toEqual(new Set(["group-a", "group-b"]));
  });

  it("coalesces overlapping completion observations in one tab", async () => {
    let releaseFirstSend!: () => void;
    const firstSendPending = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    const sendToChannel = vi
      .fn()
      .mockImplementationOnce(() => firstSendPending)
      .mockResolvedValue(undefined);
    const deps = { sendToChannel, isDisbanded: () => false };

    const first = sendGroupSummaryCompletionTips(
      2,
      detail(),
      "creator",
      COMPLETED,
      2,
      deps
    );
    const second = sendGroupSummaryCompletionTips(
      2,
      detail(),
      "creator",
      COMPLETED,
      2,
      deps
    );
    releaseFirstSend();
    await Promise.all([first, second]);

    expect(sendToChannel).toHaveBeenCalledTimes(2);
    expect(readNotifiedGroups(42)).toEqual(new Set(["group-a", "group-b"]));
  });

  it("claims a group before send so another runtime skips it", async () => {
    let releaseSend!: () => void;
    const pendingSend = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const sendToChannel = vi.fn().mockReturnValue(pendingSend);
    const oneGroupDetail = detail({
      sources: [{ source_type: 1, source_id: "group-a" }],
      origin_channel_id: "",
    });
    const deps = { sendToChannel, isDisbanded: () => false };

    const first = sendGroupSummaryCompletionTips(
      2,
      oneGroupDetail,
      "creator",
      COMPLETED,
      2,
      deps
    );
    await Promise.resolve();
    resetGroupSummaryNotifyRuntimeForTests();
    await sendGroupSummaryCompletionTips(
      2,
      oneGroupDetail,
      "creator",
      COMPLETED,
      2,
      deps
    );

    expect(sendToChannel).toHaveBeenCalledTimes(1);
    releaseSend();
    await first;
  });

  it("isolates failures and does not mark failed groups", async () => {
    const sendToChannel = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const warn = vi.fn();

    await sendGroupSummaryCompletionTips(2, detail(), "creator", COMPLETED, 2, {
      sendToChannel,
      isDisbanded: () => false,
      warn,
    });

    expect(sendToChannel).toHaveBeenCalledTimes(2);
    expect(readNotifiedGroups(42)).toEqual(new Set(["group-b"]));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips disbanded groups", async () => {
    const sendToChannel = vi.fn().mockResolvedValue(undefined);
    await sendGroupSummaryCompletionTips(2, detail(), "creator", COMPLETED, 2, {
      sendToChannel,
      isDisbanded: (channel) => channel.channelID === "group-a",
    });
    expect(sendToChannel).toHaveBeenCalledTimes(1);
    expect(sendToChannel.mock.calls[0][0].channelID).toBe("group-b");
  });
});
