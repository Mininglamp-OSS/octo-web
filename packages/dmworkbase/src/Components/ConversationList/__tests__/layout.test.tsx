/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let ConversationList: typeof import("../index").default;
let container: HTMLDivElement;
const apiPut = vi.fn();
const toastError = vi.fn();
const notifyConversationListeners = vi.fn();
const topChannelSetting = vi.fn(() => Promise.resolve());

class MockChannel {
  channelID: string;
  channelType: number;

  constructor(channelID: string, channelType: number) {
    this.channelID = channelID;
    this.channelType = channelType;
  }

  getChannelKey() {
    return `${this.channelID}_${this.channelType}`;
  }

  isEqual(other: { channelID: string; channelType: number }) {
    return (
      other?.channelID === this.channelID &&
      other?.channelType === this.channelType
    );
  }
}

beforeAll(async () => {
  vi.doMock("wukongimjssdk", () => {
    const sdk = {
      shared: () => ({
        channelManager: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
          fetchChannelInfo: vi.fn(),
          getChannelInfo: vi.fn(),
        },
        conversationManager: {
          notifyConversationListeners,
        },
      }),
    };

    return {
      default: sdk,
      WKSDK: sdk,
      Channel: MockChannel,
      ChannelTypePerson: 1,
      ChannelTypeGroup: 2,
      ConversationAction: { update: "update" },
      ReminderType: {
        ReminderTypeMentionMe: 1,
      },
    };
  });

  vi.doMock("../../WKAvatar", () => ({
    default: ({ channel }: { channel: { channelID: string } }) => (
      <div className="wk-avatar" data-channel-id={channel.channelID} />
    ),
  }));

  vi.doMock("../../ContextMenus", () => ({
    default: ({ onContext, menus = [] }: any) => {
      onContext({ show: vi.fn(), hide: vi.fn(), isShow: () => false });
      return (
        <ol data-testid="context-menu-model">
          {menus.map((menu: any, index: number) => {
            if (menu.separator) {
              return <li key={index} data-separator="true" />;
            }
            const Icon = menu.icon;
            return (
              <li
                key={index}
                data-menu-title={menu.title}
                onClick={menu.onClick}
              >
                {Icon ? <Icon /> : null}
                {menu.title}
              </li>
            );
          })}
        </ol>
      );
    },
  }));

  vi.doMock("../../AiBadge", () => ({
    default: () => null,
  }));

  vi.doMock("../../Icons/GroupIcon", () => ({
    default: () => <span />,
  }));

  vi.doMock("../../Icons/ThreadIcon", () => ({
    default: () => <span />,
  }));

  vi.doMock("../../../App", () => ({
    default: {
      loginInfo: { uid: "u1" },
      shared: {
        currentSpaceId: "space1",
        getChannelAvatarTag: () => "avatar",
      },
      apiClient: { put: apiPut },
      conversationProvider: { deleteConversation: vi.fn() },
    },
  }));

  vi.doMock("../../../Service/Const", () => ({
    ChannelTypeCommunityTopic: 3,
    EndpointID: {},
  }));

  vi.doMock("../../../Service/Thread", async () => {
    const actual = await vi.importActual<typeof import("../../../Service/Thread")>(
      "../../../Service/Thread"
    );
    return {
      ...actual,
      parseThreadChannelId: () => undefined,
    };
  });

  vi.doMock("../../../Service/TypingManager", () => ({
    TypingManager: {
      shared: {
        addTypingListener: vi.fn(),
        removeTypingListener: vi.fn(),
        getTyping: () => undefined,
      },
    },
  }));

  vi.doMock("../../../Service/ChannelSetting", () => ({
    ChannelSettingManager: {
      shared: {
        top: vi.fn(),
        mute: vi.fn(() => Promise.resolve()),
      },
    },
  }));

  vi.doMock("../../../bridge/channelSetting/channelSettingActions", () => ({
    muteChannelSetting: vi.fn(() => Promise.resolve()),
    topChannelSetting,
  }));

  vi.doMock("../../../Service/Model", () => ({
    MessageWrap: class {},
  }));

  vi.doMock("../../../Messages/Revoke", () => ({
    RevokeCell: { tip: () => "" },
  }));

  vi.doMock("../../../Messages/Flame", () => ({
    FlameMessageCell: { tip: () => "" },
  }));

  vi.doMock("../../../Utils/time", () => ({
    getTimeStringAutoShort2: () => "刚刚",
  }));

  vi.doMock("../../../Utils/draftPreview", () => ({
    formatDraftPreview: (draft: string) => draft,
  }));

  vi.doMock("../../OctoModal", () => ({
    modalConfirm: vi.fn(),
  }));

  vi.doMock("../../Conversation/vm", () => ({
    default: {
      foldSessionPreview: new Map(),
    },
  }));

  vi.doMock("../../../i18n", () => ({
    I18nContext: React.createContext({}),
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
  }));

  vi.doMock("@douyinfe/semi-ui", () => ({
    Tag: ({ children }: { children: React.ReactNode }) => (
      <span>{children}</span>
    ),
    Toast: { error: toastError },
  }));

  vi.doMock("react-spinners", () => ({
    BeatLoader: () => null,
  }));

  ConversationList = (await import("../index")).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

function makeChannel(channelID: string, channelType = 1) {
  return new MockChannel(channelID, channelType);
}

function makeConversation(options: {
  unread: number;
  mention?: boolean;
  mute?: boolean;
}) {
  const channel = makeChannel("alice");
  return {
    channel,
    channelInfo: {
      channel,
      mute: options.mute,
      online: false,
      lastOffline: 0,
      top: false,
      orgData: {
        displayName: "Alice",
      },
    },
    unread: options.unread,
    isMentionMe: !!options.mention,
    simpleReminders: [],
    remoteExtra: {},
    timestamp: 1,
    lastMessage: undefined,
  };
}

function makeCompactConversation(
  channelID: string,
  channelType: number,
  parentGroupNo?: string
) {
  const channel = makeChannel(channelID, channelType);
  return {
    channel,
    channelInfo: {
      channel,
      mute: false,
      top: false,
      orgData: {
        displayName: channelID,
        parentGroupNo,
      },
    },
    unread: 0,
    isMentionMe: false,
    simpleReminders: [],
    remoteExtra: {},
    timestamp: 1,
    lastMessage: undefined,
  };
}

function openContextMenu(selector: string) {
  const row = container.querySelector(selector);
  expect(row).not.toBeNull();
  act(() => {
    row!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
}

function currentMenuOrder() {
  return Array.from(
    container.querySelectorAll('[data-testid="context-menu-model"] > li')
  ).map((item) =>
    item.getAttribute("data-separator") === "true"
      ? "separator"
      : item.getAttribute("data-menu-title")
  );
}

describe("ConversationList unread indicators", () => {
  it("renders unread count under the time instead of on the avatar", () => {
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={
            [makeConversation({ unread: 3, mention: true })] as any
          }
        />,
        container
      );
    });

    const avatarBox = container.querySelector(
      ".wk-conversationlist-item-avatar-box"
    );
    const indicators = container.querySelector(
      ".wk-conversationlist-item-indicators"
    );

    expect(avatarBox?.querySelector(".wk-conv-unread-num")).toBeNull();
    expect(indicators?.querySelector(".wk-mention")?.textContent).toBe(
      "base.conversationList.mentionMarker"
    );
    expect(indicators?.querySelector(".wk-conv-unread-num")?.textContent).toBe(
      "3"
    );
  });

  it("renders muted unread count under the time instead of on the avatar", () => {
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={[makeConversation({ unread: 14, mute: true })] as any}
        />,
        container
      );
    });

    const avatarBox = container.querySelector(
      ".wk-conversationlist-item-avatar-box"
    );
    const indicators = container.querySelector(
      ".wk-conversationlist-item-indicators"
    );

    expect(avatarBox?.querySelector(".wk-conv-unread-num")).toBeNull();
    expect(container.querySelector(".wk-conv-count-hint")).toBeNull();
    expect(
      indicators?.querySelector(".wk-conv-unread-num--muted")?.textContent
    ).toBe("14");
  });

  it("renders mention and muted unread count together", () => {
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={
            [makeConversation({ unread: 5, mention: true, mute: true })] as any
          }
        />,
        container
      );
    });

    const indicators = container.querySelector(
      ".wk-conversationlist-item-indicators"
    );

    expect(indicators?.querySelector(".wk-mention")?.textContent).toBe(
      "base.conversationList.mentionMarker"
    );
    expect(
      indicators?.querySelector(".wk-conv-unread-num--muted")?.textContent
    ).toBe("5");
  });

  it("renders the 1v1 unread-priority marker for an unread DM without mention", () => {
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={[makeConversation({ unread: 2 })] as any}
        />,
        container
      );
    });

    const indicators = container.querySelector(
      ".wk-conversationlist-item-indicators"
    );
    // 1v1 未读→独立的 unreadPriorityMarker（非 @我）
    expect(indicators?.querySelector(".wk-mention")?.textContent).toBe(
      "base.conversationList.unreadPriorityMarker"
    );
    expect(indicators?.querySelector(".wk-conv-unread-num")?.textContent).toBe(
      "2"
    );
  });

  it("suppresses the 1v1 priority marker when the DM is muted", () => {
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={[makeConversation({ unread: 4, mute: true })] as any}
        />,
        container
      );
    });

    const indicators = container.querySelector(
      ".wk-conversationlist-item-indicators"
    );
    // 免打扰 1v1：不点亮深红标记，但仍显示静音未读数
    expect(indicators?.querySelector(".wk-mention")).toBeNull();
    expect(
      indicators?.querySelector(".wk-conv-unread-num--muted")?.textContent
    ).toBe("4");
  });

  it("prefers the group mention marker over the 1v1 marker when both would apply", () => {
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={
            [makeConversation({ unread: 1, mention: true })] as any
          }
        />,
        container
      );
    });

    const indicators = container.querySelector(
      ".wk-conversationlist-item-indicators"
    );
    const markers = indicators?.querySelectorAll(".wk-mention");
    // 只有一个标记，且是群聊 @我（hasMention 优先，不叠加 1v1）
    expect(markers?.length).toBe(1);
    expect(markers?.[0]?.textContent).toBe(
      "base.conversationList.mentionMarker"
    );
  });

  it("does not render indicators when there is no unread count or mention", () => {
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={[makeConversation({ unread: 0 })] as any}
        />,
        container
      );
    });

    expect(
      container.querySelector(".wk-conversationlist-item-indicators")
    ).toBeNull();
  });

  it("uses the parent row ThreadIcon and chevron to expand or collapse followed threads", () => {
    const parent = makeCompactConversation("group-a", 2);
    const thread = makeCompactConversation("thread-a", 3, "group-a");

    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={[parent, thread] as any}
          compact
          disablePinSplit
        />,
        container
      );
    });

    const toggle = container.querySelector(
      ".wk-conv-compact-thread-tag"
    ) as HTMLElement;
    expect(toggle).not.toBeNull();
    expect(toggle.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(
      container.querySelectorAll(".wk-conv-compact-item--thread")
    ).toHaveLength(1);

    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(toggle.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(
      container.querySelectorAll(".wk-conv-compact-item--thread")
    ).toHaveLength(0);
  });

  it("uses GripVertical only for sortable parent rows", () => {
    const parent = makeCompactConversation("group-a", 2);
    const thread = makeCompactConversation("thread-a", 3, "group-a");

    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={[parent, thread] as any}
          compact
          disablePinSplit
        />,
        container
      );
    });

    expect(
      container.querySelectorAll(
        ".wk-conv-compact-drag-handle .lucide-grip-vertical"
      )
    ).toHaveLength(1);
    expect(
      container.querySelector(
        ".wk-conv-compact-item--thread .wk-conv-compact-drag-handle"
      )
    ).toBeNull();
  });
});

describe("ConversationList context-menu matrix", () => {
  it("orders the Recent menu and omits mark-as-unread", () => {
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={[makeConversation({ unread: 3 })] as any}
          extraContextMenus={() => [
            { title: "base.chatSidebar.context.unfollow" },
          ]}
        />,
        container
      );
    });

    openContextMenu(".wk-conversationlist-item");

    expect(currentMenuOrder()).toEqual([
      "base.conversationList.context.pin",
      "base.conversationList.context.markAsRead",
      "base.chatSidebar.context.unfollow",
      "base.conversationList.context.mute",
      "separator",
      "base.conversationList.context.hideChat",
    ]);
    expect(container.textContent).not.toContain("markAsUnread");
  });

  it("keeps Follow child threads free of pin, move, hide and trailing separators", () => {
    const thread = makeCompactConversation("thread-a", 3, "group-a");
    thread.unread = 2;

    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={[thread] as any}
          compact
          disablePinSplit
          hidePin
          hideCloseChat
          extraContextMenus={() => [
            { title: "base.chatSidebar.context.unfollow" },
          ]}
          trailingContextMenus={() => []}
        />,
        container
      );
    });

    openContextMenu(".wk-conv-compact-item--thread");

    expect(currentMenuOrder()).toEqual([
      "base.conversationList.context.markAsRead",
      "base.chatSidebar.context.unfollow",
      "base.conversationList.context.mute",
    ]);
  });

  it("updates a Recent child thread immediately after the persisted pin succeeds", async () => {
    const thread = makeCompactConversation(
      "group-a____thread-a",
      3,
      "group-a"
    ) as any;
    thread.conversation = {
      channel: thread.channel,
      extra: { top: 0 },
    };
    thread.extra = thread.conversation.extra;

    act(() => {
      ReactDOM.render(
        <ConversationList conversations={[thread]} />,
        container
      );
    });
    openContextMenu(".wk-conversationlist-item");

    expect(currentMenuOrder()[0]).toBe("base.conversationList.context.pin");
    await act(async () => {
      (container.querySelector(
        '[data-menu-title="base.conversationList.context.pin"]'
      ) as HTMLElement).click();
      await Promise.resolve();
    });

    expect(topChannelSetting).toHaveBeenCalledWith({
      channel: thread.channel,
      top: true,
    });
    expect(thread.conversation.extra.top).toBe(1);
    expect(notifyConversationListeners).toHaveBeenCalledWith(
      thread.conversation,
      expect.anything()
    );
    expect(currentMenuOrder()[0]).toBe("base.conversationList.context.unpin");

    await act(async () => {
      (container.querySelector(
        '[data-menu-title="base.conversationList.context.unpin"]'
      ) as HTMLElement).click();
      await Promise.resolve();
    });

    expect(topChannelSetting).toHaveBeenLastCalledWith({
      channel: thread.channel,
      top: false,
    });
    expect(thread.conversation.extra.top).toBe(0);
    expect(currentMenuOrder()[0]).toBe("base.conversationList.context.pin");
  });

  it("keeps unread state and reports an error when clear-unread fails", async () => {
    const conversation = {
      ...makeConversation({ unread: 5 }),
      conversation: { unread: 5, extra: {} },
    };
    const error = new Error("clear failed");
    apiPut.mockRejectedValueOnce(error);

    act(() => {
      ReactDOM.render(
        <ConversationList conversations={[conversation] as any} />,
        container
      );
    });
    openContextMenu(".wk-conversationlist-item");

    await act(async () => {
      (container.querySelector(
        '[data-menu-title="base.conversationList.context.markAsRead"]'
      ) as HTMLElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiPut).toHaveBeenCalledWith("conversation/clearUnread", {
      channel_id: "alice",
      channel_type: 1,
      unread: 0,
    });
    expect(conversation.conversation.unread).toBe(5);
    expect(toastError).toHaveBeenCalledWith("base.conversationList.error.clearUnreadFailed");
  });
});
