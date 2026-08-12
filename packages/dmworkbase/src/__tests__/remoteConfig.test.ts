// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const ctx = new Proxy({}, { get: () => () => {} });
  // @ts-ignore jsdom has no canvas implementation, but lottie can be evaluated by App's import graph.
  HTMLCanvasElement.prototype.getContext = () => ctx as any;
  return {
    wkConfig: { clientMsgDeviceId: "", provider: {} as any },
  };
});

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

import WKApp, { WKRemoteConfig } from "../App";

describe("[api] WKRemoteConfig notifications", () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(WKApp.apiClient, "get");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies persistent config listeners when SSO config recovers after retry exhaustion", async () => {
    const remoteConfig = new WKRemoteConfig();
    (remoteConfig as unknown as { maxRetries: number }).maxRetries = 0;

    const firstCompleteListener = vi.fn();
    const configChangeListener = vi.fn();
    remoteConfig.addListener(firstCompleteListener);
    remoteConfig.addConfigChangeListener(configChangeListener);

    getSpy.mockRejectedValueOnce(new Error("appconfig unavailable"));
    await remoteConfig.startRequestConfig();

    expect(remoteConfig.requestSuccess).toBe(false);
    expect(remoteConfig.requestFailed).toBe(true);
    expect(firstCompleteListener).toHaveBeenCalledTimes(1);
    expect(configChangeListener).not.toHaveBeenCalled();

    getSpy.mockResolvedValueOnce({
      oidc_providers: [
        {
          id: "octo",
          name: "Octo",
          authorize_path: "/oidc/login",
          account_url: "https://example.com/account",
          reset_password_url: "https://example.com/reset",
        },
      ],
    });
    await remoteConfig.requestConfig();

    expect(remoteConfig.requestSuccess).toBe(true);
    expect(remoteConfig.requestFailed).toBe(false);
    expect(remoteConfig.oidcProviders).toHaveLength(1);
    expect(firstCompleteListener).toHaveBeenCalledTimes(1);
    expect(configChangeListener).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("reads scan_login_enabled as a JSON boolean and defaults to closed", async () => {
    const remoteConfig = new WKRemoteConfig();
    expect(remoteConfig.scanLoginEnabled).toBe(false);

    // Field absent (older server, or appconfig served before the setting loaded):
    // stay closed rather than showing an entry whose every request would fail.
    getSpy.mockResolvedValueOnce({});
    await remoteConfig.requestConfig();
    expect(remoteConfig.scanLoginEnabled).toBe(false);

    // The backend sends a real JSON boolean here, not the 0/1 integer used by
    // sibling switches such as local_login_off.
    getSpy.mockResolvedValueOnce({ scan_login_enabled: true });
    await remoteConfig.requestConfig();
    expect(remoteConfig.scanLoginEnabled).toBe(true);

    getSpy.mockResolvedValueOnce({ scan_login_enabled: false });
    await remoteConfig.requestConfig();
    expect(remoteConfig.scanLoginEnabled).toBe(false);
  });

  it("notifies config-change listeners when scan login is switched at runtime", async () => {
    const remoteConfig = new WKRemoteConfig();
    getSpy.mockResolvedValueOnce({ scan_login_enabled: false });
    await remoteConfig.requestConfig();

    const configChangeListener = vi.fn();
    remoteConfig.addConfigChangeListener(configChangeListener);

    // A runtime switch converges across replicas within ~60s; the login page has
    // already rendered by then, so it only hides/shows the entry if it is told.
    getSpy.mockResolvedValueOnce({ scan_login_enabled: true });
    await remoteConfig.requestConfig();

    expect(remoteConfig.scanLoginEnabled).toBe(true);
    expect(configChangeListener).toHaveBeenCalledTimes(1);
  });
});
