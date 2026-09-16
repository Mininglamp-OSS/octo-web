// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeAll } from "vitest";

// ── Hoisted: stub canvas before any module-level import of @douyinfe/semi-ui ──
vi.hoisted(() => {
  const ctx = new Proxy({}, { get: () => () => {} });
  // @ts-ignore
  HTMLCanvasElement.prototype.getContext = () => ctx as any;
});

vi.mock("react-virtuoso", () => ({
  TableVirtuoso: () => null,
  Virtuoso: () => null,
  VirtuosoGrid: () => null,
}));
vi.mock("../../../Messages/Text/RichText", () => ({ default: () => null }));

import React from "react";
import { Channel } from "wukongimjssdk";
import WKApp from "../../../App";
import { ChatContentPage } from "../index";
import { ChannelTypeCommunityTopic } from "../../../Service/Const";

beforeAll(() => {
  (WKApp.remoteConfig as any).messagesSearchOn = true;
});
afterEach(() => {
  for (const page of mountedPages) page.componentWillUnmount();
  mountedPages.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (WKApp as any).shared.pendingThreadPanel = undefined;
  (WKApp as any).shared.pendingFilePreview = undefined;
});

type Embedding = {
  openConversation: (c: Channel) => void;
  onSidePanelUnavailable: () => void;
};

const EMPTY_EMBEDDING: Embedding = {
  openConversation: vi.fn(),
  onSidePanelUnavailable: vi.fn(),
};

function createPage(channel: Channel, embedding?: Embedding) {
  const props: any = { channel, workspaceEmbedding: embedding };
  const page: any = new ChatContentPage(props);
  page.setState = (update: any) => {
    const next = typeof update === "function" ? update(page.state, page.props) : update;
    if (next) page.state = { ...page.state, ...next };
  };
  page.forceUpdate = vi.fn();
  return page;
}

function mountPage(page: any) {
  mountedPages.push(page);
  page.componentDidMount();
}

const mountedPages: ChatContentPage[] = [];

/** ChatContentPage.render() returns <div> → first child <ConversationWindow> → its props */
function convPropsOf(page: any): Record<string, any> {
  const root = page.render();
  // The ConversationWindow element is the first child of the root <div>
  const conv = root.props.children;
  // It may be an array; find the ConversationWindow-like element
  if (Array.isArray(conv)) {
    return conv.find((c: any) => c?.props?.conversationProps != null)?.props ?? {};
  }
  return conv?.props ?? {};
}

/** Test that the render tree has a ConversationWindow with conversationProps */
function requireConv(page: any): Record<string, any> {
  const result = convPropsOf(page);
  if (!result.conversationProps) {
    throw new Error("ConversationWindow not found in render tree");
  }
  return result;
}

describe("ChatContentPage workspaceEmbedding", () => {
  describe("default path (no workspaceEmbedding)", () => {
    it("opens webhook preview as usual", () => {
      const page = createPage(new Channel("g", 2));
      const setState = vi.spyOn(page, "setState");
      page._openWebhookPreview({ url: "https://f/t", title: "T" });
      expect(setState).toHaveBeenCalled();
      expect(setState.mock.calls[0][0].webhookIssuePreviewTarget).toBeTruthy();
    });

    it("opens file preview as usual", () => {
      const page = createPage(new Channel("g", 2));
      const setState = vi.spyOn(page, "setState");
      page._onFilePreview({ url: "u", name: "f.txt", extension: "txt", size: 1, messageId: "m1" });
      expect(setState).toHaveBeenCalled();
      expect(setState.mock.calls[0][0].previewFile).toBeTruthy();
    });

    it("opens thread panel on onOpenThreadPanel", () => {
      const page = createPage(new Channel("g", 2));
      const setState = vi.spyOn(page, "setState");
      const convProps = requireConv(page);
      convProps.conversationProps.onOpenThreadPanel("g____t1", "Thread 1");
      expect(setState).toHaveBeenCalled();
      expect(setState.mock.calls[0][0].showThreadPanel).toBe(true);
    });

    it("opens channel search panel", () => {
      const page = createPage(new Channel("g", 2));
      const setState = vi.spyOn(page, "setState");
      page._openChannelSearchPanel();
      expect(setState).toHaveBeenCalled();
      expect(setState.mock.calls[0][0].showChannelSearch).toBe(true);
    });

    it("renders header actions with thread and settings buttons", () => {
      const page = createPage(new Channel("g", 2));
      const actions = page.renderConversationHeaderActions(
        new Channel("g", 2), false, false, false
      );
      expect(actions).toBeTruthy();
    });
  });

  describe("opt-in path (workspaceEmbedding provided)", () => {
    it("calls onSidePanelUnavailable for webhook preview", () => {
      const unavailable = vi.fn();
      const page = createPage(new Channel("g", 2), { ...EMPTY_EMBEDDING, onSidePanelUnavailable: unavailable });
      page._openWebhookPreview({ url: "https://f/t", title: "T" });
      expect(unavailable).toHaveBeenCalledTimes(1);
    });

    it("calls onSidePanelUnavailable for file preview", () => {
      const unavailable = vi.fn();
      const page = createPage(new Channel("g", 2), { ...EMPTY_EMBEDDING, onSidePanelUnavailable: unavailable });
      page._onFilePreview({ url: "u", name: "f.txt", extension: "txt", size: 1, messageId: "m1" });
      expect(unavailable).toHaveBeenCalledTimes(1);
    });

    it("calls onSidePanelUnavailable for channel search", () => {
      const unavailable = vi.fn();
      const page = createPage(new Channel("g", 2), { ...EMPTY_EMBEDDING, onSidePanelUnavailable: unavailable });
      page._openChannelSearchPanel();
      expect(unavailable).toHaveBeenCalledTimes(1);
    });

    it("calls onSidePanelUnavailable for summary toggle", () => {
      const unavailable = vi.fn();
      const page = createPage(new Channel("g", 2), { ...EMPTY_EMBEDDING, onSidePanelUnavailable: unavailable });
      mountPage(page);
      page._onToggleSummaryPanel?.({ channelId: "g", channelType: 2, summaryPanelView: "new" });
      expect(unavailable).toHaveBeenCalledTimes(1);
    });

    it("calls onSidePanelUnavailable for channel search event", () => {
      const unavailable = vi.fn();
      const page = createPage(new Channel("g", 2), { ...EMPTY_EMBEDDING, onSidePanelUnavailable: unavailable });
      mountPage(page);
      page._onOpenChannelSearch?.({ channelId: "g", channelType: 2 });
      expect(unavailable).toHaveBeenCalledTimes(1);
    });

    it("navigates sub-channel via openConversation from onOpenThreadPanel", () => {
      const conv = vi.fn();
      const page = createPage(new Channel("g", 2), { ...EMPTY_EMBEDDING, openConversation: conv });
      const convProps = requireConv(page);
      convProps.conversationProps.onOpenThreadPanel("g____t1", "Thread 1");
      expect(conv).toHaveBeenCalledTimes(1);
      expect(conv.mock.calls[0][0].channelID).toBe("g____t1");
      expect(conv.mock.calls[0][0].channelType).toBe(ChannelTypeCommunityTopic);
    });

    it("calls onSidePanelUnavailable from _onPendingThread when no thread", () => {
      const unavailable = vi.fn();
      const page = createPage(new Channel("g", 2), { ...EMPTY_EMBEDDING, onSidePanelUnavailable: unavailable });
      mountPage(page);
      page._onPendingThread?.({ groupNo: "g", thread: null });
      expect(unavailable).toHaveBeenCalledTimes(1);
    });

    it("navigates from _onPendingThread via openConversation when thread has channel_id", () => {
      const conv = vi.fn();
      const page = createPage(new Channel("g", 2), { ...EMPTY_EMBEDDING, openConversation: conv });
      mountPage(page);
      page._onPendingThread?.({ groupNo: "g", thread: { channel_id: "g____t2" } as any });
      expect(conv).toHaveBeenCalledTimes(1);
      expect(conv.mock.calls[0][0].channelID).toBe("g____t2");
    });

    it("header onBack is undefined in embedding mode", () => {
      const page = createPage(new Channel("g", 2), EMPTY_EMBEDDING);
      const convProps = requireConv(page);
      expect(convProps.header.onBack).toBeUndefined();
    });

    it("header actions hide thread and settings buttons", () => {
      const page = createPage(new Channel("g", 2), EMPTY_EMBEDDING);
      const actions = page.renderConversationHeaderActions(
        new Channel("g", 2), false, false, true
      );
      const children = React.Children.toArray(actions?.props?.children ?? []);
      const divs = children.filter((c: any) => c?.type === "div");
      expect(divs.length).toBe(0);
    });

    it("default header mode is full (no workspaceEmbedding)", () => {
      const page = createPage(new Channel("g", 2));
      const convProps = requireConv(page);
      expect(convProps.headerMode).toBeUndefined();
    });

    it("sets headerMode selection-only when workspaceEmbedding is provided", () => {
      const page = createPage(new Channel("g", 2), EMPTY_EMBEDDING);
      const convProps = requireConv(page);
      expect(convProps.headerMode).toBe("selection-only");
    });

    it("does not set headerMode selection-only without workspaceEmbedding", () => {
      const page = createPage(new Channel("g", 2));
      const convProps = requireConv(page);
      expect(convProps.headerMode).not.toBe("selection-only");
    });

    it("ConversationWindow inactive is false in embedding mode even with showChannelSetting", () => {
      const page = createPage(new Channel("g", 2), EMPTY_EMBEDDING);
      page.setState({ showChannelSetting: true });
      const convProps = requireConv(page);
      expect(convProps.inactive).toBe(false);
    });

    it("cleans side panel state on embed↔full transition", () => {
      const page = createPage(new Channel("g", 2));
      page.setState({ showChannelSetting: true, showThreadPanel: true, showSummaryPanel: true });
      const prevProps = { channel: new Channel("g", 2) };
      page.props = { channel: new Channel("g", 2), workspaceEmbedding: EMPTY_EMBEDDING };
      page.componentDidUpdate(prevProps, page.state);
      expect(page.state.showChannelSetting).toBe(false);
      expect(page.state.showThreadPanel).toBe(false);
      expect(page.state.showSummaryPanel).toBe(false);
    });

    it("cleans side panel state on full→embed transition", () => {
      const page = createPage(new Channel("g", 2), EMPTY_EMBEDDING);
      page.setState({ showChannelSetting: true, showThreadPanel: true });
      const prevProps = { channel: new Channel("g", 2), workspaceEmbedding: EMPTY_EMBEDDING };
      page.props = { channel: new Channel("g", 2) };
      page.componentDidUpdate(prevProps, page.state);
      expect(page.state.showChannelSetting).toBe(false);
      expect(page.state.showThreadPanel).toBe(false);
    });

    it("updates embedding presentation in place without replacing the page", () => {
      const page = createPage(new Channel("g", 2), EMPTY_EMBEDDING);
      page.setState({ showChannelSetting: true, showThreadPanel: true });

      page.updateWorkspaceEmbedding(undefined);

      expect(page.state.workspaceEmbedding).toBeUndefined();
      expect(page.state.showChannelSetting).toBe(false);
      expect(page.state.showThreadPanel).toBe(false);
      expect(requireConv(page).headerMode).toBeUndefined();
    });

    it("reconciles queued presentation updates before acknowledging the latest one", () => {
      const page = createPage(new Channel("g", 2));
      const queue: Array<() => void> = [];
      page.setState = (update: any, callback?: () => void) => {
        queue.push(() => {
          const next = typeof update === "function" ? update(page.state, page.props) : update;
          if (next) page.state = { ...page.state, ...next };
          callback?.();
        });
      };
      const snapshots: unknown[] = [];
      page.updateWorkspaceEmbedding(EMPTY_EMBEDDING, () => snapshots.push(page.state.workspaceEmbedding));
      page.updateWorkspaceEmbedding(undefined, () => snapshots.push(page.state.workspaceEmbedding));
      expect(snapshots).toEqual([]);
      expect(queue).toHaveLength(2);
      queue.forEach((commit) => commit());
      expect(snapshots).toEqual([EMPTY_EMBEDDING, undefined]);
      expect(page.state.workspaceEmbedding).toBeUndefined();
    });

    it("reports completion for an unchanged presentation without clearing panels", () => {
      const page = createPage(new Channel("g", 2));
      page.setState({ showChannelSetting: true });
      const onCommitted = vi.fn();
      page.setState = (update: any, callback?: () => void) => {
        expect(update(page.state, page.props)).toBeNull();
        callback?.();
      };
      page.updateWorkspaceEmbedding(undefined, onCommitted);
      expect(onCommitted).toHaveBeenCalledTimes(1);
      expect(page.state.showChannelSetting).toBe(true);
    });

    it("constructor does not set showChannelSearch when embedding", () => {
      const page = new ChatContentPage({
        channel: new Channel("g", 2),
        workspaceEmbedding: EMPTY_EMBEDDING,
        initialShowChannelSearch: true,
      });
      expect(page.state.showChannelSearch).toBe(false);
    });

    it("renders without side panels", () => {
      const page = createPage(new Channel("g", 2), EMPTY_EMBEDDING);
      page.setState({
        showChannelSetting: true, showChannelSearch: true, showThreadPanel: true,
        showSummaryPanel: true,
        previewFile: { url: "u", name: "f.txt", extension: "txt", size: 1 },
        webhookIssuePreviewTarget: { url: "https://f/t" },
      });
      const tree = page.render();
      expect(tree.props.className).toBe("wk-chat-content-right");
      const children = React.Children.toArray(tree.props.children);
      expect(children).toHaveLength(1);
      expect((children[0] as React.ReactElement).props.conversationProps).toBeDefined();
    });

    it("preserves message selection callbacks and the regular composer surface", () => {
      const page = createPage(new Channel("g", 2), EMPTY_EMBEDDING);
      const conversation = requireConv(page);
      conversation.conversationProps.onSelectionStateChange({ editOn: true, checkedCount: 3 });
      const selected = requireConv(page);
      expect(selected.selection.active).toBe(true);
      expect(selected.selection.count).toBe(3);
      expect(selected.channel.channelID).toBe("g");
      expect(selected.client).toBe(conversation.client);
      expect(selected.bindConversationContext).toBe(conversation.bindConversationContext);
    });
  });
});
