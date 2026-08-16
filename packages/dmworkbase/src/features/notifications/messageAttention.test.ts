import { afterEach, describe, expect, it } from "vitest";
import {
  isConversationChannelVisible,
  isConversationViewportVisible,
  isElementVisibleInViewport,
  isMessageElementVisible,
  isOwnedConversationSingleton,
  isRectangleVisibleWithin,
  isSameMessageAttentionSession,
  shouldMarkConversationRead,
  shouldSuppressImmediateAlert,
} from "./messageAttention";

function setRect(
  element: HTMLElement,
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">
) {
  element.getBoundingClientRect = () =>
    ({ ...rect, x: rect.left, y: rect.top, toJSON: () => ({}) } as DOMRect);
}

function createConversationViewport(
  id: string,
  channelId: string,
  channelType: number,
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">
) {
  const viewport = document.createElement("div");
  viewport.id = id;
  viewport.dataset.conversationChannelId = channelId;
  viewport.dataset.conversationChannelType = String(channelType);
  setRect(viewport, rect);
  document.body.appendChild(viewport);
  return viewport;
}

describe("message attention", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const visibleCurrentMessage = {
    chatModuleActive: true,
    documentVisible: true,
    windowFocused: true,
    currentConversation: true,
    newMessageVisible: true,
  };

  it("suppresses an alert only when the new message is actually visible", () => {
    expect(shouldSuppressImmediateAlert(visibleCurrentMessage)).toBe(true);
    expect(
      shouldSuppressImmediateAlert({
        ...visibleCurrentMessage,
        newMessageVisible: false,
      })
    ).toBe(false);
  });

  it("does not treat an open background tab as read", () => {
    expect(
      shouldMarkConversationRead({
        ...visibleCurrentMessage,
        documentVisible: false,
      })
    ).toBe(false);
    expect(
      shouldMarkConversationRead({
        ...visibleCurrentMessage,
        windowFocused: false,
      })
    ).toBe(false);
  });

  it("binds delayed attention work to the account, Space, and login session at arrival", () => {
    const arrival = {
      accountId: "u1",
      spaceId: "space-1",
      loginToken: "token-1",
    };
    expect(isSameMessageAttentionSession(arrival, { ...arrival })).toBe(true);
    expect(
      isSameMessageAttentionSession(arrival, {
        ...arrival,
        accountId: "u2",
      })
    ).toBe(false);
    expect(
      isSameMessageAttentionSession(arrival, {
        ...arrival,
        spaceId: "space-2",
      })
    ).toBe(false);
    expect(
      isSameMessageAttentionSession(arrival, {
        ...arrival,
        loginToken: "token-2",
      })
    ).toBe(false);
  });

  it("checks the actual element rectangle against the viewport", () => {
    expect(
      isElementVisibleInViewport(
        { top: 20, bottom: 60, left: 10, right: 100, width: 90, height: 40 },
        { width: 1440, height: 900 }
      )
    ).toBe(true);
    expect(
      isElementVisibleInViewport(
        { top: 920, bottom: 960, left: 10, right: 100, width: 90, height: 40 },
        { width: 1440, height: 900 }
      )
    ).toBe(false);
  });

  it("does not count a message clipped outside its conversation viewport", () => {
    expect(
      isRectangleVisibleWithin(
        {
          top: 620,
          bottom: 680,
          left: 100,
          right: 500,
          width: 400,
          height: 60,
        },
        { top: 100, bottom: 600, left: 80, right: 700, width: 620, height: 500 }
      )
    ).toBe(false);
    expect(
      isRectangleVisibleWithin(
        {
          top: 560,
          bottom: 620,
          left: 100,
          right: 500,
          width: 400,
          height: 60,
        },
        { top: 100, bottom: 600, left: 80, right: 700, width: 620, height: 500 }
      )
    ).toBe(true);
  });

  it("keeps ownership when a newer instance holds an equal-looking value", () => {
    const owned = { channelId: "group-1", channelType: 2 };
    const replacement = { channelId: "group-1", channelType: 2 };

    expect(isOwnedConversationSingleton(owned, owned)).toBe(true);
    expect(isOwnedConversationSingleton(replacement, owned)).toBe(false);
    expect(isOwnedConversationSingleton(undefined, owned)).toBe(false);
  });

  it("checks each visible conversation viewport independently", () => {
    const primary = createConversationViewport(
      "viewport-primary",
      "group-1",
      2,
      {
        top: 0,
        bottom: 700,
        left: 0,
        right: 900,
        width: 900,
        height: 700,
      }
    );
    const thread = createConversationViewport(
      "viewport-thread",
      "thread-1",
      6,
      {
        top: 0,
        bottom: 700,
        left: 900,
        right: 1200,
        width: 300,
        height: 700,
      }
    );

    expect(isConversationViewportVisible(primary)).toBe(true);
    expect(isConversationViewportVisible(thread)).toBe(true);
    expect(
      isConversationChannelVisible({ channelId: "group-1", channelType: 2 })
    ).toBe(true);
    expect(
      isConversationChannelVisible({ channelId: "thread-1", channelType: 6 })
    ).toBe(true);

    primary.style.display = "none";
    expect(isConversationViewportVisible(primary)).toBe(false);
    expect(isConversationViewportVisible(thread)).toBe(true);
  });

  it("scopes equal message sequences to their channel and viewport", () => {
    const primary = createConversationViewport(
      "viewport-primary",
      "group-1",
      2,
      {
        top: 0,
        bottom: 700,
        left: 0,
        right: 900,
        width: 900,
        height: 700,
      }
    );
    const thread = createConversationViewport(
      "viewport-thread",
      "thread-1",
      6,
      {
        top: 0,
        bottom: 700,
        left: 900,
        right: 1200,
        width: 300,
        height: 700,
      }
    );
    const primaryMessage = document.createElement("div");
    primaryMessage.dataset.messageSeq = "42";
    setRect(primaryMessage, {
      top: 100,
      bottom: 160,
      left: 20,
      right: 500,
      width: 480,
      height: 60,
    });
    primary.appendChild(primaryMessage);
    const clippedThreadMessage = document.createElement("div");
    clippedThreadMessage.dataset.messageSeq = "42";
    setRect(clippedThreadMessage, {
      top: 720,
      bottom: 780,
      left: 920,
      right: 1180,
      width: 260,
      height: 60,
    });
    thread.appendChild(clippedThreadMessage);

    expect(
      isMessageElementVisible(42, document, {
        channelId: "group-1",
        channelType: 2,
        viewport: primary,
      })
    ).toBe(true);
    expect(
      isMessageElementVisible(42, document, {
        channelId: "thread-1",
        channelType: 6,
        viewport: thread,
      })
    ).toBe(false);
    expect(
      isMessageElementVisible(42, document, {
        channelId: "missing-channel",
        channelType: 2,
      })
    ).toBe(false);
  });
});
