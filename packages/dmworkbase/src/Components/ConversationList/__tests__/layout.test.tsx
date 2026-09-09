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
let ActualConversationWrap: typeof import(
  "../../../Service/Model"
).ConversationWrap;
let container: HTMLDivElement;
const apiPut = vi.fn();
const toastError = vi.fn();
const notifyConversationListeners = vi.fn();
const reminderDone = vi.fn(() => Promise.resolve());
const mittEmit = vi.fn();
const browserUnreadPublish = vi.fn();
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
        config: { uid: "u1" },
        channelManager: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
          fetchChannelInfo: vi.fn(),
          getChannelInfo: vi.fn(),
        },
        conversationManager: {
          notifyConversationListeners,
        },
        reminderManager: {
          done: reminderDone,
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
      mittBus: { emit: mittEmit },
    },
  }));

  vi.doMock("../../../features/documentTitle", () => ({
    getBrowserUnreadConversationSync: () => ({
      publish: browserUnreadPublish,
    }),
  }));

  vi.doMock("../../../Service/Const", async () => {
    const actual = await vi.importActual<
      typeof import("../../../Service/Const")
    >("../../../Service/Const");
    return {
      ...actual,
      ChannelTypeCommunityTopic: 3,
    };
  });

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

  vi.doMock("../../../Service/EmojiService", () => ({
    DefaultEmojiService: {
      shared: { emojiRegExp: () => /(?!)/ },
    },
  }));

  vi.doMock("../../../Service/SpaceService", () => ({
    getSpaceFilteredLastMessage: (conversation: any) =>
      conversation.lastMessage,
    SYSTEM_BOTS: new Set(),
  }));

  const actualModel = await vi.importActual<
    typeof import("../../../Service/Model")
  >("../../../Service/Model");
  ActualConversationWrap = actualModel.ConversationWrap;

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

  vi.doMock("../../WKModal", () => ({
    wkConfirm: vi.fn(),
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
  channelType?: number;
  channelID?: string;
}) {
  const channel = makeChannel(
    options.channelID ?? "alice",
    options.channelType ?? 1
  );
  return {
    channel,
    channelInfo: {
      channel,
      mute: options.mute,
      online: false,
      lastOffline: 0,
      top: false,
      orgData: {
        displayName: options.channelID ?? "Alice",
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
  parentGroupNo?: string,
  options: { isMentionMe?: boolean; unread?: number } = {}
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
    unread: options.unread ?? 0,
    isMentionMe: !!options.isMentionMe,
    simpleReminders: [],
    remoteExtra: {},
    timestamp: 1,
    lastMessage: undefined,
  };
}

function makeReadMentionConversation(channelID: string) {
  const raw = makeCompactConversation(channelID, 2, undefined, { unread: 0 });
  return new ActualConversationWrap({
    ...raw,
    reminders: [],
    lastMessage: {
      channel: raw.channel,
      content: { mention: { uids: ["u1"] } },
    },
  } as any);
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

  it("keeps the mention marker in a muted conversation alongside the muted unread count", () => {
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

    // WS-213 review 反馈 P1-2：mute 语义反转需要产品拍板，暂保持既有行为——
    // 免打扰群里的直接 @我 仍然点亮 marker（与 v1 shipped 行为一致）。
    expect(indicators?.querySelector(".wk-mention")?.textContent).toBe(
      "base.conversationList.mentionMarker"
    );
    expect(
      indicators?.querySelector(".wk-conv-unread-num--muted")?.textContent
    ).toBe("5");
  });

  it("renders an authoritative mention signal independently of the row unread count", () => {
    // 这里只验证渲染层契约：上游已经判定 isMentionMe=true 时，不再由行级 unread
    // 二次屏蔽。读到底后该信号是否仍为 true，由 ConversationWrap 的 reminder/
    // read-watermark 规则决定并在 Model.test.ts 中覆盖。
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={
            [makeConversation({ unread: 0, mention: true })] as any
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
  });

  it("renders an authoritative mention signal on a group row with zero unread", () => {
    // 群聊是 WS-213 的主要目标；本用例只验证行组件消费已解析 mention 信号的行为。
    act(() => {
      ReactDOM.render(
        <ConversationList
          conversations={
            [
              makeConversation({
                unread: 0,
                mention: true,
                channelType: 2,
                channelID: "team-room",
              }),
            ] as any
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

  it("bubbles @我 from a collapsed thread onto the parent group row (WS-213 rev 3, P2-2)", () => {
    // 折叠态：thread 行不显示，父群行应通过 collapsedThreadHasMention 冒泡出 @我 marker。
    // 覆盖 renderItem → conversationItem → CompactGroupItem 的整条 wiring，
    // 而不只是 unread.ts 里的 helper 单测。
    const parent = makeCompactConversation("group-a", 2);
    const thread = makeCompactConversation("thread-a", 3, "group-a", {
      isMentionMe: true,
    });

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

    // 强制进入 collapsed：如果当前是 expanded，点一下 toggle 收起。
    const toggle = container.querySelector(
      ".wk-conv-compact-thread-tag"
    ) as HTMLElement;
    expect(toggle).not.toBeNull();
    if (toggle.querySelector(".lucide-chevron-down")) {
      act(() => {
        toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    expect(
      container.querySelectorAll(".wk-conv-compact-item--thread")
    ).toHaveLength(0);

    const parentRow = container.querySelector(
      ".wk-conv-compact-item--has-threads"
    );
    expect(parentRow).not.toBeNull();
    expect(parentRow?.querySelector(".wk-conv-compact-mention")).not.toBeNull();
  });

  it("does not revive an acknowledged parent mention from ordinary collapsed thread unread (#1625)", () => {
    // 父群最后一条消息仍然 @我，但 unread 已清零且 reminder 重载后为空。
    // 这里使用真实 ConversationWrap getter，确保子区普通未读不能重新暴露历史 mention。
    const parent = makeReadMentionConversation("group-read");
    const thread = makeCompactConversation("thread-plain", 3, "group-read", {
      isMentionMe: false,
      unread: 1,
    });

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
    if (toggle.querySelector(".lucide-chevron-down")) {
      act(() => {
        toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    expect(
      container.querySelectorAll(".wk-conv-compact-item--thread")
    ).toHaveLength(0);
    const parentRow = container.querySelector(
      ".wk-conv-compact-item--has-threads"
    );
    expect(parentRow).not.toBeNull();
    expect(parentRow?.querySelector(".wk-conv-compact-mention")).toBeNull();
    expect(parentRow?.querySelector(".wk-conv-compact-badge")?.textContent).toBe(
      "1"
    );
  });

  it("does not double-light @我 when the thread is expanded (WS-213 rev 3, P2-2)", () => {
    // 展开态：thread 行自己亮 @我，父群行不应再冒泡（否则同一 mention 亮两次）。
    const parent = makeCompactConversation("group-a", 2);
    const thread = makeCompactConversation("thread-a", 3, "group-a", {
      isMentionMe: true,
    });

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

    // 强制进入 expanded：如果当前 collapsed，点一下 toggle 展开。
    const toggle = container.querySelector(
      ".wk-conv-compact-thread-tag"
    ) as HTMLElement;
    expect(toggle).not.toBeNull();
    if (toggle.querySelector(".lucide-chevron-right")) {
      act(() => {
        toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    expect(
      container.querySelectorAll(".wk-conv-compact-item--thread")
    ).toHaveLength(1);

    const parentRow = container.querySelector(
      ".wk-conv-compact-item--has-threads"
    );
    expect(parentRow?.querySelector(".wk-conv-compact-mention")).toBeNull();

    const threadRow = container.querySelector(".wk-conv-compact-item--thread");
    expect(threadRow?.querySelector(".wk-conv-compact-mention")).not.toBeNull();
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
    const reminders = [
      { reminderID: 7, messageSeq: 10, reminderType: 1, done: false },
    ];
    const conversation = {
      ...makeConversation({ unread: 5 }),
      reminders,
      conversation: { unread: 5, extra: {}, reminders },
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
    expect(reminderDone).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("base.conversationList.error.clearUnreadFailed");
  });

  it("marks unresolved mention reminders done when marking a conversation as read", async () => {
    const reminders = [
      { reminderID: 7, messageSeq: 10, reminderType: 1, done: false },
      { reminderID: 8, messageSeq: 9, reminderType: 1, done: true },
      { reminderID: 9, messageSeq: 8, reminderType: 2, done: false },
    ];
    const conversation = {
      ...makeConversation({ unread: 5, mention: true }),
      reminders,
      conversation: { unread: 5, extra: {}, reminders },
    };
    apiPut.mockResolvedValueOnce({});

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

    expect(conversation.conversation.unread).toBe(0);
    expect(reminderDone).toHaveBeenCalledWith([7]);
  });
});
