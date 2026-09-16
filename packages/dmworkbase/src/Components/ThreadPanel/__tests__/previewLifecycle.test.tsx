// @vitest-environment jsdom
import React, { useEffect, useRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import type { Thread } from "../../../Service/Thread";
import type { FilePreviewInfo } from "../../FilePreviewPanel/types";

// ── Hoisted mocks ──
const hoisted = vi.hoisted(() => ({
  threadList: vi.fn(),
  threadGet: vi.fn(),
  getSubscribes: vi.fn(),
  channelFiles: vi.fn(),
  emit: vi.fn(),
  mountCount: 0,
  unmountCount: 0,
  getRenderer: vi.fn(),
  renderFilePreviewHeader: vi.fn(),
  renderFileListPanel: vi.fn(),
}));

vi.mock("../../../App", () => ({
  __esModule: true,
  default: {
    dataSource: {
      channelDataSource: {
        threadList: hoisted.threadList,
        threadGet: hoisted.threadGet,
        channelFiles: hoisted.channelFiles,
        subscriber: vi.fn(() => Promise.resolve(undefined)),
      },
    },
    loginInfo: { uid: "owner-uid" },
    remoteConfig: {
      messagesSearchOn: false,
      addConfigChangeListener: vi.fn(() => vi.fn()),
    },
    shared: { deviceId: "dev-1", currentSpaceId: "space-1" },
    mittBus: { emit: hoisted.emit },
    endpoints: { showConversation: vi.fn() },
  },
}));

// Conversation mock that tracks lifecycle and preserves an uncontrolled input.
vi.mock("../../Conversation", () => ({
  Conversation: function ConversationMock(props: {
    channel: { channelID: string; channelType: number };
  }) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
      hoisted.mountCount += 1;
      return () => {
        hoisted.unmountCount += 1;
      };
    }, []);
    return React.createElement(
      "div",
      { "data-testid": "thread-conversation", "data-channel": props.channel?.channelID },
      React.createElement("input", { ref: inputRef, "data-testid": "thread-input", defaultValue: "draft" })
    );
  },
}));
vi.mock("../../FilePreviewPanel/FileListPanel", () => ({
  FileListPanel: (props: unknown) => {
    hoisted.renderFileListPanel(props);
    return null;
  },
}));
vi.mock("../../FilePreviewPanel/FilePreviewHeader", () => ({
  __esModule: true,
  default: (props: unknown) => {
    hoisted.renderFilePreviewHeader(props);
    return null;
  },
}));
vi.mock("../../FilePreviewPanel/registry", () => ({
  fileRendererRegistry: { getRenderer: hoisted.getRenderer },
}));
vi.mock("../../FilePreviewPanel/renderers/MarkdownRenderer", () => ({ MarkdownRenderer: () => null }));
vi.mock("../../FilePreviewPanel/renderers/HtmlRenderer", () => ({ HtmlRenderer: () => null }));
vi.mock("../../FilePreviewPanel/renderers/ImageRenderer", () => ({ ImageRenderer: () => null }));
vi.mock("../../../features/filePreview/HostFilePreviewSlot", () => ({
  HostFilePreviewSlot: (props: { requestId: string; onClose: () => void }) =>
    React.createElement("div", {
      "data-testid": "host-preview-slot",
      "data-request-id": props.requestId,
      role: "button",
      onClick: props.onClose,
    }),
}));
vi.mock("../../../Service/SidebarService", () => ({ __esModule: true, default: { sync: vi.fn().mockResolvedValue(null) } }));
vi.mock("../../../Service/FollowService", () => ({ __esModule: true, default: {} }));
vi.mock("../../../Service/CategoryService", () => ({ __esModule: true, default: {} }));
vi.mock("../../../bridge/thread/createThread", () => ({
  createThreadByNameAndNotify: vi.fn(),
}));
vi.mock("../../../ui/ThreadCreateDialog", () => ({ __esModule: true, default: () => null }));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), close: vi.fn() },
  Spin: () => React.createElement("div", { "data-testid": "spin" }),
  Popover: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children, content),
}));
vi.mock("react-virtuoso", () => ({ Virtuoso: () => null, TableVirtuoso: () => null }));
vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string;
    channelType: number;
    constructor(id: string, type: number) {
      this.channelID = id;
      this.channelType = type;
    }
    getChannelKey() { return this.channelID + ":" + this.channelType; }
    isEqual(o: Channel) { return this.channelID === o?.channelID && this.channelType === o?.channelType; }
  }
  const sdk = {
    shared: () => ({
      channelManager: {
        getSubscribes: hoisted.getSubscribes,
        getChannelInfo: vi.fn(),
        addSubscriberChangeListener: vi.fn(),
        removeSubscriberChangeListener: vi.fn(),
        subscribeCacheMap: new Map(),
        notifySubscribeChangeListeners: vi.fn(),
        setChannleInfoForCache: vi.fn(),
        notifyListeners: vi.fn(),
      },
    }),
  };
  return {
    default: sdk,
    Channel,
    ChannelTypePerson: 1,
    ChannelTypeGroup: 2,
    ChannelTypeCommunityTopic: 5,
    WKSDK: sdk,
    ThreadStatus: { Active: 1, Archived: 2 },
    MessageContent: class {},
    MediaMessageContent: class {},
  };
});

import ThreadPanel from "../index";
import type { ThreadPanelProps } from "../index";

const THREAD: Thread = {
  short_id: "t1",
  group_no: "g1",
  channel_id: "g1____t1",
  channel_type: 5,
  name: "Test Thread",
  creator_uid: "owner-uid",
  status: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  member_count: 2,
  message_count: 3,
  is_member: true,
};

const PREVIEW: FilePreviewInfo = {
  url: "https://cdn/doc.pdf",
  name: "doc.pdf",
  extension: "pdf",
  sourceChannelId: "g1",
  sourceChannelType: 2,
  messageId: "m1",
  size: 123,
};

const HOST_PREVIEW: FilePreviewInfo = {
  ...PREVIEW,
  hostPreview: { requestId: "host-req-1" },
};

function buildProps(extra: Partial<ThreadPanelProps> = {}): ThreadPanelProps {
  return {
    groupNo: "g1",
    thread: THREAD,
    onClose: vi.fn(),
    onThreadSelect: vi.fn(),
    ...extra,
  } as ThreadPanelProps;
}

beforeEach(() => {
  Object.values(hoisted).forEach((fn) => {
    if (typeof fn === "function") fn.mockReset?.();
  });
  hoisted.mountCount = 0;
  hoisted.unmountCount = 0;
  hoisted.threadList.mockResolvedValue([THREAD]);
  hoisted.threadGet.mockResolvedValue(THREAD);
  hoisted.channelFiles.mockResolvedValue({ files: [], page: 1, has_more: false });
  hoisted.getSubscribes.mockReturnValue([]);
  hoisted.getRenderer.mockReturnValue({ renderer: () => null });
});

describe("ThreadPanel preview lifecycle", () => {
  it("keeps the same Conversation DOM node and draft across preview, split, overlay, and close", async () => {
    const { rerender, container } = render(
      React.createElement(ThreadPanel, buildProps({ layout: "overlay" }))
    );

    // Wait until the thread is loaded and its ConversationSurface is stable:
    // the initial initVM/threadGet bootstrap may briefly load then mount the
    // session. Record everyone's baseline only after it settles.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="thread-conversation"]')).toBeTruthy()
    );
    await waitFor(() =>
      expect(hoisted.mountCount).toBeGreaterThan(0)
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="thread-input"]')).toBeTruthy()
    );

    const baselineUnmounts = hoisted.unmountCount;

    const conversationEl = container.querySelector('[data-testid="thread-conversation"]')!;
    const inputEl = container.querySelector<HTMLInputElement>('[data-testid="thread-input"]')!;
    inputEl.value = "draft typed by user";

    // ── 1. Overlay + preview ──
    rerender(
      React.createElement(ThreadPanel, buildProps({ layout: "overlay", filePreview: PREVIEW }))
    );
    expect(container.querySelector('[data-testid="thread-conversation"]')).toBe(conversationEl);
    expect(container.querySelector<HTMLInputElement>('[data-testid="thread-input"]')?.value).toBe("draft typed by user");
    expect(hoisted.unmountCount).toBe(baselineUnmounts);

    // ── 2. Split mode (previewInThreadContext + layout=split) ──
    rerender(
      React.createElement(
        ThreadPanel,
        buildProps({ layout: "split", previewInThreadContext: true, filePreview: PREVIEW })
      )
    );
    expect(container.querySelector('[data-testid="thread-conversation"]')).toBe(conversationEl);
    expect(container.querySelector<HTMLInputElement>('[data-testid="thread-input"]')?.value).toBe("draft typed by user");
    expect(hoisted.unmountCount).toBe(baselineUnmounts);

    // ── 3. Back to overlay preview ──
    rerender(
      React.createElement(ThreadPanel, buildProps({ layout: "overlay", filePreview: PREVIEW }))
    );
    expect(container.querySelector('[data-testid="thread-conversation"]')).toBe(conversationEl);
    expect(container.querySelector<HTMLInputElement>('[data-testid="thread-input"]')?.value).toBe("draft typed by user");
    expect(hoisted.unmountCount).toBe(baselineUnmounts);

    // ── 4. Close preview (back to thread only) ──
    rerender(React.createElement(ThreadPanel, buildProps({ layout: "overlay" })));
    expect(container.querySelector('[data-testid="thread-conversation"]')).toBe(conversationEl);
    expect(container.querySelector<HTMLInputElement>('[data-testid="thread-input"]')?.value).toBe("draft typed by user");
    expect(hoisted.unmountCount).toBe(baselineUnmounts);

    // Exactly one stable Conversation in the tree throughout
    expect(container.querySelectorAll('[data-testid="thread-conversation"]')).toHaveLength(1);
  });

  it("renders HostFilePreviewSlot and does not mount Web header, file list, or renderer for hostPreview", async () => {
    const { container } = render(
      React.createElement(
        ThreadPanel,
        buildProps({ layout: "overlay", onFilePreviewClose: vi.fn(), filePreview: HOST_PREVIEW })
      )
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="host-preview-slot"]')).toBeTruthy()
    );

    const slot = container.querySelector('[data-testid="host-preview-slot"]');
    expect(slot?.getAttribute("data-request-id")).toBe("host-req-1");

    expect(hoisted.renderFilePreviewHeader).not.toHaveBeenCalled();
    expect(hoisted.renderFileListPanel).not.toHaveBeenCalled();
    expect(hoisted.getRenderer).not.toHaveBeenCalled();
  });

  it("routes the detail back arrow through onBackFromThread inside act", async () => {
    const onBackFromThread = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      React.createElement(ThreadPanel, buildProps({ onClose, onBackFromThread }))
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="thread-conversation"]')).toBeTruthy()
    );

    const backBtn = container.querySelector<HTMLElement>(".wk-thread-panel-header-btn");
    expect(backBtn).toBeTruthy();
    fireEvent.click(backBtn!);
    expect(onBackFromThread).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("marks the context side inert and does not unmount it in overlay preview mode", async () => {
    const { container, rerender } = render(
      React.createElement(ThreadPanel, buildProps({ layout: "overlay" }))
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="thread-conversation"]')).toBeTruthy()
    );

    const conversationElBefore = container.querySelector('[data-testid="thread-conversation"]');

    rerender(
      React.createElement(ThreadPanel, buildProps({ layout: "overlay", filePreview: PREVIEW }))
    );

    const contextEl = container.querySelector<HTMLElement>(".wk-thread-panel-context");
    expect(contextEl).toBeTruthy();
    expect(contextEl?.hasAttribute("inert")).toBe(true);
    expect(contextEl?.getAttribute("aria-hidden")).toBe("true");
    expect(contextEl?.classList.contains("wk-thread-panel-context--hidden")).toBe(true);
    expect(contextEl?.classList.contains("wk-thread-panel-context--inert")).toBe(true);

    // Conversation still present inside the context
    expect(container.querySelector('[data-testid="thread-conversation"]')).toBe(conversationElBefore);
  });

  it("applies the split layout class when previewInThreadContext and layout=split", async () => {
    const { container, rerender } = render(
      React.createElement(ThreadPanel, buildProps({ layout: "overlay", filePreview: PREVIEW }))
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="thread-conversation"]')).toBeTruthy()
    );

    rerender(
      React.createElement(
        ThreadPanel,
        buildProps({ layout: "split", previewInThreadContext: true, filePreview: PREVIEW })
      )
    );

    expect(container.querySelector(".wk-thread-panel-split-layout--split")).toBeTruthy();
    // Conversation still present (not unmounted during the layout switch)
    expect(container.querySelector('[data-testid="thread-conversation"]')).toBeTruthy();
  });

  it("hides the splitter for compact, previewInThreadContext, and overlay", () => {
    const compactView = render(
      React.createElement(ThreadPanel, buildProps({ compact: true }))
    );
    expect(compactView.container.querySelector(".wk-thread-panel-splitter")).toBeFalsy();
    compactView.unmount();

    const pipView = render(
      React.createElement(ThreadPanel, buildProps({ previewInThreadContext: true }))
    );
    expect(pipView.container.querySelector(".wk-thread-panel-splitter")).toBeFalsy();
    pipView.unmount();

    const overlayView = render(
      React.createElement(ThreadPanel, buildProps({ layout: "overlay" }))
    );
    expect(overlayView.container.querySelector(".wk-thread-panel-splitter")).toBeFalsy();
  });
});
