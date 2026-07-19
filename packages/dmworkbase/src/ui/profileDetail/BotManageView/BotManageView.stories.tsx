import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import BotManageView, {
  MentionFreeListView,
  type BotManageGroupItem,
  type BotManageViewLabels,
  type MentionFreeListViewProps,
} from "./index";

const labels: BotManageViewLabels = {
  mentionFree: "免@回答",
  mentionFreeHint: "选择哪些群里 Bot 不需要 @ 也会回答",
  autoApprove: "自动通过",
  autoApproveHint: "后续支持自动处理好友申请",
  profileCommands: "简介指令",
  profileCommandsHint: "后续支持管理 Bot 简介和指令",
  comingSoon: "即将上线",
  loading: "加载中...",
  backendComingSoon: "功能即将上线",
  stayTuned: "敬请期待",
  loadFailed: "加载失败",
  reload: "重新加载",
  searchPlaceholder: "搜索群聊",
  noSearchResult: "没有匹配的群聊",
  empty: "暂无群聊",
  sectionEnabled: (count) => `已开启免@回答 (${count})`,
  sectionOthers: "其他群聊",
  rowOn: "已开启免@回答",
  rowOff: "需要 @ 才回答",
  rowBlocked: "群管理员未允许免@",
};

const enabledGroups: BotManageGroupItem[] = [
  { groupNo: "group-1", name: "产品需求讨论组", noMention: true },
  {
    groupNo: "group-2",
    name: "Bot 自动化长群名用于验证溢出展示",
    noMention: true,
  },
];

const otherGroups: BotManageGroupItem[] = [
  { groupNo: "group-3", name: "研发协作群", noMention: false },
  { groupNo: "group-4", name: "客户支持群", noMention: false },
];

const longNameGroups: BotManageGroupItem[] = [
  {
    groupNo: "group-long",
    name: "这是一个非常非常长的群聊名称，用于验证 Bot 管理免@回答列表行不会挤压右侧开关",
    noMention: true,
  },
  {
    groupNo: "group-blocked",
    name: "管理员关闭免@能力的群",
    noMention: false,
    allowNoMention: false,
  },
];

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 360,
        height: 520,
        border: "1px solid var(--wk-border-default)",
      }}
    >
      {children}
    </div>
  );
}

function MentionFreeStory(args: Partial<MentionFreeListViewProps>) {
  const [searchKeyword, setSearchKeyword] = useState(args.searchKeyword ?? "");
  const [enabled, setEnabled] = useState(args.enabledGroups ?? enabledGroups);
  const [others, setOthers] = useState(args.otherGroups ?? otherGroups);

  const toggle = (groupNo: string, next: boolean) => {
    setEnabled((groups) =>
      groups.map((group) =>
        group.groupNo === groupNo ? { ...group, noMention: next } : group
      )
    );
    setOthers((groups) =>
      groups.map((group) =>
        group.groupNo === groupNo ? { ...group, noMention: next } : group
      )
    );
  };

  return (
    <StoryFrame>
      <MentionFreeListView
        labels={labels}
        loading={false}
        backendMissing={false}
        loadError={false}
        searchKeyword={searchKeyword}
        enabledGroups={enabled}
        otherGroups={others}
        loadingMore={false}
        onSearchKeywordChange={setSearchKeyword}
        onReload={() => undefined}
        onLoadMore={() => undefined}
        onToggleMentionFree={(groupNo, next) => toggle(groupNo, next)}
        {...args}
      />
    </StoryFrame>
  );
}

const meta = {
  title: "UI/ProfileDetail/BotManageView",
  component: BotManageView,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pure BotManage presentation components. Data loading, Service calls, route orchestration, and i18n resolution stay outside these UI components.",
      },
    },
  },
} satisfies Meta<typeof BotManageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Menu: Story = {
  render: () => (
    <StoryFrame>
      <BotManageView labels={labels} onOpenMentionFree={() => undefined} />
    </StoryFrame>
  ),
};

export const MentionFreeList: StoryObj<typeof MentionFreeStory> = {
  render: () => <MentionFreeStory />,
};

export const Loading: StoryObj<typeof MentionFreeStory> = {
  render: () => <MentionFreeStory loading />,
};

export const BackendComingSoon: StoryObj<typeof MentionFreeStory> = {
  render: () => <MentionFreeStory backendMissing />,
};

export const LoadError: StoryObj<typeof MentionFreeStory> = {
  render: () => <MentionFreeStory loadError />,
};

export const Empty: StoryObj<typeof MentionFreeStory> = {
  render: () => <MentionFreeStory enabledGroups={[]} otherGroups={[]} />,
};

export const NoSearchResult: StoryObj<typeof MentionFreeStory> = {
  render: () => (
    <MentionFreeStory
      searchKeyword="missing"
      enabledGroups={[]}
      otherGroups={[]}
    />
  ),
};

export const LoadingMore: StoryObj<typeof MentionFreeStory> = {
  render: () => <MentionFreeStory loadingMore />,
};

export const LongGroupName: StoryObj<typeof MentionFreeStory> = {
  render: () => (
    <MentionFreeStory
      enabledGroups={longNameGroups}
      otherGroups={otherGroups}
    />
  ),
};
