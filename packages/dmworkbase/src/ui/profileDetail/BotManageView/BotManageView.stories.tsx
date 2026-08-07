import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import BotManageView, {
  CardSettingsView,
  MentionFreeListView,
  type BotCardSettingsLabels,
  type BotManageGroupItem,
  type BotManageViewLabels,
  type MentionFreeListViewProps,
} from "./index";
import type { BotCardSettingRow } from "../../../bridge/profileDetail/botCardSettings";

const labels: BotManageViewLabels = {
  mentionFree: "免@回答",
  mentionFreeHint: "选择哪些群里 Bot 不需要 @ 也会回答",
  cardSettings: "卡片消息能力",
  cardSettingsHint: "控制 Bot 能发哪些类型的卡片消息",
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

const cardLabels: BotCardSettingsLabels = {
  rowTitle: {
    "bot.display_enabled": "展示型卡片",
    "bot.interaction_enabled": "交互型卡片",
    "bot.reasoning_enabled": "推理过程卡片",
  },
  rowDesc: {
    "bot.display_enabled": "允许 Bot 发送纯展示的卡片消息",
    "bot.interaction_enabled": "允许 Bot 发送带按钮、表单等交互组件的卡片",
    "bot.reasoning_enabled": "允许 Bot 发送展示思考过程的卡片",
  },
  masterOffNotice: "当前部署已关闭 Bot 卡片消息，以下开关暂不生效",
  needsDisplayNotice: "需先开启展示型卡片才会生效",
  sourceBot: "已为该 Bot 自定义",
  sourceGlobal: "继承全局默认",
  sourceDefault: "继承系统默认",
  sourceEnv: "由部署环境决定",
  reset: "恢复默认",
  loading: "加载中...",
  loadFailed: "加载失败",
  reload: "重新加载",
  backendComingSoon: "功能即将上线",
  stayTuned: "敬请期待",
  unsupported: "该 Bot 类型暂不支持自定义，沿用系统默认设置",
  forbidden: "仅 Bot 创建者可修改此设置",
  empty: "暂无可配置项",
  saveFailed: "设置失败，请稍后再试",
  saveFailedRetryable: "服务暂时不可用，请稍后重试",
  rateLimited: "操作过于频繁，请稍后再试",
};

/**
 * 卡片消息能力 story 的本地状态机。
 *
 * 刻意复刻 buildRows 的核心规则，好让 story 能直观体现两条最容易踩的坑：
 *   - `checked` = 该项 effectiveValue **AND** 总闸，不是裸 effectiveValue；
 *   - `overridden`（value !== null）才出现「恢复默认」。
 */
function CardSettingsStory(args: {
  masterEnabled?: boolean;
  displayOff?: boolean;
  loadErrorKind?: string;
  writeErrorKind?: string;
} = {}) {
  const masterEnabled = args.masterEnabled ?? true;
  const [values, setValues] = useState<Record<string, boolean>>({
    "bot.display_enabled": !args.displayOff,
    "bot.interaction_enabled": true,
    "bot.reasoning_enabled": false,
  });
  const [overridden, setOverridden] = useState<Record<string, boolean>>({
    "bot.display_enabled": true,
    "bot.interaction_enabled": false,
    "bot.reasoning_enabled": false,
  });

  const sources: Record<string, string> = {
    "bot.display_enabled": overridden["bot.display_enabled"] ? "bot" : "global",
    "bot.interaction_enabled": overridden["bot.interaction_enabled"]
      ? "bot"
      : "global",
    "bot.reasoning_enabled": overridden["bot.reasoning_enabled"]
      ? "bot"
      : "default",
  };

  const rows: BotCardSettingRow[] = Object.keys(values).map((key) => ({
    key,
    effectiveValue: values[key],
    checked: values[key] && masterEnabled,
    overridden: overridden[key],
    source: sources[key],
    editable: true,
    pending: false,
    disabled: !masterEnabled,
    needsDisplay:
      key === "bot.interaction_enabled" && !values["bot.display_enabled"],
  }));

  return (
    <StoryFrame>
      <CardSettingsView
        labels={cardLabels}
        rows={rows}
        masterEnabled={masterEnabled}
        loading={false}
        hasData
        loadErrorKind={args.loadErrorKind}
        writeErrorKind={args.writeErrorKind}
        onToggle={(key, next) => {
          setValues((prev) => ({ ...prev, [key]: next }));
          setOverridden((prev) => ({ ...prev, [key]: true }));
        }}
        onReset={(key) => setOverridden((prev) => ({ ...prev, [key]: false }))}
        onReload={() => undefined}
      />
    </StoryFrame>
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
      <BotManageView
        labels={labels}
        onOpenMentionFree={() => undefined}
        onOpenCardSettings={() => undefined}
      />
    </StoryFrame>
  ),
};

/** 卡片消息能力：正常三行（display 显式覆盖 / interaction 继承全局 / reasoning 继承代码默认）。 */
export const CardSettings: StoryObj<typeof CardSettingsStory> = {
  render: () => <CardSettingsStory />,
};

/**
 * 部署级总闸关闭：三行全部置灰，顶部提示条。
 *
 * 注意 display 的 `effectiveValue` 仍是 true —— owner 接口不会替我们 AND 总闸，
 * 这正是「直接渲染 effective_value 会显示开、但一张卡也发不出」的场景。
 */
export const CardSettingsMasterOff: StoryObj<typeof CardSettingsStory> = {
  render: () => <CardSettingsStory masterEnabled={false} />,
};

/** 交互型卡片开着、展示型卡片关着 → 交互行挂依赖提示（开关仍可写）。 */
export const CardSettingsNeedsDisplay: StoryObj<typeof CardSettingsStory> = {
  render: () => <CardSettingsStory displayOff />,
};

/** err.server.robot.not_found：该 bot 无 robot 记录（含 App Bot），不给重试。 */
export const CardSettingsUnsupported: StoryObj<typeof CardSettingsStory> = {
  render: () => <CardSettingsStory loadErrorKind="unsupported" />,
};

/** 服务端错误（真实 500，线路状态码可能是 400）→ 提示重试而不是「参数有误」。 */
export const CardSettingsWriteRetryable: StoryObj<typeof CardSettingsStory> = {
  render: () => <CardSettingsStory writeErrorKind="retryable" />,
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
