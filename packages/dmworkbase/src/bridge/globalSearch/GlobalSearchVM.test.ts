import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contactsList: [] as any[],
  currentSpaceId: "space-1",
  groupSaveList: vi.fn(),
  searchLegacyGlobal: vi.fn(),
}));

vi.mock("../../App", () => ({
  default: {
    get dataSource() {
      return {
        contactsList: mocks.contactsList,
        channelDataSource: { groupSaveList: mocks.groupSaveList },
      };
    },
    shared: {
      get currentSpaceId() {
        return mocks.currentSpaceId;
      },
    },
  },
}));

vi.mock("../../Service/SearchService", () => ({
  default: { searchLegacyGlobal: mocks.searchLegacyGlobal },
}));

vi.mock("../../i18n", () => ({ t: (key: string) => key }));

vi.mock("../../im-runtime/currentChannelRuntime", () => ({
  addCurrentImChannelInfoListener: vi.fn(() => vi.fn()),
  getCurrentImChannelInfo: vi.fn(),
}));

vi.mock("wukongimjssdk", () => ({
  ChannelTypePerson: 1,
  MessageContentManager: { shared: () => ({ getMessageContent: () => null }) },
  SystemContent: class {},
}));

import GlobalSearchVM from "./GlobalSearchVM";

const emptyResult = () => ({ friends: [], groups: [], messages: [] });

describe("GlobalSearchVM pinyin supplement", () => {
  beforeEach(() => {
    mocks.contactsList = [];
    mocks.currentSpaceId = "space-1";
    mocks.groupSaveList.mockReset();
    mocks.searchLegacyGlobal.mockReset().mockResolvedValue(emptyResult());
  });

  it("does not add a groupSaveList request when the global search opens", async () => {
    const vm = new GlobalSearchVM();

    vm.didMount();
    await vi.waitFor(() => expect(mocks.searchLegacyGlobal).toHaveBeenCalled());

    expect(mocks.groupSaveList).not.toHaveBeenCalled();
    vm.didUnMount();
  });

  it("appends pinyin matches from existing scoped sources after server results", async () => {
    mocks.searchLegacyGlobal.mockResolvedValueOnce({
      friends: [
        {
          channel_id: "friend-1",
          channel_type: 1,
          channel_name: "魏娇莹",
        },
      ],
      groups: [
        {
          channel_id: "group-1",
          channel_type: 2,
          channel_name: "魏娇莹项目群",
        },
      ],
      messages: [],
    });
    const vm = new GlobalSearchVM();
    vm.didMount();
    await vi.waitFor(() => expect(vm.searchResult).toBeTruthy());

    mocks.searchLegacyGlobal.mockResolvedValueOnce({
      friends: [
        {
          channel_id: "server-friend",
          channel_type: 1,
          channel_name: "服务端联系人",
        },
      ],
      groups: [
        {
          channel_id: "server-group",
          channel_type: 2,
          channel_name: "服务端群聊",
        },
      ],
      messages: [],
    });
    vm.keyword = "weijiao";
    vm.initLoad();
    vm.requestSearch();
    await vi.waitFor(() =>
      expect(vm.searchResult?.groups?.map((item: any) => item.channel_id)).toEqual(
        ["server-group", "group-1"]
      )
    );

    expect(vm.searchResult.friends.map((item: any) => item.channel_id)).toEqual(
      ["server-friend", "friend-1"]
    );
    expect(vm.searchResult.groups.map((item: any) => item.channel_id)).toEqual([
      "server-group",
      "group-1",
    ]);
    expect(mocks.groupSaveList).not.toHaveBeenCalled();

    mocks.searchLegacyGlobal.mockResolvedValue(emptyResult());
    vm.keyword = "";
    vm.initLoad();
    vm.requestSearch();
    await vi.waitFor(() => expect(vm.searchResult?.groups).toEqual([]));
    vm.keyword = "weijiao";
    vm.initLoad();
    vm.requestSearch();
    await vi.waitFor(() => expect(vm.searchResult?.groups).toEqual([]));
    expect(mocks.searchLegacyGlobal).toHaveBeenCalledTimes(4);
    vm.didUnMount();
  });

  it("never indexes an account-level contact absent from the server snapshot", async () => {
    mocks.contactsList = [{ uid: "account-only", name: "贾小明", status: 1 }];
    const vm = new GlobalSearchVM();

    vm.didMount();
    await vi.waitFor(() => expect(vm.searchResult).toBeTruthy());
    vm.keyword = "jia";
    vm.initLoad();
    vm.requestSearch();

    await vi.waitFor(() =>
      expect(mocks.searchLegacyGlobal).toHaveBeenCalledTimes(2)
    );
    expect(vm.searchResult.friends).toEqual([]);
    vm.didUnMount();
  });

  it("does not supplement existing Chinese or English direct searches", async () => {
    mocks.contactsList = [
      { uid: "local-cn", name: "魏娇莹", status: 1 },
      { uid: "local-en", name: "Alice", status: 1 },
    ];
    const vm = new GlobalSearchVM();

    vm.keyword = "魏娇";
    vm.requestSearch();
    await vi.waitFor(() => expect(vm.searchResult).toBeTruthy());
    expect(vm.searchResult.friends).toEqual([]);

    vm.keyword = "alice";
    vm.initLoad();
    vm.requestSearch();
    await vi.waitFor(() =>
      expect(mocks.searchLegacyGlobal).toHaveBeenCalledTimes(2)
    );
    expect(vm.searchResult.friends).toEqual([]);
  });

  it("does not index an account-level contact after switching Spaces", async () => {
    mocks.contactsList = [{ uid: "space-1-only", name: "贾小明", status: 1 }];
    mocks.searchLegacyGlobal.mockResolvedValueOnce({
      friends: [
        {
          channel_id: "space-1-only",
          channel_type: 1,
          channel_name: "贾小明",
        },
      ],
      groups: [],
      messages: [],
    });
    const vm = new GlobalSearchVM();
    vm.didMount();
    await vi.waitFor(() => expect(vm.searchResult).toBeTruthy());

    mocks.currentSpaceId = "space-2";
    // contactsList intentionally stays unchanged, matching production.
    mocks.searchLegacyGlobal.mockResolvedValueOnce(emptyResult());
    vm.keyword = "jia";
    vm.initLoad();
    vm.requestSearch();

    await vi.waitFor(() => expect(vm.searchResult).toBeTruthy());
    expect(vm.searchResult.friends).toEqual([]);
    vm.didUnMount();
  });
});
