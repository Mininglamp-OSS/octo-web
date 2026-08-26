import { Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelTypeCommunityTopic, GroupRole } from "../../../Service/Const";
import { ThreadStatus } from "../../../Service/Thread";
import { GroupStatusDisband } from "../../../Utils/groupDisband";
import {
  muteChannelSetting,
  updateChannelSettingMyGroupNickname,
} from "../../../bridge/channelSetting/channelSettingActions";
import {
  fetchCurrentImChannelInfo,
  getCurrentImChannelInfo,
} from "../../../im-runtime/currentChannelRuntime";
import { t } from "../../../i18n";
import {
  ChannelSettingInfoRow,
  ChannelSettingToggleRow,
} from "../../../ui/ChannelSettingRows";
import { buildChannelGroupInfoSection } from "../channelSettingGroupInfoSection";
import { buildGroupProfileRows } from "../channelSettingGroupProfileRows";
import {
  buildChannelDangerSection,
  buildChannelPreferenceSection,
  buildMyGroupNicknameSection,
} from "../channelSettingSections";
import {
  buildChannelMembersSection,
  canRemoveChannelSettingSubscriber,
} from "../channelSettingMemberSection";
import {
  buildThreadActionsSection,
  buildThreadInfoSection,
  buildThreadMdSection,
  buildThreadOverviewSection,
  buildThreadWebhookSection,
} from "../channelSettingThreadSections";

vi.mock("@douyinfe/semi-ui", () => ({
  Button: vi.fn(),
  Input: vi.fn(),
  Switch: vi.fn(),
  Tag: vi.fn(),
  TextArea: vi.fn(),
  Toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconAlertTriangle: vi.fn(),
  IconLink: vi.fn(),
  IconPlus: vi.fn(),
}));

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
      organizationalTool: vi.fn((channel, render) => render),
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

vi.mock("../../../bridge/channelSetting/channelSettingActions", () => ({
  addChannelSettingSubscribers: vi.fn(),
  clearChannelSettingMessages: vi.fn(),
  createGroupFromChannelSettingPrivateChat: vi.fn(),
  exitChannelSettingGroup: vi.fn(),
  leaveChannelSettingThread: vi.fn(),
  muteChannelSetting: vi.fn(() => Promise.resolve()),
  remarkChannelSetting: vi.fn(),
  removeChannelSettingSubscribers: vi.fn(() => Promise.resolve()),
  saveChannelSetting: vi.fn(),
  topChannelSetting: vi.fn(),
  transferChannelSettingOwner: vi.fn(),
  updateChannelSettingField: vi.fn(),
  updateChannelSettingMyGroupNickname: vi.fn(() => Promise.resolve()),
  updateChannelSettingThreadName: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentImChannelInfo).mockReturnValue({
      title: "Parent Group",
      mute: false,
      orgData: { status: 1 },
    } as any);
    vi.mocked(fetchCurrentImChannelInfo).mockResolvedValue(undefined);
    vi.mocked(muteChannelSetting).mockResolvedValue(undefined);
  });

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

  it("opens v2-style member management instead of the old multi-select finish flow", () => {
    const context = createContext({
      channelInfo: {
        orgData: {
          member_count: 3,
        },
      },
      subscriberOfMe: {
        uid: "alice",
        role: 1,
      },
      subscribers: [
        { uid: "alice", role: 1 },
        { uid: "bob", role: 0 },
        { uid: "carol", role: 0 },
      ],
    });
    const section = buildChannelMembersSection(context);

    section?.rows?.[0].properties.onRemove();

    expect(context.push).toHaveBeenCalledTimes(1);
    const [view, config] = context.push.mock.calls[0];
    expect(view.props.canSelect).toBeUndefined();
    expect(view.props.removeAction).toBeTruthy();
    expect(config.title).toBeTruthy();
    expect(config.showFinishButton).toBeUndefined();
  });

  it("exposes removeAction to the view-all path too", () => {
    // octo-web#1511：普通成员没有「移除成员」图标，只能从「查看全部」进成员列表。
    // 该路径以前不带 removeAction，等于自助移除入口对普通成员完全不可达。
    // 逐行是否显示仍由 canRemove 决定，故对不拥有 bot 的成员无可见变化。
    const context = createContext({
      channelInfo: { orgData: { member_count: 3 } },
      subscriberOfMe: { uid: "bob", role: 0 },
      subscribers: [
        { uid: "alice", role: 1 },
        { uid: "bob", role: 0 },
      ],
    });
    const section = buildChannelMembersSection(context);

    const { removeAction } = section?.rows?.[0].properties ?? {};
    expect(removeAction).toBeTruthy();
    expect(typeof removeAction.canRemove).toBe("function");
    expect(typeof removeAction.onRemove).toBe("function");
  });

  it("keeps member removal permissions scoped to the current manager role", () => {
    const owner = { uid: "owner", role: 1 } as any;
    const manager = { uid: "manager", role: 2 } as any;
    const normal = { uid: "normal", role: 0 } as any;

    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "owner",
        viewerRole: 1,
        subscriber: normal,
      })
    ).toBe(true);
    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "owner",
        viewerRole: 1,
        subscriber: manager,
      })
    ).toBe(true);
    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "owner",
        viewerRole: 1,
        subscriber: owner,
      })
    ).toBe(false);
    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "manager",
        viewerRole: 2,
        subscriber: normal,
      })
    ).toBe(true);
    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "manager",
        viewerRole: 2,
        subscriber: owner,
      })
    ).toBe(false);
    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "manager",
        viewerRole: 2,
        subscriber: manager,
      })
    ).toBe(false);
  });

  it("lets a normal member remove a bot they own", () => {
    // octo-web#1511：普通成员（role 0）对自己名下的 bot 可移除；
    // bot_owned_by_me 由后端 per-viewer 计算后下发到成员行的 orgData。
    const myBot = {
      uid: "bot_mine",
      role: 0,
      orgData: { robot: 1, bot_owned_by_me: true },
    } as any;

    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "normal",
        viewerRole: 0,
        subscriber: myBot,
      })
    ).toBe(true);
  });

  it("does not let a normal member remove bots they do not own", () => {
    const othersBot = {
      uid: "bot_theirs",
      role: 0,
      orgData: { robot: 1, bot_owned_by_me: false },
    } as any;
    const human = { uid: "peer", role: 0 } as any;

    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "normal",
        viewerRole: 0,
        subscriber: othersBot,
      })
    ).toBe(false);
    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "normal",
        viewerRole: 0,
        subscriber: human,
      })
    ).toBe(false);
  });

  it("fails closed when bot_owned_by_me is missing", () => {
    // /membersync 是按 version 的增量同步：本字段上线前已缓存的成员行不会带上它。
    // 缺失必须退回改动前的行为（不可移除），绝不能误开权限。
    const staleBotRow = { uid: "bot_stale", role: 0, orgData: { robot: 1 } } as any;
    const noOrgData = { uid: "bot_no_org", role: 0 } as any;
    const truthyButNotTrue = {
      uid: "bot_truthy",
      role: 0,
      orgData: { robot: 1, bot_owned_by_me: 1 },
    } as any;

    for (const subscriber of [staleBotRow, noOrgData, truthyButNotTrue]) {
      expect(
        canRemoveChannelSettingSubscriber({
          viewerUid: "normal",
          viewerRole: 0,
          subscriber,
        })
      ).toBe(false);
    }
  });

  it("still refuses to remove the group owner and yourself, bot or not", () => {
    // 两条否决优先于自助移除：即便某个 bot 被标成「我的」，
    // 只要它是群主就不能移除；自己也不能移除自己。
    const ownerBot = {
      uid: "bot_owner",
      role: 1,
      orgData: { robot: 1, bot_owned_by_me: true },
    } as any;
    const selfBot = {
      uid: "normal",
      role: 0,
      orgData: { robot: 1, bot_owned_by_me: true },
    } as any;

    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "normal",
        viewerRole: 0,
        subscriber: ownerBot,
      })
    ).toBe(false);
    expect(
      canRemoveChannelSettingSubscriber({
        viewerUid: "normal",
        viewerRole: 0,
        subscriber: selfBot,
      })
    ).toBe(false);
  });

  it("builds thread mute rows without adding group-only preferences", async () => {
    const context = createThreadContext({
      channelInfo: {
        title: "Thread 1",
        orgData: {
          thread: { status: ThreadStatus.Active, mute: 1 },
        },
      },
    });
    const section = buildChannelPreferenceSection(context);

    expect(section?.rows).toHaveLength(1);
    expect(section?.rows?.[0].properties.checked).toBe(true);
    expect(section?.rows?.[0].properties.title).toBe(
      t("base.module.channelSettings.mute")
    );
    expect(section?.rows?.[0].properties.subTitle).toBe(
      t("base.module.thread.muteInheritHint")
    );

    const row = { loading: false } as any;
    section?.rows?.[0].properties.onChange(false, row);

    expect(muteChannelSetting).toHaveBeenCalledWith({
      channel: context.routeData().channel,
      mute: false,
    });
    await vi.waitFor(() => {
      expect(context.routeData().refresh).toHaveBeenCalled();
      expect(row.loading).toBe(false);
    });
    expect(fetchCurrentImChannelInfo).not.toHaveBeenCalled();
  });

  it.each([
    { threadMute: null, parentMuted: false, checked: false },
    { threadMute: 0, parentMuted: false, checked: false },
    { threadMute: 1, parentMuted: false, checked: true },
    { threadMute: null, parentMuted: true, checked: true },
    { threadMute: 0, parentMuted: true, checked: true },
    { threadMute: 1, parentMuted: true, checked: true },
  ])(
    "represents thread mute=$threadMute with parent muted=$parentMuted",
    ({ threadMute, parentMuted, checked }) => {
      vi.mocked(getCurrentImChannelInfo).mockReturnValue({
        title: "Parent Group",
        mute: parentMuted,
        orgData: { status: 1 },
      } as any);
      const context = createThreadContext({
        channelInfo: {
          title: "Thread 1",
          orgData: {
            thread: {
              status: ThreadStatus.Active,
              mute: threadMute,
            },
          },
        },
      });

      const row = buildChannelPreferenceSection(context)?.rows?.[0];

      if (parentMuted) {
        expect(row?.cell).toBe(ChannelSettingInfoRow);
        expect(row?.properties.value).toBe(
          t("base.module.thread.muteInheritedOn")
        );
        expect(row?.properties.onChange).toBeUndefined();
      } else {
        expect(row?.cell).toBe(ChannelSettingToggleRow);
        expect(row?.properties.checked).toBe(checked);
      }
    }
  );

  it("renders a fallback mute row while parent info is unavailable", () => {
    vi.mocked(getCurrentImChannelInfo).mockReturnValue(undefined);
    const context = createThreadContext();
    const section = buildChannelPreferenceSection(context);

    expect(section?.rows).toHaveLength(1);
    expect(section?.rows?.[0].cell).toBe(ChannelSettingInfoRow);
    expect(section?.rows?.[0].properties.title).toBe(
      t("base.module.channelSettings.mute")
    );
    expect(section?.rows?.[0].properties.value).toBe(
      t("base.module.thread.muteParentUnavailable")
    );
    expect(section?.rows?.[0].properties.onChange).toBeUndefined();
    expect(fetchCurrentImChannelInfo).not.toHaveBeenCalled();
    expect(context.routeData().refresh).not.toHaveBeenCalled();
  });

  it("renders a fallback mute row for an empty parent channel info shell", () => {
    vi.mocked(getCurrentImChannelInfo).mockReturnValue({
      title: "",
      orgData: {},
    } as any);
    const context = createThreadContext();
    const section = buildChannelPreferenceSection(context);

    expect(section?.rows).toHaveLength(1);
    expect(section?.rows?.[0].cell).toBe(ChannelSettingInfoRow);
    expect(section?.rows?.[0].properties.value).toBe(
      t("base.module.thread.muteParentUnavailable")
    );
    expect(section?.rows?.[0].properties.onChange).toBeUndefined();
  });

  it.each([ThreadStatus.Archived, ThreadStatus.Deleted])(
    "hides thread mute rows for non-active status %s",
    (status) => {
      const context = createThreadContext({
        channelInfo: {
          title: "Thread 1",
          orgData: { thread: { status, mute: 0 } },
        },
      });

      expect(buildChannelPreferenceSection(context)).toBeUndefined();
    }
  );

  it("hides thread mute rows when the parent group is disbanded", () => {
    vi.mocked(getCurrentImChannelInfo).mockReturnValue({
      title: "Parent Group",
      mute: false,
      orgData: { status: GroupStatusDisband },
    } as any);

    expect(
      buildChannelPreferenceSection(createThreadContext())
    ).toBeUndefined();
  });

  it("restores loading and shows a fallback when thread mute fails", async () => {
    vi.mocked(muteChannelSetting).mockRejectedValueOnce({});
    const context = createThreadContext();
    const row = { loading: false } as any;
    const preferenceRow = buildChannelPreferenceSection(context)?.rows?.[0];

    preferenceRow?.properties.onChange(true, row);

    await vi.waitFor(() => {
      expect(row.loading).toBe(false);
      expect(Toast.error).toHaveBeenCalledWith(
        t("base.channelSetting.toggleFailed")
      );
    });
    expect(context.routeData().refresh).not.toHaveBeenCalled();
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
    expect(normal?.rows?.[0].properties.value).toBe("Ali");
    expect(disbanded).toBeUndefined();
  });

  it("updates the visible group nickname after a successful save", async () => {
    const context = createContext();
    const inputEditPush = vi.fn();
    const section = buildMyGroupNicknameSection(context, inputEditPush);

    await section?.rows?.[0].properties.onSave("Alice Updated");

    expect(updateChannelSettingMyGroupNickname).toHaveBeenCalledWith({
      channel: context.routeData().channel,
      remark: "Alice Updated",
    });
    expect(context.routeData().subscriberOfMe.remark).toBe("Alice Updated");
    expect(context.routeData().refresh).toHaveBeenCalled();
  });

  it("keeps a cleared group nickname empty instead of falling back to the member name", async () => {
    const context = createContext();
    const inputEditPush = vi.fn();
    const section = buildMyGroupNicknameSection(context, inputEditPush);

    await section?.rows?.[0].properties.onSave("");

    expect(updateChannelSettingMyGroupNickname).toHaveBeenCalledWith({
      channel: context.routeData().channel,
      remark: "",
    });
    expect(context.routeData().subscriberOfMe.remark).toBe("");

    const refreshedSection = buildMyGroupNicknameSection(
      context,
      inputEditPush
    );
    expect(refreshedSection?.rows?.[0].properties.value).toBe("");
    expect(refreshedSection?.rows?.[0].properties.displayValue).toBe(
      t("base.common.notSet")
    );
  });

  it("keeps the group nickname unchanged and reports a failed save", async () => {
    vi.mocked(updateChannelSettingMyGroupNickname).mockRejectedValueOnce({
      msg: "Nickname save failed",
    });
    const context = createContext();
    const section = buildMyGroupNicknameSection(context, vi.fn());

    const saved = await section?.rows?.[0].properties.onSave("New nickname");

    expect(saved).toBe(false);
    expect(Toast.error).toHaveBeenCalledWith("Nickname save failed");
    expect(context.routeData().subscriberOfMe.remark).toBe("Ali");
    expect(context.routeData().refresh).not.toHaveBeenCalled();
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
    expect(disbanded?.rows?.[0].properties.value).toBe("remark");
  });

  it("passes persisted avatar custom fields into the avatar modal row", () => {
    const context = createContext({
      isManagerOrCreatorOfMe: true,
      channelInfo: {
        title: "Avatar Group",
        orgData: {
          avatar_text: "研发",
          avatar_color: "5",
          is_upload_avatar: 1,
          is_named: 1,
        },
      },
      subscriberOfMe: {
        role: GroupRole.owner,
      },
    });
    const rows = buildGroupProfileRows({
      context,
      data: context.routeData(),
      inputEditPush: vi.fn(),
      disbanded: false,
    });

    expect(rows[1].properties.initialAvatarText).toBe("研发");
    expect(rows[1].properties.initialColorIndex).toBe(5);
    expect(rows[1].properties.isNamedGroup).toBe(true);
    expect(rows[1].properties.isUploadedAvatar).toBe(true);
    expect(rows[1].properties.canClearUploadedAvatar).toBe(true);
    expect(rows[1].properties.showUpload).toBe(true);
    expect(context.push).not.toHaveBeenCalled();
  });

  it("treats cleared avatar color and new groups as default fallback", () => {
    const context = createContext({
      isManagerOrCreatorOfMe: false,
      channelInfo: {
        title: "New Group",
        orgData: {
          avatar_text: "",
          avatar_color: "",
          is_named: 0,
        },
      },
    });
    const rows = buildGroupProfileRows({
      context,
      data: context.routeData(),
      inputEditPush: vi.fn(),
      disbanded: false,
    });

    expect(rows[1].properties.initialAvatarText).toBe("");
    expect(rows[1].properties.initialColorIndex).toBeUndefined();
    expect(rows[1].properties.isNamedGroup).toBe(false);
    expect(rows[1].properties.showUpload).toBe(false);
    expect(context.push).not.toHaveBeenCalled();
  });

  it("keeps avatar editing available to managers while uploaded avatar is active", () => {
    const context = createContext({
      isManagerOrCreatorOfMe: true,
      channelInfo: {
        title: "Uploaded Group",
        orgData: {
          avatar_text: "研发",
          avatar_color: "5",
          is_upload_avatar: 1,
          is_named: 1,
        },
      },
      subscriberOfMe: {
        role: GroupRole.manager,
      },
    });
    const rows = buildGroupProfileRows({
      context,
      data: context.routeData(),
      inputEditPush: vi.fn(),
      disbanded: false,
    });

    expect(rows[1].properties.showUpload).toBe(true);
    expect(rows[1].properties.isUploadedAvatar).toBe(true);
    expect(rows[1].properties.canClearUploadedAvatar).toBe(false);
  });

  it("builds thread setting sections for active thread channels", () => {
    const inputEditPush = vi.fn();
    const context = createThreadContext();

    const infoRows = buildThreadInfoSection(context, inputEditPush)?.rows;
    expect(infoRows).toHaveLength(3);
    expect(buildThreadMdSection(context)?.rows).toHaveLength(1);
    expect(buildThreadWebhookSection(context)?.rows).toHaveLength(1);
    const overviewRows = buildThreadOverviewSection(
      context,
      inputEditPush
    )?.rows;
    expect(overviewRows).toHaveLength(5);
    expect(overviewRows?.[3].properties.title).toBe("GROUP.md");
    expect(overviewRows?.[4].properties.title).toBe(
      t("base.threadPanel.webhook")
    );
    expect(buildThreadActionsSection(context)?.rows).toHaveLength(2);
  });

  it("uses only reliable thread participation data", () => {
    const context = createThreadContext({
      channelInfo: {
        title: "Thread 1",
        orgData: {
          member_count: 99,
          thread: {
            status: ThreadStatus.Active,
            name: "Thread 1",
            creator_uid: "alice",
            member_count: 6,
            is_member: false,
          },
        },
      },
    });
    const rows = buildThreadInfoSection(context, vi.fn())?.rows;

    expect(rows).toHaveLength(5);
    expect(rows?.[3].properties.value).toBe(
      t("base.module.thread.participantCountValue", { values: { count: 6 } })
    );
    expect(rows?.[4].properties.value).toBe(
      t("base.module.thread.participationStatusNotJoined")
    );
  });

  it("hides thread sections for group channels", () => {
    const inputEditPush = vi.fn();
    const context = createContext();

    expect(buildThreadInfoSection(context, inputEditPush)).toBeUndefined();
    expect(buildThreadMdSection(context)).toBeUndefined();
    expect(buildThreadWebhookSection(context)).toBeUndefined();
    expect(buildThreadOverviewSection(context, inputEditPush)).toBeUndefined();
    expect(buildThreadActionsSection(context)).toBeUndefined();
  });
});
