// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-virtuoso", () => ({
  TableVirtuoso: () => null,
  Virtuoso: () => null,
  VirtuosoGrid: () => null,
}));

import { Channel } from "wukongimjssdk";
import WKApp from "../../../App";
import { ChatContentPage } from "../index";
import type { FilePreviewInfo } from "../../../Components/FilePreviewPanel/types";
import type { ChannelSearchItem } from "../../../Service/SearchTypes";
import {
  setWebAttachmentHost,
  type WebAttachmentHost,
  type AttachmentPreviewResult,
} from "../../../features/filePreview/attachmentHost";

interface PreviewState {
  previewFile: FilePreviewInfo | null;
  channelSearchPreviewFile: FilePreviewInfo | null;
  activePreviewMessageId: string | null;
  showThreadPanel: boolean;
  showChannelSearch: boolean;
  activeThread: { channel_id: string } | null;
  threadFromDirectory?: boolean;
  previewHadThreadShell: boolean;
}

// Tests exercise private transitions without changing the production API.
interface PageHarness {
  state: PreviewState;
  setState: (update: Partial<PreviewState> | ((state: PreviewState, props: { channel: Channel }) =>
    Partial<PreviewState> | null), cb?: () => void) => void;
  forceUpdate: () => void;
  props: { channel: Channel };
  _onSearchFilePreview: (item: ChannelSearchItem) => void;
  _onFilePreview: (file: FilePreviewInfo | null, options?: { returnToChannelSearch?: boolean }) => void;
  _closePreview: (resetThreadShell?: boolean) => void;
  _closeChannelSearchPanel: () => void;
  _openChannelSearchPanel: () => void;
  componentWillUnmount: () => void;
  componentDidUpdate: (prevProps: { channel: Channel }, prevState: PreviewState) => void;
}

function createPage(channel?: Channel): PageHarness {
  const page = new ChatContentPage({ channel: channel ?? new Channel("g", 2) }) as unknown as PageHarness;
  page.setState = (update, cb) => {
    const next = typeof update === "function" ? update(page.state, page.props) : update;
    if (next) page.state = { ...page.state, ...next };
    cb?.();
  };
  page.forceUpdate = vi.fn();
  return page;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function searchItem(overrides: Partial<ChannelSearchItem> = {}): ChannelSearchItem {
  return {
    id: "sid1",
    timestamp: 1700000000,
    kind: "file",
    channelId: "g",
    channelType: 2,
    messageId: "m1",
    messageSeq: 1,
    senderUid: "u1",
    ...overrides,
  };
}

let host: WebAttachmentHost;
let resolveRequest: ((r: AttachmentPreviewResult) => void) | undefined;
let savedMessagesSearchOn: boolean;

beforeEach(() => {
  vi.restoreAllMocks();
  savedMessagesSearchOn = WKApp.remoteConfig.messagesSearchOn;
  WKApp.remoteConfig.messagesSearchOn = true;
  host = {
    openFilePreview: vi.fn().mockImplementation(
      () => new Promise<AttachmentPreviewResult>((resolve) => { resolveRequest = resolve; }),
    ),
    cancelFilePreview: vi.fn().mockResolvedValue(undefined),
  };
  setWebAttachmentHost(host);
});

afterEach(() => {
  setWebAttachmentHost(null);
  vi.restoreAllMocks();
  WKApp.remoteConfig.messagesSearchOn = savedMessagesSearchOn;
  WKApp.shared.pendingThreadPanel = undefined;
  WKApp.shared.pendingFilePreview = undefined;
  resolveRequest = undefined;
});

describe("file preview lifecycle", () => {
  it("preserves independent downloadUrl/filename when search preview falls back to Web", () => {
    setWebAttachmentHost(null);
    const page = createPage();
    page._onSearchFilePreview(searchItem({
      file: {
        name: "设计稿.html",
        previewUrl: "https://cdn/preview/design.html",
        downloadUrl: "https://cdn/download/design.html",
        size: 2048,
      },
    }));
    const preview = page.state.channelSearchPreviewFile!;
    expect(preview).not.toBeNull();
    expect(preview.url).toBe("https://cdn/preview/design.html");
    expect(preview.downloadUrl).toBe("https://cdn/download/design.html");
    expect(preview.name).toBe("设计稿.html");
    expect(preview.sourceChannelId).toBe("g");
    expect(preview.sourceChannelType).toBe(2);
    expect(preview.messageId).toBe("m1");
  });

  it("opens file from existing thread shell without navigating away", () => {
    setWebAttachmentHost(null);
    const page = createPage(new Channel("g", 2));
    page.setState({
      showThreadPanel: true,
      activeThread: { channel_id: "g____t1" },
      threadFromDirectory: true,
    });
    const showConversation = vi.spyOn(WKApp.endpoints, "showConversation").mockImplementation(() => {});

    page._onFilePreview({
      url: "blob:preview/report",
      sourceUrl: "/files/source/report.html",
      downloadUrl: "/files/download/report.html",
      name: "report.html",
      extension: "html",
      size: 1024,
      sourceChannelId: "g____t1",
      sourceChannelType: 5,
      messageId: "m2",
      messageSeq: 42,
      attachmentIndex: 0,
    });

    expect(page.state.previewFile).toMatchObject({
      url: "blob:preview/report",
      sourceUrl: "/files/source/report.html",
      downloadUrl: "/files/download/report.html",
      name: "report.html",
      extension: "html",
      messageId: "m2",
    });
    expect(page.state.activeThread).toEqual({ channel_id: "g____t1" });
    expect(page.state.threadFromDirectory).toBe(true);
    expect(page.state.previewHadThreadShell).toBe(true);
    // Without a host, the thread attachment stays in the Web panel.
    expect(host.openFilePreview).not.toHaveBeenCalled();
    expect(showConversation).not.toHaveBeenCalled();

    page._closePreview(false);
    expect(page.state.previewFile).toBeNull();
    expect(page.state.activeThread).toEqual({ channel_id: "g____t1" });
    expect(page.state.threadFromDirectory).toBe(true);
    expect(page.state.showThreadPanel).toBe(true);
  });

  it("_onFilePreview(null) closes an in-progress inline preview and cancels the host", async () => {
    // Inline host opens the Web preview immediately while the native
    // takeover remains pending.
    const inlineHost: WebAttachmentHost = {
      openFilePreview: vi.fn(),
      openFilePreviewInPlace: vi.fn().mockImplementation(
        () => new Promise<AttachmentPreviewResult>((resolve) => { resolveRequest = resolve; }),
      ),
      setFilePreviewLayout: vi.fn().mockResolvedValue(undefined),
      cancelFilePreview: vi.fn().mockResolvedValue(undefined),
    };
    setWebAttachmentHost(inlineHost);
    const page = createPage();
    // Open the channel search panel first so a real search context exists
    // that must survive the preview close.
    page._openChannelSearchPanel();
    expect(page.state.showChannelSearch).toBe(true);

    page._onSearchFilePreview(searchItem({
      messageId: "9", messageSeq: 9,
      file: { name: "doc1.pdf", url: "https://cdn/doc1.pdf", size: 1024 },
    }));
    expect(page.state.channelSearchPreviewFile).not.toBeNull();
    await flush();
    expect(inlineHost.openFilePreviewInPlace).toHaveBeenCalledOnce();

    expect(() => page._onFilePreview(null)).not.toThrow();
    await flush();

    expect(page.state.previewFile).toBeNull();
    expect(page.state.channelSearchPreviewFile).toBeNull();
    expect(page.state.activePreviewMessageId).toBeNull();
    // Search panel context survives the close.
    expect(page.state.showChannelSearch).toBe(true);
    // The pending native request is cancelled.
    const request = vi.mocked(inlineHost.openFilePreviewInPlace!).mock.calls[0][0];
    expect(inlineHost.cancelFilePreview).toHaveBeenCalledWith({
      version: 1, requestId: request.requestId,
    });

    // Late host acceptance must not reopen the closed preview.
    resolveRequest!({ status: "accepted" });
    await flush();
    expect(page.state.channelSearchPreviewFile).toBeNull();
    expect(page.state.previewFile).toBeNull();
  });

  it("_onFilePreview(null) preserves thread shell and search context", () => {
    setWebAttachmentHost(null);
    const page = createPage(new Channel("g", 2));
    page.setState({
      showThreadPanel: true,
      activeThread: { channel_id: "g____t1" },
      threadFromDirectory: true,
    });
    // Open a thread attachment through the Web fallback.
    page._onFilePreview({
      url: "blob:preview/img",
      name: "photo.png",
      extension: "png",
      size: 512,
      sourceChannelId: "g____t1",
      sourceChannelType: 5,
      messageId: "m10",
    });
    expect(page.state.previewFile).not.toBeNull();
    expect(page.state.previewHadThreadShell).toBe(true);

    // null closes cleanly, leaving the thread shell intact.
    page._onFilePreview(null);
    expect(page.state.previewFile).toBeNull();
    expect(page.state.channelSearchPreviewFile).toBeNull();
    expect(page.state.activeThread).toEqual({ channel_id: "g____t1" });
    expect(page.state.threadFromDirectory).toBe(true);
    expect(page.state.showThreadPanel).toBe(true);
  });

  it("does not reopen a closed search preview after late host acceptance", async () => {
    const page = createPage();
    page._onSearchFilePreview(searchItem({
      messageId: "2", messageSeq: 2,
      file: { name: "report.pdf", url: "https://cdn/report.pdf", size: 4096 },
    }));
    await flush();
    expect(host.openFilePreview).toHaveBeenCalledOnce();

    page._closeChannelSearchPanel();
    expect(page.state.showChannelSearch).toBe(false);
    expect(page.state.channelSearchPreviewFile).toBeNull();

    resolveRequest!({ status: "accepted" });
    await flush();
    expect(page.state.channelSearchPreviewFile).toBeNull();
    expect(page.state.previewFile).toBeNull();
    expect(page.state.showChannelSearch).toBe(false);
  });

  it("restores Web preview when host reports unsupported after a search preview", async () => {
    const page = createPage();
    page._onSearchFilePreview(searchItem({
      messageId: "6", messageSeq: 6,
      file: {
        name: "report.html",
        url: "https://cdn/report.html",
        previewUrl: "https://cdn/preview/report.html",
        downloadUrl: "https://cdn/download/report.html",
        size: 2048,
      },
    }));
    await flush();
    expect(host.openFilePreview).toHaveBeenCalledOnce();

    resolveRequest!({ status: "unsupported" });
    await flush();

    const preview = page.state.channelSearchPreviewFile!;
    expect(preview).not.toBeNull();
    expect(preview.url).toBe("https://cdn/preview/report.html");
    expect(preview.downloadUrl).toBe("https://cdn/download/report.html");
    expect(preview.name).toBe("report.html");
    expect(preview.messageId).toBe("6");
  });

  it("cleans up pending host request on unmount", async () => {
    const page = createPage();
    page._onSearchFilePreview(searchItem({
      messageId: "3", messageSeq: 3,
      file: { name: "doc.docx", url: "https://cdn/doc.docx", size: 2048 },
    }));
    await flush();
    const request = vi.mocked(host.openFilePreview).mock.calls[0][0];

    page.componentWillUnmount();
    await flush();
    expect(host.cancelFilePreview).toHaveBeenCalledWith({
      version: 1,
      requestId: request.requestId,
    });
  });

  it("cleans up pending host request on channel change and rejects late reply", async () => {
    const page = createPage(new Channel("g-a", 2));
    page._onSearchFilePreview(searchItem({
      channelId: "g-a", messageId: "4", messageSeq: 4,
      file: { name: "notes.txt", url: "https://cdn/notes.txt", size: 512 },
    }));
    await flush();
    const request = vi.mocked(host.openFilePreview).mock.calls[0][0];

    const prevProps = { channel: new Channel("g-a", 2) };
    const prevState = { ...page.state };
    page.props = { ...page.props, channel: new Channel("g-b", 2) };
    page.componentDidUpdate(prevProps, prevState);
    await flush();

    expect(host.cancelFilePreview).toHaveBeenCalledWith({
      version: 1,
      requestId: request.requestId,
    });

    resolveRequest!({ status: "accepted" });
    await flush();
    expect(page.state.channelSearchPreviewFile).toBeNull();
    expect(page.state.previewFile).toBeNull();
  });
});
