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

import WKApp from "../App";
import { EndpointCommon } from "../EndpointCommon";
import { EndpointID } from "../Service/Const";
import { EndpointManager } from "../Service/Module";

describe("WKApp endpoint initialization", () => {
  it("loads the real App <-> EndpointCommon cycle and registers showConversation", () => {
    expect(WKApp.endpoints).toBeInstanceOf(EndpointCommon);
    expect(EndpointManager.shared.get(EndpointID.showConversation)?.handler).toBeTypeOf(
      "function"
    );
  });
});
