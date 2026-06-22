// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted shared state for the wukongimjssdk mock ──
// WKSDK.shared().config must be a STABLE object so the test can observe whether
// startMain wrote clientMsgDeviceId.
const hoisted = vi.hoisted(() => {
  // lottie-web (pulled transitively via @douyinfe/semi-ui) calls
  // canvas.getContext('2d') at module-eval; jsdom has no canvas → stub it.
  const ctx = new Proxy({}, { get: () => () => {} });
  // @ts-ignore
  HTMLCanvasElement.prototype.getContext = () => ctx as any;
  return {
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

import WKApp from "../App";
import { ProhibitwordsService } from "../Service/ProhibitwordsService";

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
