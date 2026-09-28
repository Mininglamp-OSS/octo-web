import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import WKButton from "../../../Components/WKButton";
import UserInfoView, {
  type UserInfoViewLabels,
  type UserInfoViewProps,
} from "./index";

const labels: UserInfoViewLabels = {
  remark: "备注",
  remarkPlaceholder: "请输入备注",
  editRemark: "编辑备注",
  cancel: "取消",
  save: "保存",
  notSet: "未设置",
};

function StoryAvatar({ text }: { text: string }) {
  return <div className="wk-userinfo-story-avatar">{text}</div>;
}

function StoryRow({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="wk-list-item wk-list-item-static">
      <div className="wk-list-item-title">{title}</div>
      <div className="wk-list-item-subtitle">{subtitle}</div>
    </div>
  );
}

const profileSections = [
  {
    rows: [
      {
        cell: StoryRow,
        properties: {
          title: "来源",
          subtitle: "通过群聊添加",
        },
        sort: 0,
      },
    ],
  },
] as UserInfoViewProps["sections"];

function UserInfoViewStory(args: Partial<UserInfoViewProps>) {
  const [remarkDraft, setRemarkDraft] = useState(args.remarkDraft ?? "Alice");
  const [phoneRevealed, setPhoneRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const phone = "+86 13800138000";
  const email = "alice@example.com";
  const contactItems = args.contactItems ?? [
    {
      label: "手机号",
      value: phoneRevealed ? (
        <button type="button" onClick={() => setCopyStatus("已复制手机号")}>
          {phone}
        </button>
      ) : (
        <button type="button" onClick={() => setPhoneRevealed(true)}>
          点击查看
        </button>
      ),
    },
    {
      label: "邮箱",
      value: (
        <button type="button" onClick={() => setCopyStatus("已复制邮箱")}>
          {email}
        </button>
      ),
    },
  ];

  return (
    <div className="wk-userinfo-story-frame">
      <UserInfoView
        loading={false}
        avatar={<StoryAvatar text="A" />}
        displayName="Alice Chen"
        isBot={false}
        isRealnameVerified
        metaItems={[
          { label: "Octo号", value: "octo_1001" },
        ]}
        contactItems={contactItems}
        showRemarkEditor
        editingRemark={false}
        remark="Alice"
        remarkDraft={remarkDraft}
        savingRemark={false}
        sections={profileSections}
        footerAction={
          <WKButton type="button" variant="primary">
            发送消息
          </WKButton>
        }
        labels={labels}
        onRemarkDraftChange={setRemarkDraft}
        onStartEditRemark={() => undefined}
        onCancelEditRemark={() => undefined}
        onSaveRemark={() => undefined}
        {...args}
      />
      <span role="status">{copyStatus}</span>
    </div>
  );
}

const meta = {
  title: "UI/ProfileDetail/UserInfoView",
  component: UserInfoViewStory,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pure user profile detail presentation component. Data loading, Service calls, and route orchestration stay outside this UI component.",
      },
    },
  },
} satisfies Meta<typeof UserInfoViewStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Friend: Story = {};

export const Stranger: Story = {
  args: {
    avatar: <StoryAvatar text="B" />,
    displayName: "Bob Lee",
    isRealnameVerified: false,
    remark: "",
    metaItems: [
      { label: "群昵称", value: "产品讨论组里的 Bob" },
      { label: "Octo号", value: "octo_2048" },
    ],
    footerAction: (
      <WKButton type="button" variant="secondary">
        添加好友
      </WKButton>
    ),
  },
};

export const Bot: Story = {
  args: {
    avatar: <StoryAvatar text="B" />,
    displayName: "BotFather",
    isBot: true,
    isRealnameVerified: false,
    remark: "Bot 管家",
    metaItems: [
      { label: "昵称", value: "BotFather" },
      { label: "Octo号", value: "bot_father" },
    ],
    footerAction: (
      <WKButton type="button" variant="primary">
        添加好友
      </WKButton>
    ),
  },
};

export const ExternalMember: Story = {
  args: {
    avatar: <StoryAvatar text="E" />,
    displayName: "External User",
    isRealnameVerified: true,
    remark: "外部协作人",
    metaItems: [
      { label: "昵称", value: "External User" },
      { label: "群昵称", value: "外部协作成员" },
    ],
    footerAction: undefined,
    footerHint: "外部成员仅可在群内交流",
  },
};

export const Editing: Story = {
  args: {
    editingRemark: true,
    remarkDraft: "新的备注",
  },
};

export const Loading: Story = {
  args: {
    loading: true,
    footerAction: undefined,
    footerHint: undefined,
  },
};
