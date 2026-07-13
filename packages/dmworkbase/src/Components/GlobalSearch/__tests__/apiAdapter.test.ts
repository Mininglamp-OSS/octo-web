import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  getImageURL: vi.fn((path: string) => `/api/v1/${path}`),
  getFileURL: vi.fn((path: string) => `/files/${path}`),
  parseThreadChannelId: vi.fn(),
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }

    isEqual(other: any) {
      return (
        this.channelID === other?.channelID &&
        this.channelType === other?.channelType
      );
    }

    getChannelKey() {
      return `${this.channelID}-${this.channelType}`;
    }
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
  WKSDK: {
    shared: () => ({
      channelManager: {
        getChannelInfo: vi.fn(),
      },
    }),
  },
}));

vi.mock("../../../App", () => ({
  default: {
    loginInfo: {
      uid: "self",
      name: "Fallback Self",
      selfDisplayName: () => "Self Name",
    },
    shared: {
      avatarUser: (uid: string) => `/avatar/${uid}`,
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
      channelDataSource: {
        subscribers: vi.fn(),
      },
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
  cnDatePresetRange,
  endOfCnDaySeconds,
  foldResponse,
  globalSearchEndpoint,
  hasEffectiveGlobalFilters,
  mapFilesResponse,
  mapMessagesResponse,
  secondsToDateOnlyCN,
  shouldRunGlobalSearch,
  startOfCnDaySeconds,
  toGlobalRequestBody,
} from "../apiAdapter";
import type { GlobalSearchFilters, GlobalSearchQuery } from "../types";
import { defaultGlobalSearchFilters } from "../types";

function baseFilters(overrides: Partial<GlobalSearchFilters> = {}): GlobalSearchFilters {
  return { ...defaultGlobalSearchFilters(), ...overrides };
}

function baseQuery(
  overrides: Partial<GlobalSearchQuery> = {}
): GlobalSearchQuery {
  return {
    tab: "messages",
    keyword: "project",
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
// §11 timezone contract
// ---------------------------------------------------------------------------

describe("secondsToDateOnlyCN", () => {
  it("returns undefined for missing/zero epochs", () => {
    expect(secondsToDateOnlyCN(undefined)).toBeUndefined();
    expect(secondsToDateOnlyCN(0)).toBeUndefined();
  });

  it("uses Asia/Shanghai calendar day regardless of runtime timezone", () => {
    // 2026-01-01T20:00:00Z is 2026-01-02T04:00 in CN. Serializing must yield
    // the CN date (2026-01-02), not the UTC date (2026-01-01) that a
    // browser-tz-based formatter would emit for any tz west of CN.
    const utcEvening = Date.UTC(2026, 0, 1, 20, 0, 0) / 1000;
    expect(secondsToDateOnlyCN(utcEvening)).toBe("2026-01-02");

    // 2026-01-02T15:59:59Z is still 2026-01-02 23:59:59 in CN.
    const cnEndOfDay = Date.UTC(2026, 0, 2, 15, 59, 59) / 1000;
    expect(secondsToDateOnlyCN(cnEndOfDay)).toBe("2026-01-02");

    // 2026-01-02T16:00:00Z is 2026-01-03 00:00 CN.
    const cnRollover = Date.UTC(2026, 0, 2, 16, 0, 0) / 1000;
    expect(secondsToDateOnlyCN(cnRollover)).toBe("2026-01-03");
  });

  it("zero-pads single-digit month and day", () => {
    // 2026-03-05 00:00 CN == 2026-03-04 16:00 UTC
    const ts = Date.UTC(2026, 2, 4, 16, 30, 0) / 1000;
    expect(secondsToDateOnlyCN(ts)).toBe("2026-03-05");
  });
});

describe("cnDatePresetRange", () => {
  // Cross-check helper: turn a CN-anchored epoch second back into its
  // CN-calendar YYYY-MM-DD label. If the range math is right, both endpoints
  // fall inside the expected CN calendar days.
  const cnDay = (s: number) => secondsToDateOnlyCN(s);

  it("today: LA user at CN 07-08 10:00 gets the single CN day 2026-07-08", () => {
    // 2026-07-08 10:00 in CN is 2026-07-08 02:00 UTC, which is 2026-07-07
    // 19:00 local for America/Los_Angeles (UTC-7 in July). If we mistakenly
    // used the browser tz for "startOfDay", the range would straddle
    // 2026-07-07 → 2026-07-08 in CN.
    const now = new Date(Date.UTC(2026, 6, 8, 2, 0, 0));
    const { startAt, endAt } = cnDatePresetRange(1, now);
    expect(cnDay(startAt!)).toBe("2026-07-08");
    expect(cnDay(endAt!)).toBe("2026-07-08");
    // endAt is inclusive: last second of the CN day.
    expect(endAt! - startAt! + 1).toBe(24 * 3600);
  });

  it("today: LA user at CN 07-08 15:00 (LA still 07-08 previous day) still gets 07-08", () => {
    // Instant 2026-07-08 07:00 UTC == CN 15:00 same day, LA 00:00 same day.
    const now = new Date(Date.UTC(2026, 6, 8, 7, 0, 0));
    const { startAt, endAt } = cnDatePresetRange(1, now);
    expect(cnDay(startAt!)).toBe("2026-07-08");
    expect(cnDay(endAt!)).toBe("2026-07-08");
  });

  it("today: instant just after CN midnight resolves to the new CN day", () => {
    // 2026-07-07 16:00:01 UTC == 2026-07-08 00:00:01 CN.
    const now = new Date(Date.UTC(2026, 6, 7, 16, 0, 1));
    const { startAt, endAt } = cnDatePresetRange(1, now);
    expect(cnDay(startAt!)).toBe("2026-07-08");
    expect(cnDay(endAt!)).toBe("2026-07-08");
  });

  it("today: instant right before CN midnight resolves to the previous CN day", () => {
    // 2026-07-08 15:59:59 UTC == 2026-07-08 23:59:59 CN.
    const now = new Date(Date.UTC(2026, 6, 8, 15, 59, 59));
    const { startAt, endAt } = cnDatePresetRange(1, now);
    expect(cnDay(startAt!)).toBe("2026-07-08");
    expect(cnDay(endAt!)).toBe("2026-07-08");
  });

  it("last_7_days spans 7 CN calendar days ending today", () => {
    const now = new Date(Date.UTC(2026, 6, 8, 2, 0, 0));
    const { startAt, endAt } = cnDatePresetRange(7, now);
    expect(cnDay(startAt!)).toBe("2026-07-02");
    expect(cnDay(endAt!)).toBe("2026-07-08");
  });

  it("last_30_days spans 30 CN calendar days ending today", () => {
    const now = new Date(Date.UTC(2026, 6, 8, 2, 0, 0));
    const { startAt, endAt } = cnDatePresetRange(30, now);
    expect(cnDay(startAt!)).toBe("2026-06-09");
    expect(cnDay(endAt!)).toBe("2026-07-08");
  });
});

describe("startOfCnDaySeconds / endOfCnDaySeconds", () => {
  it("start / end bracket exactly one CN calendar day", () => {
    const at = new Date(Date.UTC(2026, 6, 8, 5, 30, 0)); // CN 13:30 07-08
    const s = startOfCnDaySeconds(at)!;
    const e = endOfCnDaySeconds(at)!;
    expect(secondsToDateOnlyCN(s)).toBe("2026-07-08");
    expect(secondsToDateOnlyCN(e)).toBe("2026-07-08");
    expect(e - s + 1).toBe(24 * 3600);
  });
});

// ---------------------------------------------------------------------------
// endpoint / envelope basics
// ---------------------------------------------------------------------------

describe("globalSearchEndpoint", () => {
  it("routes files vs messages tab to distinct backend endpoints", () => {
    expect(globalSearchEndpoint("files")).toBe("messages/_search_global_files");
    expect(globalSearchEndpoint("messages")).toBe(
      "messages/_search_global_messages"
    );
  });
});

// ---------------------------------------------------------------------------
// filter cleaning / wire body
// ---------------------------------------------------------------------------

describe("cleanGlobalFilters", () => {
  it("emits channel_ids as {channel_id, channel_type} objects", () => {
    const out = cleanGlobalFilters(
      baseFilters({
        channels: [
          { channelId: "g1", channelType: 2 },
          { channelId: "u2", channelType: 1 },
        ],
      }),
      "messages",
      "project"
    );
    expect(out.channel_ids).toEqual([
      { channel_id: "g1", channel_type: 2 },
      { channel_id: "u2", channel_type: 1 },
    ]);
  });

  it("caps sender_ids at 50 entries", () => {
    const many = Array.from({ length: 60 }, (_, i) => `u${i}`);
    const out = cleanGlobalFilters(
      baseFilters({ senderUids: many }),
      "messages",
      "project"
    );
    expect((out.sender_ids as string[]).length).toBe(50);
    expect((out.sender_ids as string[])[0]).toBe("u0");
    expect((out.sender_ids as string[])[49]).toBe("u49");
  });

  it("drops member_uid when it equals selfUid", () => {
    const withSelf = cleanGlobalFilters(
      baseFilters({ memberUid: "self" }),
      "messages",
      "project",
      "self"
    );
    expect(withSelf.member_uid).toBeUndefined();

    const withOther = cleanGlobalFilters(
      baseFilters({ memberUid: "peer" }),
      "messages",
      "project",
      "self"
    );
    expect(withOther.member_uid).toBe("peer");
  });

  it("drops content_types 2/5 in messages tab when keyword is present", () => {
    const out = cleanGlobalFilters(
      baseFilters({ contentTypes: [1, 2, 5, 8, 14, 11] }),
      "messages",
      "hello"
    );
    // 2 (image) and 5 (video) are keyword-forbidden → stripped
    expect(out.content_types).toEqual([1, 8, 14, 11]);
  });

  it("keeps content_types 2/5 in messages tab when keyword is empty (browse mode)", () => {
    const out = cleanGlobalFilters(
      baseFilters({ contentTypes: [1, 2, 5, 8] }),
      "messages",
      "   " // whitespace-only counts as empty
    );
    expect(out.content_types).toEqual([1, 2, 5, 8]);
  });

  it("omits content_types entirely on files tab", () => {
    const out = cleanGlobalFilters(
      baseFilters({ contentTypes: [1, 2, 5, 8] }),
      "files",
      "project"
    );
    expect(out.content_types).toBeUndefined();
  });

  it("passes file_size_min/max through as bytes (files tab)", () => {
    const out = cleanGlobalFilters(
      baseFilters({ fileSizeMin: 10 * 1024, fileSizeMax: 5 * 1024 * 1024 }),
      "files",
      ""
    );
    expect(out.file_size_min).toBe(10 * 1024);
    expect(out.file_size_max).toBe(5 * 1024 * 1024);
  });

  it("normalizes file_exts to lowercase without leading dot", () => {
    const out = cleanGlobalFilters(
      baseFilters({ fileExts: [".PDF", "DoCx", "  txt  "] }),
      "files",
      ""
    );
    expect(out.file_exts).toEqual(["pdf", "docx", "txt"]);
  });

  it("serializes sent_at_from/to via CN tz", () => {
    // startAt at 2026-01-01T20:00Z (CN 01-02 04:00) → sent_at_from=2026-01-02
    const startAt = Date.UTC(2026, 0, 1, 20, 0, 0) / 1000;
    const endAt = Date.UTC(2026, 0, 3, 15, 59, 59) / 1000;
    const out = cleanGlobalFilters(
      baseFilters({ startAt, endAt }),
      "messages",
      "project"
    );
    expect(out.sent_at_from).toBe("2026-01-02");
    expect(out.sent_at_to).toBe("2026-01-03");
  });
});

describe("hasEffectiveGlobalFilters", () => {
  it("is false for default filters", () => {
    expect(hasEffectiveGlobalFilters(baseFilters())).toBe(false);
  });

  it("is true when any filter is populated", () => {
    expect(
      hasEffectiveGlobalFilters(baseFilters({ senderUids: ["u1"] }))
    ).toBe(true);
    expect(
      hasEffectiveGlobalFilters(baseFilters({ memberUid: "u1" }))
    ).toBe(true);
    expect(
      hasEffectiveGlobalFilters(
        baseFilters({ channels: [{ channelId: "g", channelType: 2 }] })
      )
    ).toBe(true);
    expect(
      hasEffectiveGlobalFilters(baseFilters({ fileSizeMin: 100 }))
    ).toBe(true);
    expect(
      hasEffectiveGlobalFilters(baseFilters({ datePreset: "today" }))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldRunGlobalSearch
// ---------------------------------------------------------------------------

describe("shouldRunGlobalSearch", () => {
  it("files tab always runs (browse-mode allowed)", () => {
    expect(shouldRunGlobalSearch("files", "", baseFilters())).toBe(true);
    expect(shouldRunGlobalSearch("files", "   ", baseFilters())).toBe(true);
    expect(shouldRunGlobalSearch("files", "kw", baseFilters())).toBe(true);
  });

  it("messages tab needs keyword OR a real filter", () => {
    // Empty keyword + no filters → do not fire (backend rejects).
    expect(shouldRunGlobalSearch("messages", "", baseFilters())).toBe(false);
    expect(shouldRunGlobalSearch("messages", "   ", baseFilters())).toBe(false);

    // Keyword alone.
    expect(shouldRunGlobalSearch("messages", "hello", baseFilters())).toBe(
      true
    );

    // Filter alone (no keyword).
    expect(
      shouldRunGlobalSearch(
        "messages",
        "",
        baseFilters({ senderUids: ["u1"] })
      )
    ).toBe(true);
    expect(
      shouldRunGlobalSearch(
        "messages",
        "",
        baseFilters({ datePreset: "today" })
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wire body composition (integration of cleanGlobalFilters + top-level fields)
// ---------------------------------------------------------------------------

describe("toGlobalRequestBody", () => {
  it("packs keyword, cursor, sort, page_size and filters into the wire body", () => {
    const body = toGlobalRequestBody(
      baseQuery({
        keyword: "  project  ",
        cursor: "next-cursor",
        limit: 30,
        filters: baseFilters({
          senderUids: ["u1", "u2"],
          sort: "time_asc",
        }),
      })
    );
    expect(body).toMatchObject({
      keyword: "project",
      sort: "time_asc",
      page_size: 30,
      cursor: "next-cursor",
    });
    expect((body.filters as any).sender_ids).toEqual(["u1", "u2"]);
  });

  it("passes empty cursor as empty string (not omitted)", () => {
    const body = toGlobalRequestBody(baseQuery({ cursor: undefined }));
    expect(body.cursor).toBe("");
  });
});

// ---------------------------------------------------------------------------
// response envelope unpacking
// ---------------------------------------------------------------------------

describe("mapMessagesResponse", () => {
  it("unpacks {data, pagination} envelope and forwards pagination", () => {
    const resp = {
      data: [
        {
          result_type: "message" as const,
          sorted_at: "2026-07-08 10:00:00",
          message: {
            message_id: "m1",
            message_seq: 42,
            message_kind: "text" as const,
            snippet: "hello <mark>world</mark>",
            sender_id: "u1",
            sender_name: "Alice",
            sent_at: "2026-07-08 10:00:00",
            channel_id: "g1",
            channel_type: 2,
          },
        },
      ],
      pagination: { has_more: true, next_cursor: "cur-2" },
    };
    const out = mapMessagesResponse(resp, baseQuery({ tab: "messages" }));
    expect(out.pagination).toEqual({ has_more: true, next_cursor: "cur-2" });
    expect(out.items.length).toBe(1);
    expect(out.items[0].messageId).toBe("m1");
    expect(out.items[0].messageSeq).toBe(42);
  });

  it("handles empty envelope", () => {
    const out = mapMessagesResponse({ data: [] }, baseQuery({ tab: "messages" }));
    expect(out.items).toEqual([]);
    expect(out.pagination).toBeUndefined();
  });

  it("handles undefined-shaped response gracefully", () => {
    const out = mapMessagesResponse(undefined, baseQuery({ tab: "messages" }));
    expect(out.items).toEqual([]);
    expect(out.pagination).toBeUndefined();
  });
});

describe("mapFilesResponse", () => {
  it("unpacks {data, pagination} envelope for the files tab", () => {
    const resp = {
      data: [
        {
          message_id: "f1",
          message_seq: 7,
          sender_id: "u9",
          sent_at: "2026-07-08 12:00:00",
          channel_id: "g2",
          channel_type: 2,
          file: {
            name: "spec.pdf",
            size: 12345,
            url: "/f/spec.pdf",
            extension: "pdf",
          },
        },
      ],
      pagination: { has_more: false, next_cursor: "" },
    };
    const out = mapFilesResponse(resp, baseQuery({ tab: "files" }));
    expect(out.items.length).toBe(1);
    expect(out.items[0].kind).toBe("file");
    expect(out.pagination).toEqual({ has_more: false, next_cursor: "" });
  });

  it("handles empty envelope", () => {
    const out = mapFilesResponse({ data: [] }, baseQuery({ tab: "files" }));
    expect(out.items).toEqual([]);
  });
});

describe("foldResponse", () => {
  it("collapses items + pagination into GlobalSearchResponse", () => {
    const folded = foldResponse([{ id: "x" } as any], {
      has_more: true,
      next_cursor: "cur",
    });
    expect(folded).toEqual({
      items: [{ id: "x" }],
      nextCursor: "cur",
      hasMore: true,
    });
  });

  it("treats missing pagination as no more pages", () => {
    const folded = foldResponse([]);
    expect(folded.hasMore).toBe(false);
    expect(folded.nextCursor).toBeUndefined();
  });
});
