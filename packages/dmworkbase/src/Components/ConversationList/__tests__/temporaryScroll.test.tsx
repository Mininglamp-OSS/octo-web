import React from "react";
import userEvent from "@testing-library/user-event";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKSDK, { Channel, ChannelInfo, Conversation, ConversationExtra, Message, MessageText, Mention } from "wukongimjssdk";
import { ConversationWrap } from "../../../Service/Model";
import ConversationList from "../index";
import ChatPage from "../../../Pages/Chat";
import WKApp from "../../../App";
import { unreadContribution } from "../../../Pages/Chat/sidebarUnreadBadge";
import { isMutedForRecentConversation } from "../../ChatConversationList";
import { t } from "../../../i18n";
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
  raw.unread = 0;
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
  it("keeps incoming unread and mentions visible on an existing temporary row and highlights its badge on navigation", () => {
    const sdk = WKSDK.shared();
    const previousConversations = sdk.conversationManager.conversations;
    const previousUid = WKApp.loginInfo.uid;
    const previousSdkUid = sdk.config.uid;
    WKApp.loginInfo.uid = sdk.config.uid = "temporary-unread-self";
    const target = conversation("existing-incoming-target");
    const other = conversation("existing-incoming-other");
    const conversations = [other, target];
    sdk.conversationManager.conversations = conversations.map(item => item.conversation);
    const page = new ChatPage({});
    vi.spyOn(page, "setState").mockImplementation((next) => {
      const update = typeof next === "function" ? next(page.state, page.props) : next;
      page.state = { ...page.state, ...update };
    });
    page.componentDidMount();
    const list = () => {
      const presentation = buildTemporaryConversationPresentation(
        page.state.temporaryConversation,
        channel => conversations.find(item => item.channel.isEqual(channel)),
      );
      return <ConversationList conversations={conversations} select={other.channel}
        temporarilyPinnedConversations={presentation.conversations}
        temporaryVirtualChannelKeys={presentation.virtualChannelKeys}
        scrollToTemporaryConversation={page.state.temporaryConversationScrollRequest}
        scrollToUnreadToken={page.state.recentUnreadJumpToken}
        shouldScrollToUnreadTarget={item => item.unread > 0 && !isMutedForRecentConversation(item)} />;
    };
    try {
      WKApp.mittBus.emit("wk:temporarily-pin-conversation", { channel: target.channel, fromSearch: true });
      WKApp.mittBus.emit("wk:sidebar-conversation-opened", other.channel);
      const placement = page.state.temporaryConversation;
      expect(placement.active?.origin).toBe("existing");
      const { container, rerender } = render(list());

      const incoming = new Message();
      incoming.channel = target.channel;
      incoming.fromUID = "temporary-unread-peer";
      incoming.messageSeq = 10;
      incoming.timestamp = 123;
      incoming.content = new MessageText("incoming mention preview");
      incoming.content.mention = new Mention();
      incoming.content.mention.uids = [WKApp.loginInfo.uid];
      sdk.chatManager.notifyMessageListeners(incoming);
      // Publish the realtime snapshot without a full conversation-list refresh.
      target.conversation.lastMessage = incoming;
      target.conversation.unread = 2;
      target.conversation.timestamp = incoming.timestamp;
      expect(page.state.temporaryConversation).toBe(placement);
      rerender(list());

      const countedUnread = conversations.reduce((sum, item) => sum + unreadContribution({
        unread: item.unread,
        muteAuthorityReady: !!item.channelInfo,
        muted: isMutedForRecentConversation(item),
      }), 0);
      expect(countedUnread).toBe(2);
      expect(target.isMentionMe).toBe(true);
      const row = container.querySelector('[data-object-id="existing-incoming-target"]')!;
      expect(row.querySelector(".wk-conv-unread-num")?.textContent).toBe(String(countedUnread));
      expect(row.querySelector(".wk-mention")?.textContent).toBe(t("base.conversationList.mentionMarker"));
      expect(row.querySelector(".wk-conversationlist-item-time")).not.toBeNull();
      expect(row.querySelector(".wk-conversationlist-item-lastmsg")?.textContent).toContain("incoming mention preview");
      expect(container.querySelectorAll('[data-object-id="existing-incoming-target"]')).toHaveLength(1);

      const { scrollTo } = geometry(container, "existing-incoming-target");
      page._handleRecentUnreadNavigate();
      rerender(list());
      flushFrames();
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 120, behavior: "smooth" });
      expect(row.querySelector(".wk-conv-unread-num--nudge-b")?.textContent).toBe("2");
    } finally {
      page.componentWillUnmount();
      sdk.conversationManager.conversations = previousConversations;
      WKApp.loginInfo.uid = previousUid;
      sdk.config.uid = previousSdkUid;
    }
  });

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

describe("recent unread jump sequence", () => {
  function setup() {
    const conversations = ["a", "b", "c", "d"].map((id) => {
      const item = conversation(`sequence-${id}`);
      item.conversation.unread = 1;
      return item;
    });
    const props = {
      conversations,
      shouldScrollToUnreadTarget: (item: ConversationWrap) => item.unread > 0,
    };
    let token = 0;
    const view = render(
      <ConversationList {...props} scrollToUnreadToken={token} />
    );
    const root = view.container.querySelector<HTMLDivElement>(
      ".wk-conversationlist"
    )!;
    Object.defineProperty(root, "clientHeight", {
      configurable: true,
      value: 100,
    });
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 10, 300, 100)
    );
    const rows = conversations.map(
      (item) =>
        view.container.querySelector<HTMLDivElement>(
          `[data-object-id="${item.channel.channelID}"]`
        )!
    );
    rows.forEach((row, index) => {
      vi.spyOn(row, "getBoundingClientRect").mockImplementation(
        () => new DOMRect(0, 10 + index * 60 - root.scrollTop, 300, 60)
      );
    });
    // Content height is 240; the last row cannot reach the viewport top.
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      root.scrollTop = Math.min(top ?? 0, 140);
      fireEvent.scroll(root);
    });
    root.scrollTo = scrollTo;
    const jump = () => {
      view.rerender(
        <ConversationList {...props} scrollToUnreadToken={++token} />
      );
      flushFrames();
    };
    const expectTarget = (index: number) => {
      rows.forEach((row, rowIndex) => {
        expect(
          !!row.querySelector(
            ".wk-conv-unread-num--nudge-a, .wk-conv-unread-num--nudge-b"
          )
        ).toBe(rowIndex === index);
      });
    };
    return { ...view, props, root, rows, jump, expectTarget, scrollTo };
  }

  it("cycles independently of automatic scroll events and nudges targets that cannot reach the top", () => {
    const { jump, expectTarget, root, scrollTo } = setup();
    [0, 1, 2, 3, 0, 1].forEach((index) => {
      jump();
      expectTarget(index);
      expect(scrollTo).toHaveBeenLastCalledWith({
        top: index * 60,
        behavior: "smooth",
      });
      expect(root.scrollTop).toBe(Math.min(index * 60, 140));
      fireEvent.scroll(root);
    });
  });

  it.each(["wheel", "touch", "keyboard", "scrollbar"])(
    "starts below the visible area after a %s scroll, then resumes the selected sequence",
    (gesture) => {
      const { root, jump, expectTarget } = setup();
      jump();
      expectTarget(0);
      if (gesture === "wheel") fireEvent.wheel(root, { deltaY: 30 });
      if (gesture === "touch") fireEvent.touchMove(root);
      if (gesture === "keyboard") fireEvent.keyDown(root, { key: "ArrowDown" });
      if (gesture === "scrollbar") fireEvent.pointerDown(root);
      root.scrollTop = 20; // b is visible, c starts exactly at the viewport bottom.
      fireEvent.scroll(root);
      jump();
      expectTarget(2);
      jump();
      expectTarget(3);
      jump();
      expectTarget(0);
    }
  );

  it.each(["ArrowDown", "PageDown"])(
    "recognizes %s scrolling after a conversation row is clicked",
    async (key) => {
      const user = userEvent.setup();
      const { root, rows, jump, expectTarget } = setup();
      jump();
      expectTarget(0);
      await user.click(rows[0]);
      expect(document.activeElement).toBe(root);
      await user.keyboard(`{${key}}`);
      // jsdom does not perform native keyboard scrolling; publish its result.
      root.scrollTop = 20;
      fireEvent.scroll(root);
      jump();
      expectTarget(2);
      jump();
      expectTarget(3);
    }
  );

  it("continues the previous sequence when a manual scroll leaves no unread rows below the viewport", () => {
    const { root, jump, expectTarget } = setup();
    jump();
    expectTarget(0);
    fireEvent.wheel(root, { deltaY: 140 });
    root.scrollTop = 140;
    fireEvent.scroll(root);
    jump();
    expectTarget(1);
    jump();
    expectTarget(2);
  });

  it("does not treat a gesture without actual scrolling as a manual scroll", () => {
    const { root, jump, expectTarget } = setup();
    jump();
    fireEvent.wheel(root, { deltaY: -10 });
    jump();
    expectTarget(1);
  });

  it("resumes from the first remaining candidate if the previous target is no longer unread", () => {
    // Removes index 0 (the just-visited target) — the correct answer is index 1,
    // which coincidentally matches the (-1+1)%n=0 fallback.  This test pins the
    // "first-element removal" case; the two tests below pin middle/before-cursor
    // removal where the old fallback would have given the wrong answer.
    const { props, jump, expectTarget } = setup();
    jump();
    props.conversations[0].conversation.unread = 0;
    jump();
    expectTarget(1);
  });

  it("advances to the removed target's successor when a middle element leaves the candidate set", () => {
    // Sequence: A B C D all unread.  jump→A, jump→B, mark B read, jump should
    // go to C (B's successor), not back to A (index 0).
    // This is the exact path reported in the review: t1→A t2→B [B read] t3→C.
    const { props, jump, expectTarget } = setup(); // a=0, b=1, c=2, d=3
    jump(); expectTarget(0); // →A
    jump(); expectTarget(1); // →B
    props.conversations[1].conversation.unread = 0; // B leaves the candidate set
    jump(); expectTarget(2); // must be C, not A
  });

  it("continues forward when an element before the cursor leaves the candidate set", () => {
    // Sequence: A B C D.  jump→A, jump→B, mark A read (behind the cursor),
    // jump should continue to C, not wrap around or skip.
    const { props, jump, expectTarget } = setup();
    jump(); expectTarget(0); // →A
    jump(); expectTarget(1); // →B
    props.conversations[0].conversation.unread = 0; // A leaves the candidate set
    jump(); expectTarget(2); // must be C
  });

  it("advances past two simultaneous removals: target and its immediate successor both leave", () => {
    // Reproduces the blocking defect from round 2 of the review.
    // Sequence: A B C D.  jump→A, jump→B, mark B and C read simultaneously,
    // jump should go to D — not reset to A (index 0).
    // Under the old single-successor memo, both B (target) and C (successor)
    // have left by activation time, so successorIndex === -1 and the code
    // fell back to candidates[0] = A, revisiting an already-visited conversation.
    const { props, jump, expectTarget } = setup(); // a=0, b=1, c=2, d=3
    jump(); expectTarget(0); // →A
    jump(); expectTarget(1); // →B
    // B and C both leave the candidate set before the next activation.
    props.conversations[1].conversation.unread = 0; // B (current target) gone
    props.conversations[2].conversation.unread = 0; // C (recorded successor) gone
    jump(); expectTarget(3); // must be D, not A
  });

  it("advances correctly when all successors up to the wrap point leave the candidate set", () => {
    // Sequence: A B C D.  jump→B, mark C and D read, jump should wrap to A
    // (the first survivor after B in cyclic order), not reset to B (index 0).
    // This exercises the wrap-around branch of the forward scan.
    const { props, jump, expectTarget } = setup(); // a=0, b=1, c=2, d=3
    jump(); expectTarget(0); // →A  (positions the cursor on A first)
    jump(); expectTarget(1); // →B
    // C and D leave — all successors after B up to the wrap point are gone.
    props.conversations[2].conversation.unread = 0; // C gone
    props.conversations[3].conversation.unread = 0; // D gone
    jump(); expectTarget(0); // must wrap to A, not stay on B (index 0 in the new 2-item set would be A anyway, but the assertion verifies identity)
  });

  it("does nothing when there are no unread candidates", () => {
    const { props, jump, scrollTo } = setup();
    props.conversations.forEach((item) => {
      item.conversation.unread = 0;
    });
    jump();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
