import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ProviderListener {
    notifyListener = vi.fn();
  }
  class FakeSystemContent {
    content: Record<string, unknown> = {};
    decode = vi.fn();
  }
  const searchLegacyGlobal = vi.fn();
  const messageContent = {
    decode: vi.fn(),
    content: { text: "decoded" },
  };
  const messageContentManager = {
    getMessageContent: vi.fn(() => messageContent),
  };
  const addChannelInfoListener = vi.fn(() => vi.fn());
  const remoteConfig = { docsOn: false, docsSearchOn: false };
  return {
    ProviderListener,
    FakeSystemContent,
    searchLegacyGlobal,
    messageContent,
    messageContentManager,
    addChannelInfoListener,
    remoteConfig,
  };
});

vi.mock("wukongimjssdk", () => ({
  Channel: class {},
  ChannelInfo: class {},
  ChannelInfoListener: class {},
  ChannelTypePerson: 1,
  MessageContentManager: { shared: () => mocks.messageContentManager },
  SystemContent: mocks.FakeSystemContent,
}));

vi.mock("../../../Service/Provider", () => ({
  ProviderListener: mocks.ProviderListener,
}));

vi.mock("../../../Service/SearchService", () => ({
  default: { searchLegacyGlobal: mocks.searchLegacyGlobal },
}));

vi.mock("../../../Service/Const", () => ({
  MessageContentTypeConst: { file: 8 },
}));

vi.mock("../../../App", () => ({
  default: {
    shared: { currentSpaceId: "space-1" },
    loginInfo: {
      uid: "self-uid",
      name: "Alice",
      selfDisplayName: () => "Alice",
    },
    remoteConfig: mocks.remoteConfig,
  },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => `translated:${key}`,
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  addCurrentImChannelInfoListener: mocks.addChannelInfoListener,
  getCurrentImChannelInfo: vi.fn(),
}));

vi.mock("../selfInject", () => ({
  shouldInjectSelf: (keyword: string, name: string) =>
    name.toLowerCase().includes((keyword || "").trim().toLowerCase()),
  buildSelfContactEntry: (uid: string, name: string, channelType: number) => ({
    channel_id: uid,
    channel_type: channelType,
    channel_name: name,
    channel_remark: "",
  }),
}));

import GlobalSearchVM from "../GlobalSearchVM";

const result = (overrides: Record<string, unknown> = {}) => ({
  friends: [],
  groups: [],
  messages: [],
  ...overrides,
});

describe("GlobalSearchVM", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remoteConfig.docsOn = false;
    mocks.remoteConfig.docsSearchOn = false;
    mocks.messageContentManager.getMessageContent.mockReturnValue(
      mocks.messageContent
    );
  });

  it("requests the current page and applies remarks, self injection, and decoded messages", async () => {
    const message = {
      channel: { channel_remark: "Renamed chat", channel_name: "Original" },
      payload: { type: 42, text: "payload" },
    };
    mocks.searchLegacyGlobal.mockResolvedValue(
      result({
        friends: [
          { channel_id: "u1", channel_name: "Bob", channel_remark: "Bobby" },
        ],
        groups: [
          { channel_id: "g1", channel_name: "Group", channel_remark: "Team" },
        ],
        messages: [message],
      })
    );
    const vm = new GlobalSearchVM();
    vm.keyword = "ali";
    vm.page = 2;
    vm.contentTypes = [8];

    vm.requestSearch();
    await vi.waitFor(() => expect(vm.searchResult).toBeTruthy());

    expect(mocks.searchLegacyGlobal).toHaveBeenCalledWith({
      keyword: "ali",
      page: 2,
      limit: 20,
      contentTypes: [8],
      channelId: undefined,
      channelType: undefined,
      onlyMessage: false,
      spaceId: "space-1",
    });
    expect(vm.searchResult.friends[0].channel_name).toBe("Alice");
    expect(vm.searchResult.friends[1].channel_name).toBe("Bobby");
    expect(vm.searchResult.groups[0].channel_name).toBe("Team");
    expect(message.channel.channel_name).toBe("Renamed chat");
    expect(message.content).toBe(mocks.messageContent);
    expect(mocks.messageContent.decode).toHaveBeenCalledWith(
      new TextEncoder().encode(JSON.stringify(message.payload))
    );
    expect(vm.loadFinish).toBe(true);
    expect(vm.loadMoreing).toBe(false);
  });

  it("debounces input and does not search while composing", async () => {
    vi.useFakeTimers();
    mocks.searchLegacyGlobal.mockResolvedValue(result());
    const vm = new GlobalSearchVM();

    vm.isComposing = true;
    vm.handleInputChange("ignored");
    vi.advanceTimersByTime(300);
    expect(mocks.searchLegacyGlobal).not.toHaveBeenCalled();

    vm.isComposing = false;
    vm.handleInputChange("hello");
    vi.advanceTimersByTime(299);
    expect(mocks.searchLegacyGlobal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await vi.waitFor(() =>
      expect(mocks.searchLegacyGlobal).toHaveBeenCalledOnce()
    );
    expect(vm.keyword).toBe("hello");
  });

  it("ignores stale responses and stale failures", async () => {
    let rejectFirst!: (reason?: unknown) => void;
    const staleRequest = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    mocks.searchLegacyGlobal
      .mockReturnValueOnce(staleRequest)
      .mockResolvedValueOnce(result({ friends: [{ channel_id: "new" }] }));
    const vm = new GlobalSearchVM();

    vm.keyword = "old";
    vm.requestSearch();
    vm.keyword = "new";
    vm.requestSearch();
    await vi.waitFor(() =>
      expect(vm.searchResult?.friends[0].channel_id).toBe("new")
    );

    const notificationsBeforeStaleFailure = vm.notifyListener.mock.calls.length;
    rejectFirst(new Error("stale failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vm.searchResult.friends[0].channel_id).toBe("new");
    expect(vm.searchError).toBeNull();
    expect(vm.notifyListener).toHaveBeenCalledTimes(notificationsBeforeStaleFailure);
  });

  it("concatenates load-more messages and guards duplicate loads", async () => {
    const message = (id: string) => ({
      id,
      channel: { channel_remark: "" },
    });
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const firstMessages = Array.from({ length: 20 }, (_, index) => message(`m${index + 1}`));
    mocks.searchLegacyGlobal
      .mockResolvedValueOnce(result({ messages: firstMessages }))
      .mockReturnValueOnce(first);
    const vm = new GlobalSearchVM();

    vm.requestSearch();
    await vi.waitFor(() => expect(vm.searchResult).toBeTruthy());
    vm.loadMore();
    vm.loadMore();
    expect(mocks.searchLegacyGlobal).toHaveBeenCalledTimes(2);
    expect(vm.page).toBe(2);
    expect(vm.loadMoreing).toBe(true);

    resolveFirst(result({ messages: [message("m2")] }));
    await vi.waitFor(() => expect(vm.loadMoreing).toBe(false));
    expect(vm.searchResult.messages).toEqual([...firstMessages, message("m2")]);

    const callsAfterFinished = mocks.searchLegacyGlobal.mock.calls.length;
    vm.loadMore();
    expect(mocks.searchLegacyGlobal).toHaveBeenCalledTimes(callsAfterFinished);
  });

  it("resets loading state and exposes an error for the current request", async () => {
    mocks.searchLegacyGlobal.mockRejectedValue(new Error("network"));
    const vm = new GlobalSearchVM();

    vm.requestSearch();
    await vi.waitFor(() =>
      expect(vm.searchError).toBe(
        "translated:base.globalSearch.searchFailedRetry"
      )
    );
    expect(vm.loadMoreing).toBe(false);
    expect(vm.notifyListener).toHaveBeenCalled();
  });

  it("resets pagination and changes content type when switching to files", () => {
    mocks.searchLegacyGlobal.mockResolvedValue(result());
    const vm = new GlobalSearchVM();
    vm.page = 4;
    vm.selectedTabKey = "contacts";

    vm.onTabClick("files");

    expect(vm.contentTypes).toEqual([8]);
    expect(vm.page).toBe(1);
    expect(mocks.searchLegacyGlobal).toHaveBeenCalledOnce();
    expect(vm.selectedTabKey).toBe("files");
  });

  it("shows the docs tab only when both docs flags are enabled", () => {
    mocks.remoteConfig.docsOn = false;
    mocks.remoteConfig.docsSearchOn = true;
    const vm = new GlobalSearchVM();
    expect(vm.tabList.map((tab) => tab.itemKey)).not.toContain("docs");

    mocks.remoteConfig.docsSearchOn = false;
    mocks.remoteConfig.docsOn = true;
    expect(vm.tabList.map((tab) => tab.itemKey)).not.toContain("docs");
    mocks.remoteConfig.docsSearchOn = true;
    expect(vm.tabList.map((tab) => tab.itemKey)).toContain("docs");
  });

  it("uses only all/files tabs while searching inside a channel", () => {
    const vm = new GlobalSearchVM();
    vm.channel = {} as any;
    expect(vm.searchInChannel).toBe(true);
    expect(vm.tabList.map((tab) => tab.itemKey)).toEqual(["all", "files"]);
  });

  it("clears file filtering when switching from files back to messages", () => {
    mocks.searchLegacyGlobal.mockResolvedValue(result());
    const vm = new GlobalSearchVM();
    vm.selectedTabKey = "files";
    vm.contentTypes = [8];

    vm.onTabClick("messages");

    expect(vm.contentTypes).toEqual([]);
    expect(vm.page).toBe(1);
    expect(mocks.searchLegacyGlobal).toHaveBeenCalledOnce();
    expect(vm.selectedTabKey).toBe("messages");
  });

  it("registers and removes the channel-info listener", () => {
    mocks.searchLegacyGlobal.mockResolvedValue(result());
    const vm = new GlobalSearchVM();
    vm.didMount();
    expect(mocks.addChannelInfoListener).toHaveBeenCalledOnce();
    const unsubscribe = mocks.addChannelInfoListener.mock.results[0].value;

    vm.didUnMount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
