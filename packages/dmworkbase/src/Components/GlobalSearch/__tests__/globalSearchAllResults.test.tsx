import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ImChannelInfoLike,
  ImChannelInfoListener,
} from "../../../im-runtime/channelRuntime";
import type { LegacyGlobalSearchContact } from "../../../Service/SearchService";
import {
  defaultGlobalSearchFilters,
  type GlobalSearchDataSource,
} from "../../../Service/SearchTypes";
import GlobalSearchAllPanel from "../GlobalSearchAllPanel";

const fixture = vi.hoisted(() => ({
  cache: new Map<string, ImChannelInfoLike>(),
  listeners: new Set<ImChannelInfoListener>(),
  fetchChannel: vi.fn(),
  searchGroups: vi.fn(),
}));
vi.mock("../../../App", () => ({
  default: {
    shared: {
      currentSpaceId: "internal",
      avatarUser: (uid: string) => `user:${uid}`,
      avatarGroup: (uid: string) => `group:${uid}`,
      avatarChannel: () => "avatar",
    },
  },
}));
vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: (channel: { channelID: string }) =>
    fixture.cache.get(channel.channelID),
  fetchCurrentImChannelInfo: fixture.fetchChannel,
  addCurrentImChannelInfoListener: (listener: ImChannelInfoListener) => {
    fixture.listeners.add(listener);
    return () => {
      fixture.listeners.delete(listener);
    };
  },
}));
vi.mock("../../../Service/GlobalMessageSearchService", () => ({
  default: { searchGroups: fixture.searchGroups },
}));
vi.mock("../../WKAvatar", () => ({ default: () => null, isBot: () => false }));
vi.mock("../../ChannelSearch", () => ({ FileResultItem: () => null }));
vi.mock("../../BotDetailModal", () => ({ default: () => null }));

function mountPanel({
  friends = [],
  keyword = "Alex",
  isActive = true,
  contentSearchEnabled = false,
}: {
  friends?: LegacyGlobalSearchContact[];
  keyword?: string;
  isActive?: boolean;
  contentSearchEnabled?: boolean;
} = {}) {
  const searchMessages = vi
    .fn()
    .mockResolvedValue({ items: [], hasMore: false });
  const dataSource: GlobalSearchDataSource = {
    getSelfUid: () => "self",
    getSenders: () => [],
    getSender: (uid) => ({ uid, name: uid }),
    getFileTypeCategories: async () => [],
    searchMessages,
  };
  const props = {
    keyword,
    friends,
    isActive,
    contentSearchEnabled,
    dataSource,
    filters: defaultGlobalSearchFilters(),
    docsEnabled: false,
    driveEnabled: false,
    onSelectTab: vi.fn(),
    onOpenConversation: vi.fn(),
    onClick: () => vi.fn(),
    onLocateMessage: vi.fn(),
    onOpenDoc: vi.fn(),
    onOpenDriveHit: vi.fn(),
  };
  return {
    ...render(<GlobalSearchAllPanel {...props} />),
    props,
    searchMessages,
  };
}

beforeEach(() => {
  fixture.cache.clear();
  fixture.listeners.clear();
  fixture.fetchChannel.mockReset().mockResolvedValue(undefined);
  fixture.searchGroups.mockReset().mockResolvedValue({ data: { groups: [] } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("aggregate search results", () => {
  it("does not fetch metadata for results hidden behind the start hint", () => {
    mountPanel({
      keyword: "",
      friends: [{ channel_id: "alex", channel_type: 1, channel_name: "Alex" }],
    });
    expect(screen.queryByText("Alex")).toBeNull();
    expect(fixture.fetchChannel).not.toHaveBeenCalled();
    expect(fixture.listeners.size).toBe(0);
  });

  it.each([
    { home_space_id: "external", home_space_name: "Partner" },
    { orgData: { home_space_id: "external", home_space_name: "Partner" } },
    { is_external: 1, source_space_name: "Partner" },
  ])("shows the external source from result metadata: %j", (metadata) => {
    mountPanel({
      friends: [
        {
          channel_id: "alex",
          channel_type: 1,
          channel_name: "Alex",
          ...metadata,
        },
      ],
    });
    expect(screen.getByText("@Partner")).toBeInTheDocument();
    expect(fixture.fetchChannel).not.toHaveBeenCalled();
  });

  it("does not label a current-space contact as external even if its cached metadata is stale", () => {
    fixture.cache.set("alex", {
      channel: { channelID: "alex", channelType: 1 },
      orgData: { home_space_id: "external", home_space_name: "Partner" },
    });
    mountPanel({
      friends: [
        {
          channel_id: "alex",
          channel_type: 1,
          channel_name: "Alex",
          home_space_id: "internal",
          home_space_name: "Internal",
        },
      ],
    });
    expect(screen.queryByText("@Partner")).toBeNull();
    expect(screen.queryByText("@Internal")).toBeNull();
    expect(fixture.fetchChannel).not.toHaveBeenCalled();
  });

  it("uses cached source metadata without fetching it again", () => {
    fixture.cache.set("alex", {
      channel: { channelID: "alex", channelType: 1 },
      orgData: { home_space_id: "external", home_space_name: "Partner" },
    });
    mountPanel({
      friends: [{ channel_id: "alex", channel_type: 1, channel_name: "Alex" }],
    });
    expect(screen.getByText("@Partner")).toBeInTheDocument();
    expect(fixture.fetchChannel).not.toHaveBeenCalled();
  });

  it("fetches missing metadata only while active and updates labels when it arrives", () => {
    const view = mountPanel({
      friends: [{ channel_id: "alex", channel_type: 1, channel_name: "Alex" }],
      isActive: false,
    });
    expect(fixture.fetchChannel).not.toHaveBeenCalled();
    expect(fixture.listeners.size).toBe(0);
    view.rerender(<GlobalSearchAllPanel {...view.props} isActive />);
    expect(fixture.fetchChannel).toHaveBeenCalledOnce();
    expect(fixture.fetchChannel).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "alex", channelType: 1 })
    );
    act(() => {
      const info = {
        channel: { channelID: "alex", channelType: 1 },
        orgData: { home_space_id: "external", home_space_name: "Partner" },
      };
      fixture.cache.set("alex", info);
      fixture.listeners.forEach((listener) => listener(info));
    });
    expect(screen.getByText("@Partner")).toBeInTheDocument();
    expect(fixture.fetchChannel).toHaveBeenCalledOnce();
    view.unmount();
    expect(fixture.listeners.size).toBe(0);
  });

  it("renders conversation previews without fetching the first conversation's details", async () => {
    fixture.searchGroups.mockResolvedValue({
      data: {
        groups: [
          { channel_id: "a", channel_type: 1, group_name: "Conversation A" },
        ],
      },
    });
    const view = mountPanel({ contentSearchEnabled: true });
    await waitFor(() =>
      expect(screen.getByText("Conversation A")).toBeInTheDocument()
    );
    expect(fixture.searchGroups).toHaveBeenCalledOnce();
    expect(view.searchMessages).toHaveBeenCalledOnce();
    expect(view.searchMessages).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "files", limit: 3 })
    );
  });
});
