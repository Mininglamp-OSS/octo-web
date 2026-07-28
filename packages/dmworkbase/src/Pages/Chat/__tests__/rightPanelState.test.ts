import { describe, expect, it } from "vitest";
import {
  closeChatRightPanels,
  openChatRightPanel,
  type ChatRightPanelStatePatch,
} from "../rightPanelState";

const closedState: ChatRightPanelStatePatch = {
  showChannelSetting: false,
  showThreadPanel: false,
  activeThread: null,
  previewFile: null,
  activePreviewMessageId: null,
  previewHadThreadShell: false,
  showSummaryPanel: false,
  showChannelSearch: false,
  channelSearchPreviewFile: null,
  previewReturnChannelSearch: false,
  webhookIssuePreviewTarget: null,
};

describe("Chat right panel state", () => {
  it("returns a fresh closed state patch", () => {
    const first = closeChatRightPanels();
    const second = closeChatRightPanels();

    expect(first).toEqual(closedState);
    expect(second).toEqual(closedState);
    expect(first).not.toBe(second);
  });

  it("opens channel setting and closes the other right panels", () => {
    expect(openChatRightPanel("channelSetting")).toEqual({
      ...closedState,
      showChannelSetting: true,
    });
  });

  it("opens the thread panel and closes the other right panels", () => {
    const activeThread = { channel_id: "g1____t1" } as any;

    expect(openChatRightPanel("thread", { activeThread })).toEqual({
      ...closedState,
      showThreadPanel: true,
      activeThread,
    });
  });

  it("opens smart summary and closes the other right panels", () => {
    expect(openChatRightPanel("summary")).toEqual({
      ...closedState,
      showSummaryPanel: true,
    });
  });

  it("opens channel search and closes the other right panels", () => {
    expect(openChatRightPanel("channelSearch")).toEqual({
      ...closedState,
      showChannelSearch: true,
    });
  });

  it("opens file preview in the thread shell and closes the other right panels", () => {
    const previewFile = {
      url: "https://example.test/a.pdf",
      name: "a.pdf",
    } as any;

    expect(
      openChatRightPanel("filePreview", {
        previewFile,
        activePreviewMessageId: "m1",
        previewHadThreadShell: true,
      })
    ).toEqual({
      ...closedState,
      showThreadPanel: true,
      previewFile,
      activePreviewMessageId: "m1",
      previewHadThreadShell: true,
    });
  });

  it("opens webhook preview and closes the other right panels", () => {
    const webhookIssuePreviewTarget = { issueId: "issue-1" } as any;

    expect(
      openChatRightPanel("webhookPreview", { webhookIssuePreviewTarget })
    ).toEqual({
      ...closedState,
      webhookIssuePreviewTarget,
    });
  });
});
