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
      }),
    };

    return {
      default: sdk,
      WKSDK: sdk,
      Channel: MockChannel,
      ChannelTypePerson: 1,
      ChannelTypeGroup: 2,
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
    default: () => null,
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
      apiClient: { put: vi.fn() },
      conversationProvider: { deleteConversation: vi.fn() },
    },
  }));

  vi.doMock("../../../Service/Const", () => ({
    ChannelTypeCommunityTopic: 3,
    EndpointID: {},
  }));

  vi.doMock("../../../Service/Thread", () => ({
    parseThreadChannelId: () => undefined,
  }));

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
  }));

  vi.doMock("react-spinners", () => ({
    BeatLoader: () => null,
  }));

  ConversationList = (await import("../index")).default;
});

beforeEach(() => {
  vi.clearAllMocks();
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
});
