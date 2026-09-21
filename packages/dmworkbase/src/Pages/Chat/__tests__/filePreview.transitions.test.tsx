import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Channel } from "wukongimjssdk";
import WKApp from "../../../App";
import type { FilePreviewInfo } from "../../../Components/FilePreviewPanel/types";
import {
  notifyHostAttachmentClosed,
  setWebAttachmentHost,
  subscribeHostAttachmentPreview,
  type AttachmentPreviewResult,
  type WebAttachmentHost,
} from "../../../features/filePreview/attachmentHost";
import { ChatContentPage, type ChatContentPageState } from "../index";

vi.mock("react-virtuoso", () => ({
  TableVirtuoso: () => null,
  Virtuoso: () => null,
  VirtuosoGrid: () => null,
}));
vi.mock("../../../Messages/Text/RichText", () => ({ default: () => null }));

interface PageHarness {
  _onFilePreview(file: FilePreviewInfo): void;
  _openChannelSearchPanel(): void;
  _closeThreadPanel(): void;
  _openWebhookPreview(target: { url: string; title: string }): void;
  renderConversationHeaderActions(
    channel: Channel, isThread: boolean, showSettings: boolean, embedded: boolean,
  ): React.ReactNode;
}

const harness = (page: ChatContentPage) => page as unknown as PageHarness;
const channel = new Channel("g_100", 2);
const file: FilePreviewInfo = {
  url: "https://example.com/report.pdf",
  name: "report.pdf",
  extension: "pdf",
  size: 1024,
  sourceChannelId: channel.channelID,
  sourceChannelType: channel.channelType,
  messageId: "123456789012345678",
  messageSeq: 42,
  attachmentIndex: 0,
};
const summaryEvent = {
  channelId: channel.channelID, channelType: channel.channelType, summaryPanelView: "new" as const,
};
const mountedPages: ChatContentPage[] = [];
let host: WebAttachmentHost;
let finish: (result: AttachmentPreviewResult) => void;
let restoreConfig: () => void;
let unsubscribe: () => void;
const published = vi.fn();

// Drain the bridge promise, takeover continuation and cancellation dispatch.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createPage() {
  const page = new ChatContentPage({ channel });
  page.setState = (update, callback) => {
    const patch = typeof update === "function" ? update(page.state, page.props) : update;
    if (patch) page.state = { ...page.state, ...patch };
    callback?.();
  };
  page.forceUpdate = vi.fn();
  mountedPages.push(page);
  page.componentDidMount();
  return page;
}

function clickHeader(page: ChatContentPage, testId: string) {
  interface EntryProps {
    "data-testid"?: string;
    children?: React.ReactNode;
    onClick?: (event: { stopPropagation(): void; currentTarget: HTMLElement }) => void;
  }
  const actions = harness(page).renderConversationHeaderActions(channel, false, false, false);
  if (!React.isValidElement<EntryProps>(actions)) throw new Error("Missing header actions");
  const entry = React.Children.toArray(actions.props.children).find(
    (child) => React.isValidElement<EntryProps>(child) && child.props["data-testid"] === testId,
  );
  if (!React.isValidElement<EntryProps>(entry) || !entry.props.onClick) {
    throw new Error(`Missing header entry ${testId}`);
  }
  entry.props.onClick({ stopPropagation: vi.fn(), currentTarget: document.createElement("button") });
}

function openConversationThread(page: ChatContentPage) {
  interface ConversationProps {
    conversationProps?: { onOpenThreadPanel(channelId: string, name: string): void };
  }
  const conversation = React.Children.toArray(page.render().props.children).find(
    (child) => React.isValidElement<ConversationProps>(child) && child.props.conversationProps,
  );
  if (!React.isValidElement<ConversationProps>(conversation) || !conversation.props.conversationProps) {
    throw new Error("Missing conversation actions");
  }
  conversation.props.conversationProps.onOpenThreadPanel("g_100____thread1", "Thread 1");
}

interface Transition {
  name: string;
  prepare?(page: ChatContentPage): void;
  run(page: ChatContentPage): void;
  expected: Partial<ChatContentPageState>;
}

const transitions: Transition[] = [
  {
    name: "summary open event",
    run: () => WKApp.mittBus.emit("wk:toggle-summary-panel", summaryEvent),
    expected: { showSummaryPanel: true },
  },
  {
    name: "summary close event",
    prepare: () => WKApp.mittBus.emit("wk:toggle-summary-panel", summaryEvent),
    run: () => WKApp.mittBus.emit("wk:toggle-summary-panel", summaryEvent),
    expected: { showSummaryPanel: false },
  },
  {
    name: "pending thread event",
    run: () => WKApp.mittBus.emit("wk:pending-thread", { groupNo: channel.channelID, thread: null }),
    expected: { showThreadPanel: true },
  },
  {
    name: "conversation thread action",
    run: openConversationThread,
    expected: { showThreadPanel: true, activeThread: expect.objectContaining({ channel_id: "g_100____thread1" }) },
  },
  {
    name: "search action",
    run: (page) => harness(page)._openChannelSearchPanel(),
    expected: { showChannelSearch: true },
  },
  {
    name: "search event",
    run: () => WKApp.mittBus.emit("wk:open-channel-search", summaryEvent),
    expected: { showChannelSearch: true },
  },
  {
    name: "settings header action",
    run: (page) => clickHeader(page, "chat-channel-setting-entry"),
    expected: { showChannelSetting: true },
  },
  {
    name: "thread header action",
    run: (page) => clickHeader(page, "chat-thread-panel-entry"),
    expected: { showThreadPanel: true },
  },
  {
    name: "webhook preview",
    run: (page) => harness(page)._openWebhookPreview({ url: "https://example.com/issue", title: "Issue" }),
    expected: { webhookIssuePreviewTarget: { url: "https://example.com/issue", title: "Issue" } },
  },
  {
    name: "close thread without a rendered preview",
    prepare: (page) => clickHeader(page, "chat-thread-panel-entry"),
    run: (page) => harness(page)._closeThreadPanel(),
    expected: { showThreadPanel: false },
  },
  {
    name: "close thread event",
    prepare: (page) => clickHeader(page, "chat-thread-panel-entry"),
    run: () => WKApp.mittBus.emit("wk:close-thread-panel"),
    expected: { showThreadPanel: false },
  },
  {
    name: "workspace embedding change",
    run: (page) => page.updateWorkspaceEmbedding({ openConversation: vi.fn(), onSidePanelUnavailable: vi.fn() }),
    expected: { workspaceEmbedding: expect.any(Object), showThreadPanel: false },
  },
  {
    name: "search permission removal",
    prepare: (page) => harness(page)._openChannelSearchPanel(),
    run: (page) => {
      WKApp.remoteConfig.messagesSearchOn = false;
      page.componentDidUpdate(page.props, page.state);
    },
    expected: { showChannelSearch: false },
  },
];

beforeEach(() => {
  const { messagesSearchOn, threadOn } = WKApp.remoteConfig;
  restoreConfig = () => Object.assign(WKApp.remoteConfig, { messagesSearchOn, threadOn });
  WKApp.remoteConfig.messagesSearchOn = true;
  WKApp.remoteConfig.threadOn = true;
  host = {
    openFilePreview: vi.fn(() => new Promise<AttachmentPreviewResult>((resolve) => { finish = resolve; })),
    cancelFilePreview: vi.fn().mockResolvedValue(undefined),
  };
  setWebAttachmentHost(host);
  published.mockClear();
  unsubscribe = subscribeHostAttachmentPreview(published);
});

afterEach(async () => {
  for (const page of mountedPages.splice(0)) page.componentWillUnmount();
  setWebAttachmentHost(null);
  unsubscribe();
  restoreConfig();
  WKApp.shared.pendingThreadPanel = undefined;
  WKApp.shared.pendingFilePreview = undefined;
  await settle();
  vi.restoreAllMocks();
});

describe.each(["accepted", "unsupported"] as const)("late host %s after panel transition", (status) => {
  it.each(transitions)("$name cancels the exact request and preserves the new panel", async (transition) => {
    const page = createPage();
    transition.prepare?.(page);
    harness(page)._onFilePreview(file);
    await settle();
    expect(host.openFilePreview).toHaveBeenCalledOnce();
    const request = vi.mocked(host.openFilePreview).mock.calls[0][0];

    transition.run(page);
    expect(page.state).toMatchObject(transition.expected);
    const stateAfterTransition = { ...page.state };
    finish({ status });
    await settle();

    expect(host.cancelFilePreview).toHaveBeenCalledExactlyOnceWith({ version: 1, requestId: request.requestId });
    expect(page.state).toEqual(stateAfterTransition);
    expect(page.state.previewFile).toBeNull();
    expect(published.mock.calls).toEqual([[null]]);
  });
});

describe("accepted native preview ownership", () => {
  it.each(["split", "overlay"] as const)(
    "hides an already-open summary during non-inline takeover and restores its %s layout",
    async (panelLayout) => {
      const page = createPage();
      page.setState({ contentLayout: { panelLayout, navigationCollapsed: false } });
      WKApp.mittBus.emit("wk:toggle-summary-panel", summaryEvent);
      await settle();
      expect(page.state.showSummaryPanel).toBe(true);

      WKApp.mittBus.emit("wk:file-preview", file);
      await settle();
      expect(host.openFilePreview).toHaveBeenCalledOnce();
      const request = vi.mocked(host.openFilePreview).mock.calls[0][0];
      finish({ status: "accepted" });
      await settle();

      expect(page.state.hostPreviewSource).toEqual(request.locator);
      expect(page.state.showSummaryPanel).toBe(true);
      expect(host.cancelFilePreview).not.toHaveBeenCalled();
      const root = page.render();
      if (!React.isValidElement<Record<string, unknown> & { children?: React.ReactNode }>(root)) throw new Error("Missing chat root");
      expect(root.props.className).not.toContain("wk-chat-summary-panel-open");
      expect(root.props["data-chat-panel-layout"]).toBeUndefined();
      expect(root.props["data-chat-parent-hidden"]).toBeUndefined();
      expect(root.props["data-chat-thread-hidden"]).toBe(true);
      const summary = React.Children.toArray(root.props.children).find(child =>
        React.isValidElement<{ className?: string }>(child) && child.props.className === "wk-summary-panel",
      );
      if (!React.isValidElement<{ hidden?: boolean }>(summary)) throw new Error("Missing mounted summary");
      expect(summary.props.hidden).toBe(true);

      notifyHostAttachmentClosed(request.requestId);
      await settle();

      expect(page.state.hostPreviewSource).toBeNull();
      expect(page.state.showSummaryPanel).toBe(true);
      const restored = page.render();
      if (!React.isValidElement<Record<string, unknown> & { children?: React.ReactNode }>(restored)) throw new Error("Missing chat root");
      expect(restored.props.className).toContain("wk-chat-summary-panel-open");
      expect(restored.props["data-chat-panel-layout"]).toBe(panelLayout);
      expect(restored.props["data-chat-thread-hidden"]).toBeUndefined();
      expect(restored.props["data-chat-parent-hidden"]).toBe(panelLayout === "overlay" || undefined);
      const restoredSummary = React.Children.toArray(restored.props.children).find(child =>
        React.isValidElement<{ className?: string }>(child) && child.props.className === "wk-summary-panel",
      );
      if (!React.isValidElement<{ hidden?: boolean }>(restoredSummary)) throw new Error("Missing restored summary");
      expect(restoredSummary.props.hidden).toBe(false);
    },
  );

  it.each(["inline", "fallback"] as const)(
    "%s preview still replaces an already-open summary",
    async (mode) => {
      if (mode === "inline") {
        host.openFilePreviewInPlace = vi.fn().mockResolvedValue({ status: "accepted" });
        host.setFilePreviewLayout = vi.fn().mockResolvedValue(undefined);
      }
      const page = createPage();
      WKApp.mittBus.emit("wk:toggle-summary-panel", summaryEvent);
      await settle();
      WKApp.mittBus.emit("wk:file-preview", file);
      await settle();
      if (mode === "fallback") {
        finish({ status: "unsupported" });
        await settle();
      }
      expect(page.state.showSummaryPanel).toBe(false);
      expect(page.state.previewFile).toMatchObject(file);
      expect(host.cancelFilePreview).not.toHaveBeenCalled();
    },
  );

  it.each(transitions)("$name releases an already accepted source", async (transition) => {
    const page = createPage();
    transition.prepare?.(page);
    harness(page)._onFilePreview(file);
    await settle();
    const request = vi.mocked(host.openFilePreview).mock.calls[0][0];
    finish({ status: "accepted" });
    await settle();
    expect(published).toHaveBeenLastCalledWith(request.locator);

    transition.run(page);
    await settle();

    expect(host.cancelFilePreview).toHaveBeenCalledExactlyOnceWith({ version: 1, requestId: request.requestId });
    expect(published.mock.calls).toEqual([[null], [request.locator], [null]]);
    expect(page.state).toMatchObject({ ...transition.expected, hostPreviewSource: null });
  });

  it("preserves explicit unsupported fallback when no panel transition occurs", async () => {
    const page = createPage();
    harness(page)._onFilePreview(file);
    await settle();
    finish({ status: "unsupported" });
    await settle();
    expect(page.state.previewFile).toEqual(file);
    expect(host.cancelFilePreview).not.toHaveBeenCalled();
  });

  it("does not invalidate a pending request for unchanged workspace embedding", async () => {
    const page = createPage();
    harness(page)._onFilePreview(file);
    await settle();
    page.updateWorkspaceEmbedding(undefined);
    finish({ status: "accepted" });
    await settle();
    expect(host.cancelFilePreview).not.toHaveBeenCalled();
    expect(page.state.hostPreviewSource).toMatchObject({ channelId: channel.channelID });
  });

  it("does not cancel itself when opening the normal inline preview panel", async () => {
    host.openFilePreviewInPlace = vi.fn().mockResolvedValue({ status: "accepted" });
    host.setFilePreviewLayout = vi.fn().mockResolvedValue(undefined);
    const page = createPage();
    harness(page)._onFilePreview(file);
    await settle();
    expect(host.openFilePreviewInPlace).toHaveBeenCalledOnce();
    const request = vi.mocked(host.openFilePreviewInPlace).mock.calls[0][0];
    expect(page.state.previewFile).toMatchObject({ ...file, hostPreview: { requestId: request.requestId } });
    expect(host.cancelFilePreview).not.toHaveBeenCalled();
    expect(page.state.hostPreviewSource).toEqual(request.locator);
  });

  it.each(["split", "overlay"] as const)(
    "renders the summary open state in %s layout and clears the accepted host source",
    async (panelLayout) => {
      const page = createPage();
      page.setState({ contentLayout: { panelLayout, navigationCollapsed: false } });
      harness(page)._onFilePreview(file);
      await settle();
      const request = vi.mocked(host.openFilePreview).mock.calls[0][0];
      finish({ status: "accepted" });
      await settle();
      expect(page.state.hostPreviewSource).toMatchObject({ channelId: channel.channelID });

      WKApp.mittBus.emit("wk:toggle-summary-panel", summaryEvent);
      await settle();

      expect(page.state.hostPreviewSource).toBeNull();
      expect(page.state.showSummaryPanel).toBe(true);
      expect(host.cancelFilePreview).toHaveBeenCalledWith({ version: 1, requestId: request.requestId });
      const root = page.render();
      if (!React.isValidElement<Record<string, unknown>>(root)) throw new Error("Missing chat root");
      expect(root.props.className).toContain("wk-chat-summary-panel-open");
      expect(root.props["data-chat-panel-layout"]).toBe(panelLayout);
      expect(root.props["data-chat-thread-hidden"]).toBeUndefined();
      expect(root.props["data-chat-parent-hidden"]).toBe(panelLayout === "overlay" || undefined);
    },
  );

  it("does not resurrect stale host preview state when acceptance lands after summary opens", async () => {
    const page = createPage();
    page.setState({ contentLayout: { panelLayout: "split", navigationCollapsed: false } });
    harness(page)._onFilePreview(file);
    await settle();

    WKApp.mittBus.emit("wk:toggle-summary-panel", summaryEvent);
    await settle();
    expect(page.state.showSummaryPanel).toBe(true);

    finish({ status: "accepted" });
    await settle();

    expect(page.state.hostPreviewSource).toBeNull();
    expect(page.state.showSummaryPanel).toBe(true);
    const root = page.render();
    if (!React.isValidElement<Record<string, unknown>>(root)) throw new Error("Missing chat root");
    expect(root.props.className).toContain("wk-chat-summary-panel-open");
    expect(root.props["data-chat-panel-layout"]).toBe("split");
    expect(root.props["data-chat-thread-hidden"]).toBeUndefined();
    expect(root.props["data-chat-parent-hidden"]).toBeUndefined();
  });
});
