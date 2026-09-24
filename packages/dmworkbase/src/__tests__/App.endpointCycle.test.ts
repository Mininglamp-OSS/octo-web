// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: { provider: {} as any },
}));

// Keep the production App <-> EndpointCommon edge intact. These mocks only
// replace UI-only dependencies that App does not use during module setup.
vi.mock("../Components/WKBase", () => ({ default: class {} }));
vi.mock("../Service/TypingManager", () => ({
  TypingManager: { shared: { resetAll: vi.fn() } },
}));
vi.mock("../Pages/Chat", () => ({ ChatContentPage: () => null }));
vi.mock("wukongimjssdk", () => ({
  default: {},
  Channel: class {},
  Message: class {},
  MessageContentType: { text: 1, image: 2 },
  ConnectStatus: { Connected: 1, Disconnect: 2, ConnectKick: 3 },
  WKSDK: {
    shared: () => ({
      config: state.config,
      connectManager: { addConnectStatusListener: vi.fn() },
      channelManager: {},
      conversationManager: {},
    }),
  },
}));

describe("WKApp endpoint initialization", () => {
  it("loads EndpointCommon before App and initializes endpoints only after both modules evaluate", async () => {
    vi.resetModules();
    const { EndpointCommon } = await import("../EndpointCommon");
    const { default: WKApp } = await import("../App");
    const { EndpointID } = await import("../Service/Const");
    const { EndpointManager } = await import("../Service/Module");

    expect(WKApp.endpoints).toBeInstanceOf(EndpointCommon);
    expect(EndpointManager.shared.get(EndpointID.showConversation)?.handler).toBeTypeOf(
      "function"
    );
  });
});
