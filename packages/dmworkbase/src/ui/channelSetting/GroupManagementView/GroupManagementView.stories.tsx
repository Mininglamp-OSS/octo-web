import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import GroupManagementView, {
  type GroupManagementMemberItem,
  type GroupManagementViewLabels,
  type GroupManagementViewProps,
} from "./index";

const labels: GroupManagementViewLabels = {
  loading: "加载中...",
  ownerAndManagers: "群主、管理员",
  botAdmins: "Bot 管理员",
  addManager: "添加管理员",
  addBotAdmin: "添加 Bot 管理员",
  owner: "群主",
  manager: "管理员",
  botAdmin: "Bot 管理员",
  emptyManagers: "暂无管理员",
  emptyBotAdmins: "暂无 Bot 管理员",
  memberManagement: "成员管理",
  memberManagementMeta: "共 21 名成员",
  allowNoMentionTitle: "Bot 免@回答",
  allowNoMentionLabel: "允许群内 Bot 免@回答",
  allowNoMentionDesc:
    "开启后，群内 Bot 在其主人允许免@时可不被@直接回答；关闭后，本群 Bot 即使主人设置了免@也必须被@才回答。",
  disbandAction: "解散群聊",
  disbandDesc: "解散后所有成员都将无法再发送消息，聊天记录仍可查看。",
  removeMember: "移除",
};

function MockAvatar({ text }: { text: string }) {
  return <span className="wk-group-management-story-avatar">{text}</span>;
}

const managers: GroupManagementMemberItem[] = [
  {
    id: "owner",
    name: "陈群主",
    avatar: <MockAvatar text="陈" />,
    role: "owner",
    canRemove: false,
  },
  {
    id: "manager-a",
    name: "王管理员",
    avatar: <MockAvatar text="王" />,
    role: "manager",
    canRemove: true,
  },
  {
    id: "manager-long",
    name: "一个非常非常长的管理员展示名称用于验证右侧操作不会被挤出面板",
    avatar: <MockAvatar text="长" />,
    role: "manager",
    canRemove: true,
  },
];

const botAdmins: GroupManagementMemberItem[] = [
  {
    id: "bot-a",
    name: "日报助手",
    avatar: <MockAvatar text="日" />,
    role: "botAdmin",
    canRemove: true,
  },
  {
    id: "bot-b",
    name: "自动化支持 Bot",
    avatar: <MockAvatar text="自" />,
    role: "botAdmin",
    canRemove: true,
  },
];

function StoryFrame({ children }: { children: React.ReactNode }) {
  return <div className="wk-group-management-story-frame">{children}</div>;
}

function GroupManagementStory(args: Partial<GroupManagementViewProps>) {
  const [allowNoMention, setAllowNoMention] = useState(
    args.allowNoMention ?? true
  );

  return (
    <StoryFrame>
      <GroupManagementView
        loading={false}
        managers={managers}
        botAdmins={botAdmins}
        allowNoMention={allowNoMention}
        allowNoMentionSaving={false}
        canManageManagers
        canManageBotAdmins
        canDisband
        labels={labels}
        onAddManager={() => undefined}
        onAddBotAdmin={() => undefined}
        onRemoveManager={() => undefined}
        onRemoveBotAdmin={() => undefined}
        onToggleAllowNoMention={setAllowNoMention}
        onDisband={() => undefined}
        {...args}
      />
    </StoryFrame>
  );
}

const meta: Meta<typeof GroupManagementView> = {
  title: "UI/ChannelSetting/GroupManagementView",
  component: GroupManagementView,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pure group management presentation component. Route navigation, confirm dialogs, toasts, Service calls, and SDK cache refresh stay in the GroupManagement container.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof GroupManagementView>;

export const OwnerView: Story = {
  render: () => <GroupManagementStory />,
};

export const ManagerView: Story = {
  render: () => (
    <GroupManagementStory
      managers={managers.map((item) => ({ ...item, canRemove: false }))}
      canManageManagers={false}
      canDisband={false}
    />
  ),
};

export const EmptyBotAdmins: Story = {
  render: () => <GroupManagementStory botAdmins={[]} />,
};

export const SavingSwitch: Story = {
  render: () => <GroupManagementStory allowNoMentionSaving />,
};

export const Loading: Story = {
  render: () => (
    <StoryFrame>
      <GroupManagementView
        loading
        managers={[]}
        botAdmins={[]}
        allowNoMention
        allowNoMentionSaving={false}
        canManageManagers={false}
        canManageBotAdmins={false}
        canDisband={false}
        labels={labels}
        onAddManager={() => undefined}
        onAddBotAdmin={() => undefined}
        onRemoveManager={() => undefined}
        onRemoveBotAdmin={() => undefined}
        onToggleAllowNoMention={() => undefined}
        onDisband={() => undefined}
      />
    </StoryFrame>
  ),
};
