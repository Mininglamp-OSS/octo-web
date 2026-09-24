import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, { Channel, ChannelInfo, Conversation, ConversationExtra } from "wukongimjssdk";
import { ConversationWrap } from "../../../Service/Model";
import ConversationList from "../index";
import ChatPage from "../../../Pages/Chat";
import WKApp from "../../../App";
import { buildTemporaryConversationPresentation } from "../../../features/temporaryConversation/presentation";

vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }));
vi.mock("../../WKAvatar", () => ({ default: () => null }));

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;

beforeEach(() => {
  frames.clear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}

function conversation(id: string, pinned = false) {
  const channel = new Channel(id, 1);
  const info = new ChannelInfo();
  info.channel = channel;
  info.title = id;
  info.orgData = { displayName: id };
  info.top = pinned;
  WKSDK.shared().channelManager.setChannleInfoForCache(info);
  const raw = new Conversation();
  raw.channel = channel;
  raw.timestamp = 1;
  raw.remoteExtra = new ConversationExtra();
  return new ConversationWrap(raw);
}

function geometry(container: HTMLElement, targetId: string) {
  const root = container.querySelector<HTMLDivElement>(".wk-conversationlist")!;
  const row = container.querySelector<HTMLDivElement>(`[data-object-id="${targetId}"]`)!;
  root.scrollTop = 600;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 300, 400));
  // Two pinned rows occupy 120px before the temporary row, regardless of the current scroll.
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 220 - root.scrollTop, 300, 60));
  const scrollTo = vi.fn();
  root.scrollTo = scrollTo;
  return { root, scrollTo };
}

describe("temporary conversation scroll positioning", () => {
  it("restores incoming unread metadata after leaving a virtual row and releases it on refresh", () => {
    const sdk = WKSDK.shared();
    const previousConversations = sdk.conversationManager.conversations;
    const target = conversation("incoming-target");
    const other = conversation("incoming-other");
    sdk.conversationManager.conversations = [other.conversation];
    const page = new ChatPage({});
    vi.spyOn(page, "setState").mockImplementation((next) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next;
      page.state = { ...page.state, ...update };
    });
    page.componentDidMount();
    let conversations = [other];
    const list = () => {
      const presentation = buildTemporaryConversationPresentation(
        page.state.temporaryConversation,
        channel => conversations.find(item => item.channel.isEqual(channel)),
      );
      return <ConversationList conversations={conversations}
        temporarilyPinnedConversations={presentation.conversations}
        temporaryVirtualChannelKeys={presentation.virtualChannelKeys} />;
    };
    try {
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel: target.channel, fromSearch: true });
      WKApp.mittBus.emit("wk:sidebar-conversation-opened", other.channel);
      expect(page.state.temporaryConversation.active?.origin).toBe("virtual");
      const { container, rerender } = render(list());
      expect(container.querySelector('[data-object-id="incoming-target"] .wk-conversationlist-item-time')).toBeNull();

      // An incoming message publishes a real row before the refresh notification.
      target.conversation.unread = 4;
      target.conversation.remoteExtra.draft = "saved draft";
      conversations = [target, other];
      sdk.conversationManager.conversations = conversations.map(item => item.conversation);
      rerender(list());
      const row = container.querySelector('[data-object-id="incoming-target"]')!;
      expect(row.querySelector(".wk-conv-unread-num")?.textContent).toBe("4");
      expect(row.querySelector(".wk-conversationlist-item-time")).not.toBeNull();
      expect(row.querySelector(".wk-conversationlist-item-right-second-line")).not.toBeNull();
      expect(row.textContent).toContain("saved draft");
      expect(container.querySelectorAll('[data-object-id="incoming-target"]')).toHaveLength(1);

      WKApp.mittBus.emit("conversation-list-refreshed");
      expect(page.state.temporaryConversation).toEqual({});
      rerender(list());
      expect(container.querySelector('[data-object-id="incoming-target"] .wk-conv-unread-num')?.textContent).toBe("4");
    } finally {
      page.componentWillUnmount();
      sdk.conversationManager.conversations = previousConversations;
    }
  });

  it("scrolls repeated searches to an already pinned row without reordering it", () => {
    const target = conversation("pinned-search-target", true);
    const conversations = [conversation("pinned-search-a", true), target, conversation("pinned-search-c", true)];
    const onTemporaryConversationScrolled = vi.fn();
    const props = { conversations, temporarilyPinnedConversations: [target], onTemporaryConversationScrolled };
    const { container, rerender } = render(<ConversationList {...props} scrollToTemporaryConversation={{ token: 1, channel: target.channel }} />);
    const { scrollTo } = geometry(container, "pinned-search-target");
    flushFrames();
    expect(Array.from(container.querySelectorAll("[data-object-id]")).map(row => row.getAttribute("data-object-id")))
      .toEqual(["pinned-search-a", "pinned-search-target", "pinned-search-c"]);
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(onTemporaryConversationScrolled).toHaveBeenLastCalledWith(1);

    rerender(<ConversationList {...props} scrollToTemporaryConversation={{ token: 2, channel: target.channel }} />);
    flushFrames();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(onTemporaryConversationScrolled).toHaveBeenLastCalledWith(2);
  });

  it("finishes a pending search jump after a refresh restores the target's normal row", () => {
    const sdk = WKSDK.shared();
    const previousConversations = sdk.conversationManager.conversations;
    const target = conversation("refresh-search-target");
    sdk.conversationManager.conversations = [target.conversation];
    const page = new ChatPage({});
    vi.spyOn(page, "setState").mockImplementation((next) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next;
      page.state = { ...page.state, ...update };
    });
    page.componentDidMount();
    const list = () => (
      <ConversationList
        conversations={[target]}
        temporarilyPinnedConversations={buildTemporaryConversationPresentation(
          page.state.temporaryConversation, () => target,
        ).conversations}
        scrollToTemporaryConversation={page.state.temporaryConversationScrollRequest}
        onTemporaryConversationScrolled={page._handleTemporaryConversationScrolled}
      />
    );
    try {
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel: target.channel, fromSearch: true });
      expect(page.state.temporaryConversation.active?.origin).toBe("existing");
      const { container, rerender } = render(list());
      // A store sync publishes its snapshot and the refresh event before the next frame.
      WKApp.mittBus.emit("conversation-list-refreshed");
      expect(page.state.temporaryConversation).toEqual({});
      rerender(list());
      const { scrollTo } = geometry(container, "refresh-search-target");
      flushFrames();
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 120, behavior: "auto" });
      expect(page.state.temporaryConversationScrollRequest).toBeUndefined();
      rerender(list());
      flushFrames();
      expect(scrollTo).toHaveBeenCalledOnce();
    } finally {
      page.componentWillUnmount();
      sdk.conversationManager.conversations = previousConversations;
    }
  });

  it("aligns the temporary row after pinned rows on mount and repeated search jumps", () => {
    const target = conversation("search-target");
    const conversations = [conversation("pin-a", true), conversation("pin-b", true), target];
    const onTemporaryConversationScrolled = vi.fn();
    const props = { conversations, temporarilyPinnedConversations: [target], onTemporaryConversationScrolled };
    const { container, rerender } = render(<ConversationList {...props} scrollToTemporaryConversation={{ token: 1, channel: target.channel }} />);
    const { root, scrollTo } = geometry(container, "search-target");
    expect(scrollTo).not.toHaveBeenCalled();
    flushFrames();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 120, behavior: "auto" });
    expect(onTemporaryConversationScrolled).toHaveBeenLastCalledWith(1);

    root.scrollTop = 900;
    rerender(<ConversationList {...props} temporarilyPinnedConversations={[target]} scrollToTemporaryConversation={{ token: 1, channel: target.channel }} />);
    flushFrames();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    rerender(<ConversationList {...props} scrollToTemporaryConversation={{ token: 2, channel: target.channel }} />);
    flushFrames();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(onTemporaryConversationScrolled).toHaveBeenLastCalledWith(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 120, behavior: "auto" });
  });

  it("cancels a queued search jump when another entry opens a temporary conversation", () => {
    const target = conversation("cancelled-search");
    const next = conversation("contact-after-search");
    const onTemporaryConversationScrolled = vi.fn();
    const { container, rerender } = render(
      <ConversationList conversations={[]} temporarilyPinnedConversations={[target]}
        scrollToTemporaryConversation={{ token: 1, channel: target.channel }} onTemporaryConversationScrolled={onTemporaryConversationScrolled} />
    );
    rerender(<ConversationList conversations={[]} temporarilyPinnedConversations={[next]}
      onTemporaryConversationScrolled={onTemporaryConversationScrolled} />);
    const { scrollTo } = geometry(container, "contact-after-search");
    flushFrames();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(onTemporaryConversationScrolled).not.toHaveBeenCalled();
  });

  it.each([false, true])("waits for a delayed temporary=%s row and falls back to scrollTop", (temporary) => {
    const target = conversation("loaded-target");
    const { container, rerender } = render(<ConversationList conversations={[]} scrollToTemporaryConversation={{ token: 1, channel: target.channel }} />);
    flushFrames();
    rerender(<ConversationList conversations={temporary ? [] : [target]} temporarilyPinnedConversations={temporary ? [target] : []} scrollToTemporaryConversation={{ token: 1, channel: target.channel }} />);
    const { root } = geometry(container, "loaded-target");
    Object.defineProperty(root, "scrollTo", { configurable: true, value: undefined });
    flushFrames();
    expect(root.scrollTop).toBe(120);
  });

  it("does not reposition an ordinary render and cancels pending work on unmount", () => {
    const target = conversation("sidebar-target");
    const props = { conversations: [], temporarilyPinnedConversations: [target] };
    const { container, rerender, unmount } = render(<ConversationList {...props} />);
    const { scrollTo } = geometry(container, "sidebar-target");
    flushFrames();
    expect(scrollTo).not.toHaveBeenCalled();
    rerender(<ConversationList {...props} scrollToTemporaryConversation={{ token: 1, channel: target.channel }} />);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    flushFrames();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("preserves smooth unread navigation after a temporary jump", () => {
    const target = conversation("unread-target");
    const props = {
      conversations: [target], temporarilyPinnedConversations: [target],
      scrollToTemporaryConversation: { token: 1, channel: target.channel }, shouldScrollToUnreadTarget: () => true,
    };
    const { container, rerender } = render(<ConversationList {...props} scrollToUnreadToken={0} />);
    const { scrollTo } = geometry(container, "unread-target");
    flushFrames();
    rerender(<ConversationList {...props} scrollToUnreadToken={1} />);
    flushFrames();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 120, behavior: "smooth" });
  });
});
