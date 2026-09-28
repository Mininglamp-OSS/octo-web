import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    emojiService: {
      emojiRegExp: () => /$^/,
      getImage: () => "",
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
  docsEnabled = false,
  docsError = false,
  legacyError = false,
}: {
  friends?: LegacyGlobalSearchContact[];
  keyword?: string;
  isActive?: boolean;
  contentSearchEnabled?: boolean;
  docsEnabled?: boolean;
  docsError?: boolean;
  legacyError?: boolean;
} = {}) {
  const searchMessages = vi
    .fn()
    .mockResolvedValue({ items: [], hasMore: false });
  const searchDocs = vi
    .fn()
    .mockImplementation(() =>
      docsError
        ? Promise.reject(new Error("docs search failed"))
        : Promise.resolve({ items: [] })
    );
  const dataSource: GlobalSearchDataSource = {
    getSelfUid: () => "self",
    getSenders: () => [],
    getSender: (uid) => ({ uid, name: uid }),
    getFileTypeCategories: async () => [],
    searchMessages,
    searchDocs,
  };
  const props = {
    keyword,
    friends,
    isActive,
    contentSearchEnabled,
    legacyError,
    dataSource,
    filters: defaultGlobalSearchFilters(),
    docsEnabled,
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
    searchDocs,
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
  it("does not leave aggregate rows mounted while another tab is active", () => {
    const view = mountPanel({
      friends: [{ channel_id: "alex", channel_type: 1, channel_name: "Alex" }],
      isActive: false,
    });

    expect(screen.queryByText("Alex")).toBeNull();
    view.rerender(<GlobalSearchAllPanel {...view.props} isActive />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });

  it("does not fetch metadata for results hidden behind the start hint", () => {
    mountPanel({
      keyword: "",
      friends: [{ channel_id: "alex", channel_type: 1, channel_name: "Alex" }],
    });
    expect(screen.queryByText("Alex")).toBeNull();
    expect(fixture.fetchChannel).not.toHaveBeenCalled();
    expect(fixture.listeners.size).toBe(0);
  });

  it("does not claim an empty result after the legacy search failed", () => {
    const view = mountPanel({ legacyError: true });

    expect(
      view.container.querySelector(".wk-global-search-all__hint")
    ).toBeNull();
  });

  it("shows an errored docs section and retries it when contacts have results", async () => {
    const { searchDocs } = mountPanel({
      friends: [{ channel_id: "alex", channel_type: 1, channel_name: "Alex" }],
      docsEnabled: true,
      docsError: true,
    });

    expect(screen.getByText("Alex")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "搜索失败，请稍后重试"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(searchDocs).toHaveBeenCalledTimes(2));
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

  it("renders marked conversation previews as highlighted text", async () => {
    fixture.searchGroups.mockResolvedValue({
      data: {
        groups: [
          {
            channel_id: "a",
            channel_type: 1,
            group_name: "Conversation A",
            preview: [
              {
                message_id: "message-a",
                snippet: "hello <mark>Alex</mark> world",
              },
            ],
          },
        ],
      },
    });

    const view = mountPanel({ contentSearchEnabled: true });
    await waitFor(() =>
      expect(screen.getByText("Conversation A")).toBeInTheDocument()
    );

    const preview = view.container.querySelector(
      ".wk-global-search-all__conversation small"
    );
    expect(preview).toHaveTextContent("hello Alex world");
    expect(preview).toContainHTML(
      'hello <mark class="wk-channel-search-highlight">Alex</mark> world'
    );
  });
});
