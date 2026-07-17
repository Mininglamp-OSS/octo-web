// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  searchGroups: vi.fn(),
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class Channel {
    constructor(public channelID: string, public channelType: number) {}
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
}));

vi.mock("../../../App", () => ({
  default: {
    shared: {
      avatarUser: (uid: string) => `user:${uid}`,
      avatarChannel: ({ channelID }: { channelID: string }) =>
        `channel:${channelID}`,
    },
  },
}));

vi.mock("../../../Service/GlobalMessageSearchService", () => ({
  default: { searchGroups: hoisted.searchGroups },
}));

import {
  type ChannelSearchItem,
  defaultGlobalSearchFilters,
  type GlobalSearchDataSource,
  type GlobalSearchQuery,
} from "../../../Service/SearchTypes";
import useGlobalChatSearch from "../useGlobalChatSearch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function item(id: string, channelId: string): ChannelSearchItem {
  return {
    id,
    messageId: id,
    messageSeq: 1,
    channelId,
    channelType: 1,
    senderUid: "sender",
    timestamp: 1,
    kind: "text",
    text: id,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useGlobalChatSearch", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    hoisted.searchGroups.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    vi.useRealTimers();
  });

  it("does not append a stale page after switching conversations", async () => {
    const stalePage = deferred<{
      items: ChannelSearchItem[];
      hasMore: boolean;
      nextCursor?: string;
    }>();
    let stalePageQuery: GlobalSearchQuery | undefined;
    const searchMessages = vi.fn((query: GlobalSearchQuery) => {
      const channelId = query.filters.channels[0]?.channelId;
      if (channelId === "a" && query.cursor === "a-next") {
        stalePageQuery = query;
        return stalePage.promise;
      }
      if (channelId === "a") {
        return Promise.resolve({
          items: [item("a-1", "a")],
          hasMore: true,
          nextCursor: "a-next",
        });
      }
      return Promise.resolve({
        items: [item("b-1", "b")],
        hasMore: false,
      });
    });
    const dataSource: GlobalSearchDataSource = {
      getSenders: () => [],
      getSender: (uid) => ({ uid, name: uid, avatarUrl: `avatar:${uid}` }),
      getSelfUid: () => "self",
      searchMessages,
      getFileTypeCategories: async () => [],
    };
    hoisted.searchGroups.mockResolvedValue({
      data: {
        sequence: 1,
        groups: [
          { channel_id: "a", channel_type: 1, group_name: "A" },
          { channel_id: "b", channel_type: 1, group_name: "B" },
        ],
      },
      pagination: { has_more: false },
    });

    const filters = defaultGlobalSearchFilters();
    let latest: ReturnType<typeof useGlobalChatSearch> | undefined;
    function Probe() {
      latest = useGlobalChatSearch({
        keyword: "octo",
        filters,
        dataSource,
        isActive: true,
      });
      return null;
    }

    act(() => {
      ReactDOM.render(<Probe />, container);
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await flushMicrotasks();
    });
    expect(latest?.selectedKey).toBe("1:a");
    expect(latest?.result.items.map((entry) => entry.id)).toEqual(["a-1"]);

    act(() => {
      void latest?.loadMore();
    });
    expect(stalePageQuery?.signal).toBeInstanceOf(AbortSignal);

    await act(async () => {
      latest?.selectConversation("1:b");
      await flushMicrotasks();
    });
    expect(stalePageQuery?.signal?.aborted).toBe(true);
    expect(latest?.result.items.map((entry) => entry.id)).toEqual(["b-1"]);

    await act(async () => {
      stalePage.resolve({
        items: [item("a-2", "a")],
        hasMore: false,
      });
      await flushMicrotasks();
    });
    expect(latest?.result.items.map((entry) => entry.id)).toEqual(["b-1"]);
  });
});
