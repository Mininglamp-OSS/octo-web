import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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
      ReminderType: { ReminderTypeMentionMe: 1 },
    };
  });

  vi.doMock("../../WKAvatar", () => ({
    default: ({ channel }: { channel: { channelID: string } }) => (
      <div className="wk-avatar" data-channel-id={channel.channelID} />
    ),
  }));
  vi.doMock("../../ContextMenus", () => ({ default: () => null }));
  vi.doMock("../../AiBadge", () => ({ default: () => null }));
  vi.doMock("../../Icons/GroupIcon", () => ({ default: () => <span /> }));
  vi.doMock("../../Icons/ThreadIcon", () => ({ default: () => <span /> }));

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
      shared: { top: vi.fn(), mute: vi.fn(() => Promise.resolve()) },
    },
  }));
  vi.doMock("../../../Service/Model", () => ({ MessageWrap: class {} }));
  vi.doMock("../../../Messages/Revoke", () => ({ RevokeCell: { tip: () => "" } }));
  vi.doMock("../../../Messages/Flame", () => ({
    FlameMessageCell: { tip: () => "" },
  }));
  vi.doMock("../../../Utils/time", () => ({
    getTimeStringAutoShort2: () => "now",
  }));
  vi.doMock("../../../Utils/draftPreview", () => ({
    formatDraftPreview: (draft: string) => draft,
  }));
  vi.doMock("../../WKModal", () => ({ wkConfirm: vi.fn() }));
  vi.doMock("../../Conversation/vm", () => ({
    default: { foldSessionPreview: new Map() },
  }));
  vi.doMock("../../../i18n", () => ({
    I18nContext: React.createContext({}),
    t: (key: string) => key,
    useI18n: () => ({ t: (key: string) => key }),
  }));
  vi.doMock("@douyinfe/semi-ui", () => ({
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  }));
  vi.doMock("react-spinners", () => ({ BeatLoader: () => null }));

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

// channelType 1 = person (DM / agent / human). online drives the badge.
function makeConversation(opts: {
  id?: string;
  online: boolean;
  lastOffline?: number;
}) {
  const channel = new MockChannel(opts.id ?? "alice", 1);
  return {
    channel,
    channelInfo: {
      channel,
      mute: false,
      online: opts.online,
      lastOffline: opts.lastOffline ?? 0,
      top: false,
      orgData: { displayName: "Alice" },
    },
    unread: 0,
    isMentionMe: false,
    simpleReminders: [],
    remoteExtra: {},
    timestamp: 1,
    lastMessage: undefined,
  };
}

function render(node: React.ReactElement) {
  act(() => {
    ReactDOM.render(node, container);
  });
}

describe("online badge in compact (favorites/group) list", () => {
  it("renders the online badge for an online entry in compact mode", () => {
    render(
      <ConversationList
        compact
        conversations={[makeConversation({ online: true })] as any}
      />
    );
    const compactItem = container.querySelector(".wk-conv-compact-item");
    expect(compactItem).not.toBeNull();
    expect(
      compactItem?.querySelector(".wk-conv-compact-icon .wk-onlinestatusbadge")
    ).not.toBeNull();
  });

  it("does not render the badge for a long-offline entry in compact mode", () => {
    render(
      <ConversationList
        compact
        conversations={[makeConversation({ online: false, lastOffline: 1 })] as any}
      />
    );
    const compactItem = container.querySelector(".wk-conv-compact-item");
    expect(compactItem).not.toBeNull();
    expect(compactItem?.querySelector(".wk-onlinestatusbadge")).toBeNull();
  });

  it("matches the recent (non-compact) list: same online entry shows a badge in both", () => {
    const conv = makeConversation({ online: true });

    render(<ConversationList compact conversations={[conv] as any} />);
    const compactHasBadge = !!container.querySelector(
      ".wk-conv-compact-item .wk-onlinestatusbadge"
    );

    render(<ConversationList conversations={[conv] as any} />);
    const recentHasBadge = !!container.querySelector(
      ".wk-conversationlist-item-avatar-box .wk-onlinestatusbadge"
    );

    expect(compactHasBadge).toBe(true);
    expect(recentHasBadge).toBe(true);
    expect(compactHasBadge).toBe(recentHasBadge);
  });
});
