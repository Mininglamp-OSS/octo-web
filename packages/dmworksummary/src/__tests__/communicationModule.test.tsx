import React from "react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  registerNamespace: vi.fn(),
  registerRoute: vi.fn(),
  registerMenu: vi.fn(),
  busOn: vi.fn(),
  registerHeaderItem: vi.fn(),
  registerSummaryPanel: vi.fn(),
  app: {} as Record<string, unknown>,
}));

vi.mock("@octo/base", () => ({
  i18n: { registerNamespace: state.registerNamespace },
  WKApp: {
    route: { register: state.registerRoute },
    menus: { register: state.registerMenu },
    mittBus: { on: state.busOn },
    endpoints: {
      registerChannelHeaderRightItem: state.registerHeaderItem,
      registerChatSummaryPanel: state.registerSummaryPanel,
    },
    ...state.app,
  },
}));

vi.mock("../api/summaryApi", () => ({ getChatCandidates: vi.fn() }));
vi.mock("../utils/channelType", () => ({ isSupportedChannelType: () => true }));
vi.mock("../components/ChatSummaryStarButton", () => ({ default: () => null }));
vi.mock("../components/ChatSummaryPanel", () => ({ default: () => null }));

import { i18n, WKApp } from "@octo/base";
import { getChatCandidates } from "../api/summaryApi";
import ChatSummaryPanel from "../components/ChatSummaryPanel";
import ChatSummaryStarButton from "../components/ChatSummaryStarButton";
import { SummaryCommunicationModule } from "../communication";

describe("SummaryCommunicationModule", () => {
  it("registers only the Summary capabilities required by the chat renderer", async () => {
    const module = new SummaryCommunicationModule();

    expect(module.id()).toBe("SummaryCommunicationModule");
    module.init();

    expect(i18n.registerNamespace).toHaveBeenCalledWith("summary", {
      "zh-CN": expect.any(Object),
      "en-US": expect.any(Object),
    });
    expect(state.registerRoute).not.toHaveBeenCalled();
    expect(state.registerMenu).not.toHaveBeenCalled();
    expect(state.busOn).not.toHaveBeenCalled();

    expect(state.registerHeaderItem).toHaveBeenCalledWith(
      "channelheader.summary",
      expect.any(Function),
      5100
    );
    const headerRenderer = state.registerHeaderItem.mock.calls[0][1];
    const header = headerRenderer({
      channel: { channelID: "group-1", channelType: 2 },
    });
    expect(header.type).toBe(ChatSummaryStarButton);

    expect(state.registerSummaryPanel).toHaveBeenCalledWith(
      "chatsummarypanel",
      expect.any(Function)
    );
    const panelRenderer = state.registerSummaryPanel.mock.calls[0][1];
    const panel = panelRenderer({
      channel: { channelID: "group-1", channelType: 2 },
      onClose: vi.fn(),
      summaryPanelView: "history",
    });
    expect(panel.type).toBe(ChatSummaryPanel);

    vi.mocked(getChatCandidates).mockResolvedValueOnce([] as never);
    await expect(
      WKApp.searchChatCandidates?.({ keyword: "docs" } as never)
    ).resolves.toEqual([]);

    new SummaryCommunicationModule().init();
    expect(state.registerHeaderItem).toHaveBeenCalledTimes(1);
    expect(state.registerSummaryPanel).toHaveBeenCalledTimes(1);
  });
});
