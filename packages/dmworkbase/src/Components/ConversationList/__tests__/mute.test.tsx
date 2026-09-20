import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, { Channel, ChannelInfo, ChannelTypeGroup, ChannelTypePerson, Conversation } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import { isValidElement, type ReactNode } from "react";
import axios, { type AxiosRequestConfig } from "axios";

vi.mock("react-virtuoso", () => ({
  TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null,
}));
vi.mock("../../../Service/Dap", () => ({
  Dap: { shared: { track: vi.fn() } },
}));
vi.mock("@octo/base", async () => ({
  ChannelTypeCommunityTopic: (await import("../../../Service/Const")).ChannelTypeCommunityTopic,
  parseThreadChannelId: (await import("../../../Service/Thread")).parseThreadChannelId,
}));

import ConversationList from "../index";
import WKApp from "../../../App";
import APIClient from "../../../Service/APIClient";
import { ConversationWrap } from "../../../Service/Model";
import type { ContextMenusData } from "../../ContextMenus";
import { i18n, t } from "../../../i18n";
import { fetchImChannelInfo, getPendingImChannelInfoFetch } from "../../../im-runtime/channelRuntime";
import { captureCurrentImConversationSyncContext } from "../../../im-runtime/conversationSyncContext";
import { createChannelInfoCallback } from "../../../../../dmworkdatasource/src/im-callbacks/channelInfo";

const sdk = WKSDK.shared();
const originalAdapter = axios.defaults.adapter;
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function payload(channel: Channel, name = "Known name", mute = 1) {
  return {
    channel: { channel_id: channel.channelID, channel_type: channel.channelType },
    name, remark: "", mute, stick: 0, status: 1, extra: { custom: "retained" },
  };
}
function install(getChannel: ReturnType<typeof vi.fn>) {
  sdk.config.provider.channelInfoCallback = createChannelInfoCallback({
    getChannel, threadGet: vi.fn(), extractUID: uid => uid,
    getSubscribeCacheMap: () => new Map(),
    captureContext: captureCurrentImConversationSyncContext,
  });
}
function seed(channel: Channel, mute = false) {
  const info = Object.assign(new ChannelInfo(), {
    channel, title: "Known name", mute, orgData: { displayName: "Known name", custom: "retained" },
  });
  sdk.channelManager.setChannleInfoForCache(info);
  return info;
}
function list() {
  const vm = new ConversationList({ conversations: [] });
  vm.setState = vi.fn();
  return vm;
}
function select(vm: ConversationList, channel: Channel) {
  const conversation = new Conversation();
  conversation.channel = channel;
  vm.state.selectConversationWrap = new ConversationWrap(conversation);
}
function menus(vm: ConversationList): ContextMenusData[] {
  const visit = (node: ReactNode): ContextMenusData[] => {
    if (Array.isArray(node)) return node.flatMap(visit);
    if (!isValidElement<{ menus?: ContextMenusData[]; children?: ReactNode }>(node)) return [];
    return node.props.menus ?? visit(node.props.children);
  };
  return visit(vm.render());
}
function endpoint(channel: Channel) {
  return `${channel.channelType === ChannelTypeGroup ? "groups" : "users"}/${channel.channelID}/setting`;
}

beforeEach(() => {
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  sdk.channelManager.channelInfocacheMap = {};
  sdk.conversationManager.conversations = [];
  WKApp.shared.currentSpaceId = "mute-space";
  WKApp.loginInfo.token = "mute-token";
  APIClient.shared.config.apiURL = "https://mute.invalid";
  vi.spyOn(Toast, "error").mockReturnValue("toast-id");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  i18n.setLocale("zh-CN", { notify: false, persist: false });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(["zh-CN", "en-US"] as const)("mute errors in %s", locale => {
  it.each([
    [401, "ERR_BAD_REQUEST", "base.api.error.sessionExpired"],
    [403, "ERR_BAD_REQUEST", "base.api.error.forbidden"],
    [404, "ERR_BAD_REQUEST", "base.api.error.unknown"],
    [429, "ERR_BAD_REQUEST", "base.api.error.rateLimited"],
    [500, "ERR_BAD_RESPONSE", "base.api.error.unknown"],
    [503, "ERR_BAD_RESPONSE", "base.api.error.unknown"],
    [undefined, "ERR_NETWORK", "base.api.error.network"],
    [undefined, "ECONNABORTED", "base.api.error.timeout"],
  ] as const)("uses the real interceptor message for %s / %s", async (status, code, key) => {
    i18n.setLocale(locale, { notify: false, persist: false });
    const channel = new Channel("mute-http-error", ChannelTypePerson);
    const info = seed(channel);
    const get = vi.fn();
    install(get);
    const rawMessage = status ? `Request failed with status code ${status}` : code;
    const adapter = vi.fn(async (config: AxiosRequestConfig) => {
      throw Object.assign(new Error(rawMessage), {
        code, config,
        response: status === undefined ? undefined : {
          status,
          data: {
            error: {
              http_status: status,
              ...(status >= 500 ? { code: "err.shared.internal", message: "internal details" } : {}),
            },
          },
        },
      });
    });
    axios.defaults.adapter = adapter;
    const vm = list();
    await vm.onMuteWithValue(true, info);

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(Toast.error).toHaveBeenCalledExactlyOnceWith(t(key));
    expect(Toast.error).not.toHaveBeenCalledWith(rawMessage);
    expect(info.mute).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(vm.setState).not.toHaveBeenCalled();
  });
});

it("uses a localized fallback for a save error without an interceptor message", async () => {
  const channel = new Channel("mute-unknown-error", ChannelTypePerson);
  const info = seed(channel);
  vi.spyOn(APIClient.shared, "put").mockRejectedValue(new Error("internal details"));

  await list().onMuteWithValue(true, info);

  expect(Toast.error).toHaveBeenCalledExactlyOnceWith(t("base.channelSetting.toggleFailed"));
  expect(info.mute).toBe(false);
});

it("handles a fire-and-forget rejection through the real SDK and datasource", async () => {
  const channel = new Channel("metadata-unavailable", ChannelTypePerson);
  const get = vi.fn().mockRejectedValue({ status: 403 });
  install(get);

  void fetchImChannelInfo(sdk, channel);
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(get).toHaveBeenCalledTimes(1);
  expect(getPendingImChannelInfoFetch(sdk, channel)).toBeUndefined();
  expect(sdk.channelManager.getChannelInfo(channel)).toBeUndefined();
  expect(Toast.error).not.toHaveBeenCalled();
});

it("keeps the scoped conversation muted when its metadata contains a bare peer alias", async () => {
  const channel = new Channel(`s${"a".repeat(32)}_peer`, ChannelTypePerson);
  const alias = new Channel("peer", ChannelTypePerson);
  const get = vi.fn()
    .mockResolvedValueOnce(payload(alias, "Known name", 0))
    .mockRejectedValue({ status: 403 });
  install(get);
  await fetchImChannelInfo(sdk, channel);
  const info = sdk.channelManager.getChannelInfo(channel)!;
  expect(info.channel.channelID).toBe("peer");
  const put = vi.spyOn(APIClient.shared, "put").mockResolvedValue(undefined);
  const vm = list();
  select(vm, channel);
  const onMute = vi.spyOn(vm, "onMuteWithValue");
  menus(vm).find(item => item.title === t("base.conversationList.context.mute"))?.onClick?.();
  expect(onMute).toHaveBeenCalledWith(true, info, channel);
  await onMute.mock.results[0].value;

  expect(put).toHaveBeenCalledWith("users/peer/setting", { mute: 1 });
  expect(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(true);
  expect(sdk.channelManager.getChannelInfo(channel)?.channel.isEqual(channel)).toBe(true);
  expect(Toast.error).not.toHaveBeenCalled();
});

describe.each([ChannelTypePerson, ChannelTypeGroup])("mute actions for channel type %s", type => {
  it("orders rapid saves and preserves the latest value after an older metadata refresh", async () => {
    const channel = new Channel("mute-rapid", type);
    const info = seed(channel);
    const firstSave = deferred();
    const secondSave = deferred();
    const refresh = deferred<ReturnType<typeof payload>>();
    const get = vi.fn(() => refresh.promise);
    install(get);
    const put = vi.spyOn(APIClient.shared, "put")
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);
    const vm = list();
    const first = vm.onMuteWithValue(true, info);
    const second = vm.onMuteWithValue(false, info);
    const savesStartedTogether = put.mock.calls.length;
    firstSave.resolve();
    await flush();
    const savesAfterFirstResponse = put.mock.calls.length;
    const refreshesBeforeSecondResponse = get.mock.calls.length;
    secondSave.resolve();
    await flush();
    const muteAfterSecondSave = sdk.channelManager.getChannelInfo(channel)?.mute;
    refresh.resolve(payload(channel, "Known name", 1));
    await Promise.all([first, second]);
    await flush();

    expect(savesStartedTogether).toBe(1);
    expect(savesAfterFirstResponse).toBe(2);
    expect(refreshesBeforeSecondResponse).toBe(1);
    expect(muteAfterSecondSave).toBe(false);
    expect(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(false);
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it("keeps the mute and pin menus usable for a valid nameless channel", async () => {
    const channel = new Channel("nameless", type);
    let mute = 0;
    const get = vi.fn(async () => payload(channel, "", mute));
    install(get);
    await fetchImChannelInfo(sdk, channel);
    const info = sdk.channelManager.getChannelInfo(channel)!;
    expect(info.title).toBe("");
    expect(info.orgData.custom).toBe("retained");
    const put = vi.spyOn(APIClient.shared, "put").mockImplementation(async (_path, body: Record<string, number>) => {
      if (body.mute !== undefined) mute = body.mute;
    });
    const vm = list();
    select(vm, channel);
    const onMute = vi.spyOn(vm, "onMuteWithValue");
    const items = menus(vm);
    const muteMenu = items.find(item => item.title === t("base.conversationList.context.mute"));
    const pinMenu = items.find(item => item.title === t("base.conversationList.context.pin"));
    expect(muteMenu).toBeDefined();
    expect(pinMenu).toBeDefined();
    pinMenu?.onClick?.();
    muteMenu?.onClick?.();
    expect(onMute).toHaveBeenCalledWith(true, info, channel);
    await onMute.mock.results[0].value;

    expect(put).toHaveBeenCalledWith(endpoint(channel), { top: 1 });
    expect(put).toHaveBeenCalledWith(endpoint(channel), { mute: 1 });
    expect(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(true);
    expect(Toast.error).not.toHaveBeenCalled();
    expect(sdk.conversationManager.conversations).toEqual([]);
  });

  it.each(["403", "503", "malformed", "nameless", "success"])(
    "keeps a successful mute when the metadata refresh is %s", async outcome => {
      vi.useFakeTimers();
      const channel = new Channel("mute-refresh", type);
      const info = seed(channel);
      const get = ["403", "503"].includes(outcome)
        ? vi.fn().mockRejectedValue({ status: Number(outcome), msg: "Refresh failed" })
        : vi.fn().mockResolvedValue(outcome === "malformed" ? {} : payload(channel, outcome === "nameless" ? "" : "Known name"));
      install(get);
      let savedMute = false;
      const put = vi.spyOn(APIClient.shared, "put").mockImplementation(async (_path, body: Record<string, number>) => {
        savedMute = body.mute === 1;
      });
      const vm = list();
      const action = vm.onMuteWithValue(true, info);
      await flush();
      expect(savedMute).toBe(true);
      expect(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(true);
      expect(vm.setState).toHaveBeenCalled();
      await vi.runAllTimersAsync();
      await action;

      expect(put).toHaveBeenCalledWith(endpoint(channel), { mute: 1 });
      expect(get).toHaveBeenCalledTimes(outcome === "503" ? 3 : 1);
      expect(Toast.error).not.toHaveBeenCalled();
      expect(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(true);
      expect(sdk.channelManager.getChannelInfo(channel)?.orgData.custom).toBe("retained");
      if (["403", "503", "malformed"].includes(outcome)) {
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(sdk.channelManager.getChannelInfo(channel)?.title).toBe("Known name");
      }
    },
  );

  it("keeps a successful unmute if the refresh fails", async () => {
    const channel = new Channel("unmute-refresh", type);
    const info = seed(channel, true);
    install(vi.fn().mockRejectedValue({ status: 403 }));
    vi.spyOn(APIClient.shared, "put").mockResolvedValue(undefined);
    await list().onMuteWithValue(false, info);

    expect(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(false);
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it("reports a failed save without changing the cache or refreshing", async () => {
    const channel = new Channel("mute-denied", type);
    const info = seed(channel);
    const get = vi.fn();
    install(get);
    vi.spyOn(APIClient.shared, "put").mockRejectedValue({ msg: "Save denied" });
    const vm = list();
    await vm.onMuteWithValue(true, info);

    expect(Toast.error).toHaveBeenCalledExactlyOnceWith("Save denied");
    expect(sdk.channelManager.getChannelInfo(channel)?.mute).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(vm.setState).not.toHaveBeenCalled();
  });

  it.each(["space", "session", "origin"])("does not apply a late save after changing %s", async transition => {
    const channel = new Channel("mute-context", type);
    const info = seed(channel);
    const get = vi.fn();
    install(get);
    const save = deferred();
    vi.spyOn(APIClient.shared, "put").mockReturnValue(save.promise);
    const vm = list();
    const action = vm.onMuteWithValue(true, info);
    if (transition === "space") WKApp.shared.currentSpaceId = "next-space";
    if (transition === "session") WKApp.loginInfo.token = "next-token";
    if (transition === "origin") APIClient.shared.config.apiURL = "https://next.invalid";
    const nextInfo = seed(channel);
    save.resolve();
    await action;

    expect(nextInfo.mute).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(vm.setState).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it("does not refresh or update the list after unmount", async () => {
    const channel = new Channel("mute-unmount", type);
    const info = seed(channel);
    const get = vi.fn();
    install(get);
    const save = deferred();
    vi.spyOn(APIClient.shared, "put").mockReturnValue(save.promise);
    const vm = list();
    vm.componentDidMount();
    const action = vm.onMuteWithValue(true, info);
    vm.componentWillUnmount();
    save.resolve();
    await action;

    expect(info.mute).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(vm.setState).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
  });
});
