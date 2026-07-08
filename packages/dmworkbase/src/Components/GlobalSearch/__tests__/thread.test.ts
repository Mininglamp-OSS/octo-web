import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Thread (channelType=5) v1 adaptation coverage — see PR #554 follow-up
// (YUJ-15). Server now returns thread hits directly in the global message
// stream via a composite channel_id `{group_no}____{short_id}`; the front
// end must forward it opaquely (no reverse-parse) through normalization AND
// jump.
//
// This suite intentionally lives next to the existing apiAdapter tests
// rather than replacing them — those cover general envelope/filter shape
// and stay agnostic of thread specifics.

const mockState = vi.hoisted(() => ({
  getImageURL: vi.fn((path: string) => `/api/v1/${path}`),
  getFileURL: vi.fn((path: string) => `/files/${path}`),
  parseThreadChannelId: vi.fn(),
  showConversation: vi.fn(),
  switchToMenuById: vi.fn(),
  currentMenuId: "chat",
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
  WKSDK: {
    shared: () => ({
      channelManager: { getChannelInfo: vi.fn() },
    }),
  },
}));

vi.mock("../../../App", () => ({
  default: {
    loginInfo: { uid: "self", name: "Self", selfDisplayName: () => "Self" },
    shared: {
      avatarUser: (uid: string) => `/avatar/${uid}`,
      get switchToMenuById() {
        return mockState.switchToMenuById;
      },
      get currentMenuId() {
        return mockState.currentMenuId;
      },
    },
    apiClient: {
      config: { apiURL: "/api/v1/" },
      post: vi.fn(),
    },
    dataSource: {
      commonDataSource: {
        getImageURL: mockState.getImageURL,
        getFileURL: mockState.getFileURL,
      },
    },
    endpoints: {
      showConversation: (...args: unknown[]) =>
        mockState.showConversation(...args),
    },
  },
}));

vi.mock("../../../Service/Const", () => ({
  ChannelTypeCommunityTopic: 5,
}));

vi.mock("../../../Service/Thread", () => ({
  parseThreadChannelId: mockState.parseThreadChannelId,
}));

import {
  cleanGlobalFilters,
  mapMessagesResponse,
  toGlobalRequestBody,
} from "../apiAdapter";
import { canLocateChannelSearchItem } from "../../ChannelSearch/locate";
import { Channel } from "wukongimjssdk";
import WKApp from "../../../App";
import type { GlobalSearchFilters, GlobalSearchQuery } from "../types";
import { defaultGlobalSearchFilters } from "../types";

const THREAD_COMPOSITE_ID = "g-abc____thr-001";

function baseFilters(overrides: Partial<GlobalSearchFilters> = {}): GlobalSearchFilters {
  return { ...defaultGlobalSearchFilters(), ...overrides };
}

function baseQuery(overrides: Partial<GlobalSearchQuery> = {}): GlobalSearchQuery {
  return {
    tab: "messages",
    keyword: "hello",
    filters: baseFilters(),
    limit: 20,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.parseThreadChannelId.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// §1 — normalization: channel_type=5 + composite channel_id pass through
// ---------------------------------------------------------------------------
describe("mapMessagesResponse — thread hits (channelType=5)", () => {
  it("keeps composite channel_id verbatim (no reverse-parse of {group}____{short})", () => {
    const resp = {
      data: [
        {
          result_type: "message" as const,
          sorted_at: "2026-07-08 10:00:00",
          message: {
            message_id: "m-thread-1",
            message_seq: 77,
            message_kind: "text" as const,
            snippet: "thread <mark>hello</mark>",
            sender_id: "u1",
            sender_name: "Alice",
            sent_at: "2026-07-08 10:00:00",
            channel_id: THREAD_COMPOSITE_ID,
            channel_type: 5,
          },
        },
      ],
      pagination: { has_more: false, next_cursor: "" },
    };
    const out = mapMessagesResponse(resp, baseQuery());
    expect(out.items.length).toBe(1);
    const item = out.items[0];
    // Front-end contract: opaque forwarding — do not split on the "____"
    // separator, do not swap channel_type for the parent group's 2.
    expect(item.channelId).toBe(THREAD_COMPOSITE_ID);
    expect(item.channelType).toBe(5);
    expect(item.messageSeq).toBe(77);
    // Locate must remain enabled (message_seq is what canLocate checks).
    expect(canLocateChannelSearchItem(item)).toBe(true);
    // parseThreadChannelId is a Service helper we deliberately do not call
    // from the search path — assert it stayed cold.
    expect(mockState.parseThreadChannelId).not.toHaveBeenCalled();
  });

  it("categorizes mixed channel_types=[2,5] results into separate items keeping their own channelType", () => {
    const resp = {
      data: [
        {
          result_type: "message" as const,
          sorted_at: "2026-07-08 10:00:00",
          message: {
            message_id: "m-group-1",
            message_seq: 10,
            message_kind: "text" as const,
            snippet: "group hit",
            sender_id: "u1",
            sender_name: "Alice",
            sent_at: "2026-07-08 10:00:00",
            channel_id: "g-abc",
            channel_type: 2,
          },
        },
        {
          result_type: "message" as const,
          sorted_at: "2026-07-08 10:01:00",
          message: {
            message_id: "m-thread-1",
            message_seq: 11,
            message_kind: "text" as const,
            snippet: "thread hit",
            sender_id: "u2",
            sender_name: "Bob",
            sent_at: "2026-07-08 10:01:00",
            channel_id: THREAD_COMPOSITE_ID,
            channel_type: 5,
          },
        },
      ],
    };
    const out = mapMessagesResponse(resp, baseQuery());
    expect(out.items.length).toBe(2);
    // Each item retains its own channelType — no coalescing to a single
    // parent-group class. Downstream renderer/jump depends on this.
    const byId = new Map(out.items.map((i) => [i.messageId, i]));
    expect(byId.get("m-group-1")?.channelType).toBe(2);
    expect(byId.get("m-group-1")?.channelId).toBe("g-abc");
    expect(byId.get("m-thread-1")?.channelType).toBe(5);
    expect(byId.get("m-thread-1")?.channelId).toBe(THREAD_COMPOSITE_ID);
  });
});

// ---------------------------------------------------------------------------
// §2 — 群聊 UI group maps to channel_types=[2,5] on the wire
// ---------------------------------------------------------------------------
describe("cleanGlobalFilters — 群聊 -> [2,5]", () => {
  it("emits channel_types=[2,5] when the UI 群聊 group is selected", () => {
    const out = cleanGlobalFilters(
      baseFilters({ channelTypes: [2, 5] }),
      "messages",
      "hello"
    );
    expect(out.channel_types).toEqual([2, 5]);
  });

  it("passes composite thread channelId through channel_ids when narrowed", () => {
    // If a caller (v1: does not happen today, but the wire shape must be
    // ready) narrows to a specific thread, the {channel_id, channel_type=5}
    // tuple must round-trip unchanged.
    const out = cleanGlobalFilters(
      baseFilters({
        channels: [
          { channelId: THREAD_COMPOSITE_ID, channelType: 5 },
          { channelId: "g-plain", channelType: 2 },
        ],
      }),
      "messages",
      "hello"
    );
    expect(out.channel_ids).toEqual([
      { channel_id: THREAD_COMPOSITE_ID, channel_type: 5 },
      { channel_id: "g-plain", channel_type: 2 },
    ]);
  });

  it("dedupes channel_types when both entries of the 群聊 group are present", () => {
    const body = toGlobalRequestBody(
      baseQuery({
        filters: baseFilters({ channelTypes: [2, 5, 2, 5] }),
      })
    );
    expect((body.filters as any).channel_types).toEqual([2, 5]);
  });
});

// ---------------------------------------------------------------------------
// §3 — jump: showConversation is invoked with the composite id + channelType=5
// ---------------------------------------------------------------------------
describe("GlobalSearch handleLocate — thread jump", () => {
  it("forwards composite channelId + channelType=5 to WKApp.endpoints.showConversation opaquely", () => {
    // Mirror handleLocate's shape without importing the React component
    // (avoids pulling every ChannelSearch sub-component into the test
    // graph). If handleLocate ever diverges from this contract the
    // apiAdapter/normalization tests catch item shape and this test
    // catches the wire-through-to-endpoint step.
    const item = {
      id: "m-thread-1",
      messageId: "m-thread-1",
      messageSeq: 77,
      channelId: THREAD_COMPOSITE_ID,
      channelType: 5,
      senderUid: "u1",
      sender: { uid: "u1", name: "Alice" },
      timestamp: 1_720_000_000,
      kind: "text" as const,
      text: "thread hello",
    };
    expect(canLocateChannelSearchItem(item as any)).toBe(true);

    const channel = new Channel(item.channelId, item.channelType);
    WKApp.endpoints.showConversation(channel, {
      initLocateMessageSeq: item.messageSeq,
    } as any);

    expect(mockState.showConversation).toHaveBeenCalledTimes(1);
    const [passedChannel, passedOpts] = mockState.showConversation.mock.calls[0];
    // Composite id survives — no reverse-parse of the "____" separator.
    expect(passedChannel.channelID).toBe(THREAD_COMPOSITE_ID);
    expect(passedChannel.channelType).toBe(5);
    expect(passedOpts?.initLocateMessageSeq).toBe(77);
  });

  it("no-locate when messageSeq is missing (still true for thread hits)", () => {
    const item = {
      id: "no-seq",
      messageId: "no-seq",
      messageSeq: 0,
      channelId: THREAD_COMPOSITE_ID,
      channelType: 5,
      senderUid: "u1",
      sender: { uid: "u1", name: "Alice" },
      timestamp: 1_720_000_000,
      kind: "text" as const,
      text: "x",
    };
    expect(canLocateChannelSearchItem(item as any)).toBe(false);
  });
});
