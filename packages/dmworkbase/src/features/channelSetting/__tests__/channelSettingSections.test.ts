import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

import { ChannelTypeCommunityTopic } from "../../../Service/Const";
import { ThreadStatus } from "../../../Service/Thread";
import { GroupStatusDisband } from "../../../Utils/groupDisband";
import { buildChannelGroupInfoSection } from "../channelSettingGroupInfoSection";
import {
  buildChannelDangerSection,
  buildChannelPreferenceSection,
  buildMyGroupNicknameSection,
} from "../channelSettingSections";
import { buildChannelMembersSection } from "../channelSettingMemberSection";
import {
  buildThreadActionsSection,
  buildThreadInfoSection,
  buildThreadMdSection,
  buildThreadWebhookSection,
} from "../channelSettingThreadSections";

vi.mock("../../../App", () => ({
  default: {
    loginInfo: {
      uid: "alice",
    },
    shared: {
      avatarChannel: vi.fn(() => "avatar-url"),
      baseContext: {
        showAlert: vi.fn(),
      },
    },
    endpoints: {
      showConversation: vi.fn(),
    },
  },
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  fetchCurrentImChannelInfo: vi.fn(),
  getCurrentImChannelInfo: vi.fn(() => ({ title: "Parent Group" })),
}));

vi.mock("../../../Service/threadPermission", () => ({
  canRenameThread: vi.fn(() => true),
  isParentGroupManager: vi.fn(() => true),
  shouldShowThreadArchiveAction: vi.fn(() => true),
}));

function createContext(overrides: Record<string, any> = {}) {
  const data = {
    channel: new Channel("group-1", ChannelTypeGroup),
    channelInfo: {
      title: "Group 1",
      mute: false,
      top: true,
      orgData: {
        save: 1,
      },
    },
    refresh: vi.fn(),
    subscribers: [{ uid: "alice" }],
    subscriberOfMe: {
      name: "Alice",
      remark: "Ali",
      role: 0,
    },
    ...overrides,
  };

  return {
    routeData: vi.fn(() => data),
    push: vi.fn(),
  } as any;
}

function createThreadContext(overrides: Record<string, any> = {}) {
  return createContext({
    channel: new Channel("group-1____thread-1", ChannelTypeCommunityTopic),
    channelInfo: {
      title: "Thread 1",
      orgData: {
        thread: {
          status: ThreadStatus.Active,
          name: "Thread 1",
          creator_uid: "alice",
        },
      },
    },
    ...overrides,
  });
}

describe("channel setting section builders", () => {
  it("builds member section only for active supported channels", () => {
    const normal = buildChannelMembersSection(createContext());
    const thread = buildChannelMembersSection(
      createContext({
        channel: new Channel("group-1@thread", ChannelTypeCommunityTopic),
      })
    );
    const disbanded = buildChannelMembersSection(
      createContext({
        channelInfo: {
          orgData: {
            status: GroupStatusDisband,
          },
        },
      })
    );

    expect(normal?.rows).toHaveLength(1);
    expect(thread).toBeUndefined();
    expect(disbanded).toBeUndefined();
  });

  it("hides preference rows for thread channels", () => {
    const context = createContext({
      channel: new Channel("group-1@thread", ChannelTypeCommunityTopic),
    });

    expect(buildChannelPreferenceSection(context)).toBeUndefined();
  });

  it("builds group preference rows and hides mute after disband", () => {
    const normal = buildChannelPreferenceSection(createContext());
    const disbanded = buildChannelPreferenceSection(
      createContext({
        channelInfo: {
          top: false,
          orgData: {
            save: 0,
            status: GroupStatusDisband,
          },
        },
      })
    );

    expect(normal?.rows).toHaveLength(3);
    expect(disbanded?.rows).toHaveLength(2);
  });

  it("builds my group nickname only for active groups", () => {
    const inputEditPush = vi.fn();
    const normal = buildMyGroupNicknameSection(createContext(), inputEditPush);
    const disbanded = buildMyGroupNicknameSection(
      createContext({
        channelInfo: {
          orgData: {
            status: GroupStatusDisband,
          },
        },
      }),
      inputEditPush
    );

    expect(normal?.rows).toHaveLength(1);
    expect(normal?.rows?.[0].properties.subTitle).toBe("Ali");
    expect(disbanded).toBeUndefined();
  });

  it("builds danger rows only for active groups", () => {
    const normal = buildChannelDangerSection(createContext());
    const disbanded = buildChannelDangerSection(
      createContext({
        channelInfo: {
          orgData: {
            status: GroupStatusDisband,
          },
        },
      })
    );

    expect(normal?.rows).toHaveLength(2);
    expect(disbanded).toBeUndefined();
  });

  it("builds group info rows and keeps only remark after disband", () => {
    const inputEditPush = vi.fn();
    const activeOwner = buildChannelGroupInfoSection(
      createContext({
        isManagerOrCreatorOfMe: true,
        subscriberOfMe: {
          uid: "alice",
          role: 1,
        },
      }),
      inputEditPush
    );
    const disbanded = buildChannelGroupInfoSection(
      createContext({
        channelInfo: {
          title: "Group 1",
          orgData: {
            remark: "remark",
            status: GroupStatusDisband,
          },
        },
      }),
      inputEditPush
    );

    expect(activeOwner?.rows).toHaveLength(9);
    expect(disbanded?.rows).toHaveLength(1);
    expect(disbanded?.rows?.[0].properties.subTitle).toBe("remark");
  });

  it("builds thread setting sections for active thread channels", () => {
    const inputEditPush = vi.fn();
    const context = createThreadContext();

    expect(buildThreadInfoSection(context, inputEditPush)?.rows).toHaveLength(
      3
    );
    expect(buildThreadMdSection(context)?.rows).toHaveLength(1);
    expect(buildThreadWebhookSection(context)?.rows).toHaveLength(1);
    expect(buildThreadActionsSection(context)?.rows).toHaveLength(2);
  });

  it("hides thread sections for group channels", () => {
    const inputEditPush = vi.fn();
    const context = createContext();

    expect(buildThreadInfoSection(context, inputEditPush)).toBeUndefined();
    expect(buildThreadMdSection(context)).toBeUndefined();
    expect(buildThreadWebhookSection(context)).toBeUndefined();
    expect(buildThreadActionsSection(context)).toBeUndefined();
  });
});
