// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted shared state for the wukongimjssdk mock ──
// WKSDK.shared().config must be a STABLE object so the test can observe whether
// startMain wrote clientMsgDeviceId.
const hoisted = vi.hoisted(() => {
  // lottie-web (pulled transitively via @douyinfe/semi-ui) calls
  // canvas.getContext('2d') at module-eval; jsdom has no canvas → stub it.
  const ctx = new Proxy({}, { get: () => () => {} });
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  // @ts-ignore
  HTMLCanvasElement.prototype.getContext = () => ctx as any;
  return {
    ctx,
    originalGetContext,
    wkConfig: { clientMsgDeviceId: "", provider: {} as any },
  };
});

// App.tsx's import graph reaches the heavy UI subtrees (semi-ui / tiptap / lottie)
// only through these three App-direct imports. They are used by App only via a
// constructor / static methods / a type, never by startMain — safe to stub so the
// real App module (and the real startMain under test) can load in jsdom.
vi.mock("../EndpointCommon", () => ({
  EndpointCommon: class {
    addOnLogin = vi.fn();
  },
}));
vi.mock("../Components/WKBase", () => ({ default: class {} }));
vi.mock("../Service/TypingManager", () => ({
  TypingManager: { shared: { resetAll: vi.fn() } },
}));

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string;
    channelType: number;
    constructor(id: string, type: number) {
      this.channelID = id;
      this.channelType = type;
    }
  }
  return {
    default: { Channel },
    Channel,
    ChannelTypePerson: 1,
    ChannelTypeGroup: 2,
    ChannelTypeCommunityTopic: 6,
    Message: class {},
    MessageContentType: { text: 1, image: 2 },
    ConnectStatus: { Connected: 1, Disconnect: 2, ConnectKick: 3 },
    WKSDK: {
      shared: () => ({
        config: hoisted.wkConfig,
        connectManager: { addConnectStatusListener: vi.fn() },
        channelManager: {},
        conversationManager: {},
      }),
    },
  };
});

import WKApp, { ChatMenus, FriendApply, LoginInfo, WKConfig, WKRemoteConfig } from "../App";
import { ProhibitwordsService } from "../Service/ProhibitwordsService";
import { Channel, WKSDK } from "wukongimjssdk";

// Resolve only after pending microtasks + a macrotask, so the GET promise's
// .then/.catch handlers have fully run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("[api] WKApp.startMain device record fetch", () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  let connectIMSpy: ReturnType<typeof vi.spyOn>;
  let contactsSyncSpy: ReturnType<typeof vi.spyOn>;
  let prohibitSyncSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = (() => hoisted.ctx) as any;
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);

    hoisted.wkConfig.clientMsgDeviceId = "orig-device";
    WKApp.shared.deviceId = "dev-1";

    // Stub the side-effect calls so startMain runs in isolation.
    connectIMSpy = vi
      .spyOn(WKApp.shared, "connectIM")
      .mockImplementation(() => {});
    contactsSyncSpy = vi
      .spyOn(WKApp.dataSource, "contactsSync")
      .mockResolvedValue(undefined as any);
    prohibitSyncSpy = vi
      .spyOn(ProhibitwordsService.shared, "sync")
      .mockResolvedValue(undefined as any);
    getSpy = vi.spyOn(WKApp.apiClient, "get");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = hoisted.originalGetContext;
    process.off("unhandledRejection", onUnhandled);
    vi.restoreAllMocks();
  });

  it("swallows a 400 (device not found): no unhandled rejection, clientMsgDeviceId unchanged, warns once", async () => {
    getSpy.mockReturnValue(
      Promise.reject({ status: 400, code: "bad_request", msg: "device not found" }) as any
    );

    WKApp.shared.startMain();
    await flush();

    expect(unhandled).toHaveLength(0);
    expect(hoisted.wkConfig.clientMsgDeviceId).toBe("orig-device");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("happy path: writes clientMsgDeviceId from the server response", async () => {
    getSpy.mockReturnValue(Promise.resolve({ id: "srv-dev-1" }) as any);

    WKApp.shared.startMain();
    await flush();

    expect(hoisted.wkConfig.clientMsgDeviceId).toBe("srv-dev-1");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(unhandled).toHaveLength(0);
  });

  it("the catch does not swallow the preceding side effects (connectIM / contactsSync / prohibitwords sync each run once)", async () => {
    getSpy.mockReturnValue(
      Promise.reject({ status: 400, code: "bad_request" }) as any
    );

    WKApp.shared.startMain();
    await flush();

    expect(connectIMSpy).toHaveBeenCalledTimes(1);
    expect(contactsSyncSpy).toHaveBeenCalledTimes(1);
    expect(prohibitSyncSpy).toHaveBeenCalledTimes(1);
  });
});

describe("LoginInfo and WKConfig persistence boundaries", () => {
  it("applies a host session without writing renderer storage by default", () => {
    const info = new LoginInfo();
    const save = vi.spyOn(info, "save");

    info.applySession({
      uid: "host-user",
      token: "host-token",
      name: "Host User",
      loginProvider: "oidc",
      deviceFlag: 2,
    });

    expect(info.uid).toBe("host-user");
    expect(info.token).toBe("host-token");
    expect(info.name).toBe("Host User");
    expect(info.loginProvider).toBe("oidc");
    expect(info.deviceFlag).toBe(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("round-trips login fields and preserves tri-state real-name status", () => {
    const info = new LoginInfo();
    info.appID = "app";
    info.uid = "u1";
    info.token = "token";
    info.name = "Display";
    info.role = "member";
    info.isWork = true;
    info.sex = 1;
    info.loginProvider = "local";
    info.deviceFlag = 2;
    info.realnameVerified = true;
    info.realName = "实名用户";
    info.realnameVerifiedAt = 123;
    info.save();

    const loaded = new LoginInfo();
    loaded.load();
    expect(loaded.uid).toBe("u1");
    expect(loaded.token).toBe("token");
    expect(loaded.isWork).toBe(true);
    expect(loaded.sex).toBe(1);
    expect(loaded.realnameVerified).toBe(true);
    expect(loaded.realName).toBe("实名用户");
    expect(loaded.realnameVerifiedAt).toBe(123);
    expect(loaded.selfDisplayName()).toBe("实名用户");

    loaded.realnameVerified = false;
    expect(loaded.selfDisplayName()).toBe("Display");
    loaded.realnameVerified = undefined;
    expect(loaded.selfDisplayName()).toBe("Display");
    loaded.logout();
    expect(loaded.isLogined()).toBe(false);
  });

  it("reads query values and handles config theme changes", () => {
    const info = new LoginInfo();
    window.history.replaceState({}, "", "/?foo=bar&empty=");
    expect(info.getQueryVariable("foo")).toBe("bar");
    expect(info.getQueryVariable("missing")).toBe(false);

    const config = new WKConfig();
    config.themeMode = 1;
    expect(document.body.getAttribute("theme-mode")).toBe("dark");
    config.themeMode = 0;
    expect(document.body.hasAttribute("theme-mode")).toBe(false);
    expect(config.themeMode).toBe(0);
  });

  it("normalizes device and browser metadata helpers", () => {
    const app: any = WKApp.shared;
    sessionStorage.setItem("deviceId", "stored-device");
    expect(app.getDeviceIdFromStorage()).toBe("stored-device");
    expect(app.getBrandsFromUserAgent()).toBeTypeOf("string");
    expect(app.getOSAndVersion()).toBeTypeOf("string");
    sessionStorage.removeItem("deviceId");
  });

  it("covers desktop and mobile user-agent metadata branches", () => {
    const app: any = WKApp.shared;
    const original = navigator.userAgent;
    const cases = [
      ["Mozilla/5.0 (Windows NT 10.0) Chrome/120", "Windows 10.0", "Chrome 120"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) Version/17 Safari/605", "MacOS 13.4", "Safari 17"],
      ["Mozilla/5.0 Android 14 Firefox/121", "Android 14", "Firefox 121"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Version/17 Safari/605", "iOS 17.2", "Safari 17"],
      ["Mozilla/5.0 (X11; Linux x86_64) Edge/120", "Linux (version not available)", "Edge 120"],
      ["Unknown client", "Unknown OS and version", "Unknown browser"],
    ] as const;
    for (const [userAgent, os, browser] of cases) {
      Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
      expect(app.getOSAndVersion()).toBe(os);
      expect(app.getBrandsFromUserAgent()).toBe(browser);
    }
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: original });
  });

  it("round-trips friend applications and unread state", async () => {
    const app: any = WKApp.shared;
    const info: any = WKApp.loginInfo;
    info.uid = "friend-user";
    info.token = "friend-token";
    expect(app.getFriendApplys()).toEqual([]);
    sessionStorage.setItem("friend-userfriendApplys", "not-json");
    expect(app.getFriendApplys()).toEqual([]);
    sessionStorage.removeItem("friend-userfriendApplys");
    const first = new FriendApply();
    first.uid = "a"; first.to_name = "A"; first.createdAt = 1; first.status = 0;
    const second = new FriendApply();
    second.uid = "b"; second.to_name = "B"; second.createdAt = 2; second.status = 1;
    app.addFriendApply(first);
    app.addFriendApply(second);
    expect(app.getFriendApplys().map((item: FriendApply) => item.uid)).toEqual(["b", "a"]);
    first.to_name = "A2";
    app.updateFriendApply(first);
    expect(app.getFriendApplys().find((item: FriendApply) => item.uid === "a")?.to_name).toBe("A2");
    sessionStorage.setItem("friend-user-friend-applys-unread-count", "4");
    expect(app.getFriendApplysUnreadCount()).toBe(4);
    const deleteSpy = vi.spyOn(WKApp.apiClient, "delete").mockResolvedValue({} as any);
    await app.friendApplyMarkAllReaded();
    expect(deleteSpy).toHaveBeenCalledWith("/user/reddot/friendApply");
    expect(app.getFriendApplysUnreadCount()).toBe(0);
    sessionStorage.removeItem("friend-userfriendApplys");
    sessionStorage.removeItem("friend-user-friend-applys-unread-count");
    vi.restoreAllMocks();
  });

  it("covers friend-apply empty, duplicate, notification, and listener paths", async () => {
    const app: any = WKApp.shared;
    const info: any = WKApp.loginInfo;
    info.uid = "friend-branches";
    info.token = "token";
    sessionStorage.setItem("friend-branchesfriendApplys", "[]");
    expect(app.getFriendApplys()).toEqual([]);
    const item = new FriendApply();
    item.uid = "same"; item.createdAt = 1; item.status = 0;
    app.addFriendApply(item);
    item.createdAt = 2;
    app.addFriendApply(item);
    const missing = new FriendApply(); missing.uid = "missing";
    app.updateFriendApply(missing);
    sessionStorage.setItem("friend-branches-friend-applys-unread-count", "bad");
    expect(app.getFriendApplysUnreadCount()).toBeNaN();
    const getSpy = vi.spyOn(WKApp.apiClient, "get").mockResolvedValue({ count: 3 } as any);
    await app.setFriendApplysUnreadCount();
    expect(getSpy).toHaveBeenCalledWith("/user/reddot/friendApply");
    const listener = vi.fn();
    app.addMessageDeleteListener(listener);
    app.notifyMessageDeleteListener({ id: 1 } as any, { id: 0 } as any);
    expect(listener).toHaveBeenCalled();
    app.removeMessageDeleteListener(listener);
    app.notifyMessageDeleteListener({ id: 2 } as any);
    sessionStorage.removeItem("friend-branchesfriendApplys");
    sessionStorage.removeItem("friend-branches-friend-applys-unread-count");
    vi.restoreAllMocks();
  });

  it("builds avatar URLs and invalidates avatar tags", () => {
    const app: any = WKApp.shared;
    const info: any = WKApp.loginInfo;
    info.uid = "avatar-user";
    info.token = "token";
    (WKApp.shared as any).currentSpaceId = "space";
    const sdkSpy = vi.spyOn(WKSDK, "shared").mockReturnValue({ channelManager: { getChannelInfo: () => undefined } } as any);
    expect(app.avatarChannel(undefined)).toBe("");
    expect(app.avatarUser("")).toBe("");
    expect(app.avatarUser("sspace_real-user")).toContain("users/real-user/avatar");
    expect(app.avatarGroup("group-1")).toContain("groups/group-1/avatar");
    expect(app.avatarOrg("org-1")).toContain("organizations/org-1/logo");
    expect(app.getChannelAvatarTag()).toBeTruthy();
    app.changeChannelAvatarTag(undefined);
    sdkSpy.mockReturnValue({ channelManager: { getChannelInfo: (channel: any) => {
      if (channel.channelID === "data") return { logo: "data:image/png;base64,x" };
      if (channel.channelID === "query") return { logo: "https://cdn/logo.png?v=1" };
      return { logo: "https://cdn/logo.png" };
    } } } as any);
    (WKApp.dataSource as any).commonDataSource = { getImageURL: (url: string) => url };
    expect(app.avatarChannel(new Channel("data", 2))).toBe("data:image/png;base64,x");
    expect(app.avatarChannel(new Channel("query", 2))).toContain("&v=");
    expect(app.avatarChannel(new Channel("logo", 2))).toContain("?v=");
    const channel = new Channel("group-1", 2);
    const firstTag = app.getChannelAvatarTag(channel);
    expect(firstTag).toBeTruthy();
    app.changeChannelAvatarTag(channel);
    expect(app.getChannelAvatarTag(channel)).toBeTruthy();
    info.token = "";
    expect(app.getFriendApplysUnreadCount()).toBe(0);
    sessionStorage.removeItem("channelAvatarTag:2group-1");
    sessionStorage.removeItem("channelAvatarTag:1spspace_real-user");
    sdkSpy.mockRestore();
  });

  it("exposes endpoint registration helpers", () => {
    const app: any = WKApp.shared;
    expect(new ChatMenus().sort).toBe(0);
    app.chatMenusRegister("test.chat-menu", () => ({ key: "test", title: "Test", icon: "" }));
    expect(app.chatMenus()).toEqual(expect.arrayContaining([expect.objectContaining({ key: "test" })]));
    app.channelSettingRegister("test.channel-setting", () => undefined);
    app.channelSettingRegister("test.with-row", () => ({ rows: undefined } as any));
    app.channelManageRegister("test.channel-manage", () => undefined);
    app.userInfoRegister("test.user-info", () => undefined);
    expect(app.channelSettings({} as any)).toHaveLength(1);
    expect(app.channelManages({} as any)).toEqual([]);
    expect(app.userInfos({} as any)).toEqual([]);
    app.sectionAddRow("test.with-row", {} as any, {} as any);
    const originalGetFriendApplys = app.getFriendApplys;
    app.getFriendApplys = () => undefined;
    app.addFriendApply(new FriendApply());
    app.updateFriendApply(new FriendApply());
    app.getFriendApplys = originalGetFriendApplys;
  });
});

describe("WKRemoteConfig listeners and appconfig mapping", () => {
  it("maps feature flags, notifies once, and supports config-change unsubscribe", async () => {
    const config = new WKRemoteConfig();
    const initial = vi.fn();
    const changed = vi.fn();
    config.addListener(initial);
    const unsubscribe = config.addConfigChangeListener(changed);
    vi.spyOn(WKApp.apiClient, "get").mockResolvedValue({
      revoke_second: 30,
      thread_on: 1,
      messages_search_on: "true",
      disable_user_create_space: true,
      tracking_enabled: true,
      sticker_custom_enabled: true,
      message_reaction: { read: true, write: true },
      sticker_upload_limits: { max_size_kb: 2048, max_dimension: 1024, allowed_formats: ["png"] },
      docs_on: true,
      docs_search_on: true,
      dmloop_on: true,
      dmpersonal_on: true,
      drive_on: true,
      mail_on: true,
      octo_assistant_uids: "bot-a, bot-b",
      oidc_providers: [{ id: "oidc", name: "OIDC", authorize_path: "/auth", account_url: "https://idp/account" }],
    } as any);
    await config.requestConfig();
    expect(config.requestSuccess).toBe(true);
    expect(config.revokeSecond).toBe(30);
    expect(config.threadOn).toBe(true);
    expect(config.octoAssistantUids).toEqual(["bot-a", "bot-b"]);
    expect(config.oidcProviders[0].id).toBe("oidc");
    expect(initial).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
    vi.restoreAllMocks();
  });

  it("notifies listener errors without breaking remaining listeners", () => {
    const config = new WKRemoteConfig();
    const second = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    config.addListener(() => { throw new Error("listener") });
    config.addListener(second);
    ;(config as any).notifyListeners();
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("marks config as failed after the retry budget is exhausted", async () => {
    const config = new WKRemoteConfig();
    ;(config as any).retryCount = 5;
    vi.spyOn(config, "requestConfig").mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listener = vi.fn();
    config.addListener(listener);
    await config.startRequestConfig();
    expect(config.requestFailed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
