import React, { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import BotDetailView, {
  type BotDetailViewLabels,
  type BotDetailViewProps,
} from "./index";

const labels: BotDetailViewLabels = {
  close: "关闭",
  changeAvatar: "更换头像",
  reported: "已上报 Agent 信息",
  notReported: "未上报 Agent 信息",
  reportHelp: "未上报时不可查看详情",
  help: "帮助",
  remark: "备注",
  noRemark: "未设置",
  remarkPlaceholder: "请输入备注",
  editRemark: "编辑备注",
  nickname: "昵称",
  description: "简介",
  editDescription: "编辑简介",
  edit: "编辑",
  descriptionPlaceholder: "请输入简介",
  noDescription: "暂无简介",
  creator: "创建者",
  commands: "指令",
  botManageTitle: "Bot 管理",
  viewClawInfo: "查看龙虾信息",
  sendMessage: "发送消息",
  addFriend: "添加好友",
  applyMessageLabel: "申请说明",
  applyMessagePlaceholder: "请输入申请说明",
  applySend: "发送申请",
  save: "保存",
  cancel: "取消",
};

function StoryAvatar({ text = "AI" }: { text?: string }) {
  return <div className="wk-bot-detail-story-avatar">{text}</div>;
}

function BotDetailViewStory(args: Partial<BotDetailViewProps>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [remarkDraft, setRemarkDraft] = useState(args.remarkDraft ?? "我的 Bot 管家");
  const [descriptionDraft, setDescriptionDraft] = useState(
    args.descriptionDraft ?? "用于创建、管理和配置团队内的 AI Bot。",
  );
  const [applyRemark, setApplyRemark] = useState(args.applyRemark ?? "希望添加这个 Bot");

  return (
    <div className="wk-bot-detail-modal wk-bot-detail-story">
      <BotDetailView
        loading={false}
        displayName="我的 Bot 管家"
        botName="BotFather"
        username="botfather"
        remark="我的 Bot 管家"
        displayDescription="用于创建、管理和配置团队内的 AI Bot。"
        creatorName="Alice Chen"
        commands={[
          { cmd: "/help", remark: "查看 Bot 能力说明" },
          { cmd: "/summarize", remark: "总结当前上下文中的重点信息" },
        ]}
        isOwner
        isFriend
        reported
        uploadingAvatar={false}
        editingRemark={false}
        remarkDraft={remarkDraft}
        savingRemark={false}
        editingDescription={false}
        descriptionDraft={descriptionDraft}
        savingDescription={false}
        showApplyInput={false}
        applyRemark={applyRemark}
        applying={false}
        ownerAvatar={<StoryAvatar />}
        previewAvatar={<StoryAvatar />}
        fileInputRef={fileInputRef}
        descriptionRef={descriptionRef}
        labels={labels}
        onClose={() => undefined}
        onAvatarClick={() => undefined}
        onAvatarKeyDown={() => undefined}
        onAvatarInputClick={() => undefined}
        onAvatarFileChange={() => undefined}
        onRemarkDraftChange={setRemarkDraft}
        onStartEditRemark={() => undefined}
        onEditRemarkKeyDown={() => undefined}
        onCancelEditRemark={() => undefined}
        onSaveRemark={() => undefined}
        onStartEditDescription={() => undefined}
        onEditDescriptionKeyDown={() => undefined}
        onDescriptionDraftChange={setDescriptionDraft}
        onDescriptionTranscribed={(text) => setDescriptionDraft(text)}
        getCurrentDescriptionText={() => descriptionDraft}
        onCancelEditDescription={() => undefined}
        onSaveDescription={() => undefined}
        onOpenBotManage={() => undefined}
        onViewClawInfo={() => undefined}
        onChat={() => undefined}
        onShowApply={() => undefined}
        onApplyRemarkChange={setApplyRemark}
        onSubmitApply={() => undefined}
        {...args}
      />
    </div>
  );
}

const meta = {
  title: "UI/ProfileDetail/BotDetailView",
  component: BotDetailViewStory,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pure Bot detail presentation component. Data loading, Service calls, and modal orchestration stay outside this UI component.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="wk-bot-detail-story-frame">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BotDetailViewStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OwnerFriend: Story = {};

export const StrangerApply: Story = {
  args: {
    displayName: "Research Helper",
    botName: "Research Helper",
    username: "research_helper",
    remark: "",
    creatorName: "",
    commands: [],
    isOwner: false,
    isFriend: false,
    reported: null,
    showApplyInput: true,
  },
};

export const Editing: Story = {
  args: {
    editingRemark: true,
    editingDescription: true,
    isFriend: false,
    showApplyInput: true,
  },
};

export const Loading: Story = {
  args: {
    loading: true,
  },
};
