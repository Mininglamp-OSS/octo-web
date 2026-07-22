import WKSDK from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
import {
  Channel,
  ChannelInfo,
  ChannelTypePerson,
  ChannelTypeGroup,
  ReminderType,
} from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { parseThreadChannelId } from "../../Service/Thread";
import React, { Component } from "react";
import { Tag, Toast } from "@douyinfe/semi-ui";
import { ConversationWrap, MessageWrap } from "../../Service/Model";
import { getTimeStringAutoShort2 } from "../../Utils/time";
import classNames from "classnames";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import "./index.css";

import WKApp from "../../App";
import { EndpointID } from "../../Service/Const";
import GroupIcon from "../Icons/GroupIcon";
import ThreadIcon from "../Icons/ThreadIcon";
import ContextMenus, {
  ContextMenusContext,
  ContextMenusData,
} from "../ContextMenus";
import { TypingListener, TypingManager } from "../../Service/TypingManager";
import { BeatLoader } from "react-spinners";
import { RevokeCell } from "../../Messages/Revoke";
import { FlameMessageCell } from "../../Messages/Flame";
import WKAvatar from "../WKAvatar";
import AiBadge from "../AiBadge";
import ConversationVM from "../Conversation/vm";
import { I18nContext, t, useI18n } from "../../i18n";
import { formatDraftPreview } from "../../Utils/draftPreview";
import { wkConfirm } from "../WKModal";
import { collapsedThreadUnread } from "./unread";
import {
  addImChannelInfoListener,
  fetchImChannelInfo,
  getImChannelInfo,
} from "../../im-runtime/channelRuntime";
import {
  muteChannelSetting,
  topChannelSetting,
} from "../../bridge/channelSetting/channelSettingActions";
export type ConvFilter = "all" | "human" | "ai" | "group" | "dm";

// ── 在线态判定/渲染 helper ──────────────────────────────────────────────
// 最近列表（非 compact）与关注/收藏列表（compact 的 CompactGroupItem）共用同一份
// 判定与 tip 文案，保证两处在线圆点的数据源、阈值、文案完全一致，避免逻辑复制漂移。

// 是否需要显示在线状态：在线，或离线时间在 1 小时内
export function needShowOnlineStatus(channelInfo?: ChannelInfo): boolean {
  if (!channelInfo) {
    return false;
  }
  if (channelInfo.online) {
    return true;
  }
  const nowTime = new Date().getTime() / 1000;
  const btwTime = nowTime - channelInfo.lastOffline;
  if (btwTime > 0 && btwTime < 60 * 60) {
    // 小于1小时才显示
    return true;
  }
  return false;
}

// 离线 tip 文案（在线时返回 undefined，badge 退化为纯绿点）
export function getOnlineTip(channelInfo: ChannelInfo): string | undefined {
  if (channelInfo.online) {
    return undefined;
  }
  const nowTime = new Date().getTime() / 1000;
  const btwTime = nowTime - channelInfo.lastOffline;
  if (btwTime < 60) {
    return t("base.conversationList.justNow");
  }
  return t("base.conversationList.minutesAgoShort", {
    values: { count: (btwTime / 60).toFixed(0) },
  });
}

// ── CompactGroupItem：群聊 Tab 紧凑 item，支持拖拽 ──────────────────────
interface CompactGroupItemProps {
  conversationWrap: ConversationWrap;
  selected: boolean;
  avatarKey?: string;
  onClick: () => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** 该群聊有子区，需要在 # icon 下方画竖线 */
  hasThreads?: boolean;
  onToggleThreads?: (e: React.MouseEvent) => void;
  /** 折叠时子区的未读数（展开时为 0） */
  threadUnread?: number;
}

const CompactGroupItem: React.FC<CompactGroupItemProps> = ({
  conversationWrap,
  selected,
  avatarKey,
  onClick,
  onDoubleClick,
  onContextMenu,
  hasThreads,
  onToggleThreads,
  threadUnread = 0,
}) => {
  const { t } = useI18n();
  const totalUnread = conversationWrap.unread + threadUnread;
  const hasMention = conversationWrap.isMentionMe && totalUnread > 0;
  const channelInfo = conversationWrap.channelInfo;
  // channelInfo 未加载时主动拉取，加载完触发 re-render
  React.useEffect(() => {
    if (!channelInfo) {
      void fetchImChannelInfo(WKSDK.shared(), conversationWrap.channel);
    }
  }, [conversationWrap.channel.channelID]);

  const isThread =
    conversationWrap.channel.channelType === ChannelTypeCommunityTopic;

  // effectiveMute 对齐后端 allowPush 降级逻辑：
  // - 子区有显式设置（thread.mute != null）→ 只看子区自身
  // - 子区未设置（thread.mute == null）→ 继承父群组 mute
  // - 群组：只看自身 mute
  const parentGroupNo = isThread
    ? (channelInfo?.orgData?.parentGroupNo as string | undefined)
    : undefined;
  const parentChannelInfo = parentGroupNo
    ? getImChannelInfo(
        WKSDK.shared(),
        new Channel(parentGroupNo, ChannelTypeGroup)
      )
    : undefined;
  const threadRawMute = isThread
    ? (channelInfo?.orgData?.thread as any)?.mute as number | null | undefined
    : undefined;
  const effectiveMute = isThread
    ? threadRawMute != null
      ? threadRawMute === 1          // 显式设置：只看子区自身
      : !!(parentChannelInfo?.mute)  // 未设置：继承父群
    : !!(channelInfo?.mute);         // 群组：只看自身

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      // 同一分组内 sort 与跨分组 move 共用 sortable id：item::<channelType>::<channelID>
      // handleDragEnd 通过 over 是 item / cat 判断分支。
      id: `item::${conversationWrap.channel.channelType}::${conversationWrap.channel.channelID}`,
      data: {
        type: "item",
        channelType: conversationWrap.channel.channelType,
        channelID: conversationWrap.channel.channelID,
        isThread,
      },
      // 子区跟随父频道，不独立拖拽 / 排序
      disabled: isThread,
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={classNames(
        "wk-conv-compact-item",
        selected ? "wk-conv-compact-item--selected" : undefined,
        totalUnread > 0 ? "wk-conv-compact-item--unread" : undefined,
        isThread ? "wk-conv-compact-item--thread" : undefined,
        isDragging ? "wk-conv-compact-item--dragging" : undefined,
        hasThreads ? "wk-conv-compact-item--has-threads" : undefined,
        effectiveMute ? "wk-conv-compact-item--muted" : undefined
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={
        onDoubleClick
          ? (e) => {
              if (e.detail >= 2) e.preventDefault();
            }
          : undefined
      }
      onContextMenu={onContextMenu}
    >
      {/* 拖拽 handle（非子区才显示） */}
      {!isThread && (
        <span
          className="wk-conv-compact-drag-handle"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
            <circle cx="3" cy="3" r="1.2" fill="currentColor" />
            <circle cx="7" cy="3" r="1.2" fill="currentColor" />
            <circle cx="3" cy="7" r="1.2" fill="currentColor" />
            <circle cx="7" cy="7" r="1.2" fill="currentColor" />
            <circle cx="3" cy="11" r="1.2" fill="currentColor" />
            <circle cx="7" cy="11" r="1.2" fill="currentColor" />
          </svg>
        </span>
      )}
      <span
        className={`wk-conv-compact-icon${
          totalUnread > 0 ? " wk-conv-compact-icon--reddot" : ""
        }`}
      >
        {isThread ? (
          <ThreadIcon size={13} />
        ) : (
          <WKAvatar
            key={avatarKey}
            channel={conversationWrap.channel}
          />
        )}
        {!isThread && channelInfo && needShowOnlineStatus(channelInfo) ? (
          <OnlineStatusBadge tip={getOnlineTip(channelInfo)}></OnlineStatusBadge>
        ) : undefined}
      </span>
      <span className="wk-conv-compact-name">
        {channelInfo?.orgData.displayName ? (
          channelInfo.orgData.displayName
        ) : isThread ? (
          <span className="wk-conv-compact-name-skeleton" />
        ) : (
          conversationWrap.channel.channelID
        )}
      </span>
      {conversationWrap.channel.channelType === ChannelTypeGroup &&
        channelInfo?.orgData?.is_external_group === 1 && (
          <span className="wk-conv-compact-external-badge" aria-label={t("base.conversationList.externalGroup")}>
            {t("base.conversationList.external")}
          </span>
        )}
      {effectiveMute && (
        <span className="wk-conv-compact-mute-icon">
          <svg
            className="icon"
            viewBox="0 0 1131 1024"
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
          >
            <path
              d="M914.688 892.736L64 236.224l38.784-50.88L271.36 315.648a300.288 300.288 0 0 1 246.976-157.952v-33.28c0-16.64 13.504-30.08 30.08-30.08h2.304c16.576 0 30.08 13.44 30.08 30.08v32.96a299.776 299.776 0 0 1 284.928 299.136v294.272l45.504 58.624 48.768 37.696-45.312 45.632zM234.624 480.384l506.88 391.232H140.416l94.272-121.536-0.064-269.696z"
              fill="#bfbfbf"
            />
          </svg>
        </span>
      )}
      {(hasMention || (totalUnread > 0 && !effectiveMute)) && (
        <span className="wk-conv-compact-badges">
          {hasMention && (
            <span className="wk-conv-compact-mention" aria-hidden="true">
              {t("base.conversationList.mentionMarker")}
            </span>
          )}
          {totalUnread > 0 && !effectiveMute && (
            <span className="wk-conv-compact-badge">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </span>
      )}
      {hasThreads && (
        <span
          className="wk-conv-compact-thread-tag"
          aria-label={t("base.conversationList.toggleThreads")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleThreads?.(e);
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#6569E8">
            <path d="M12 2.81a1 1 0 0 1 0-1.41l.36-.36a1 1 0 0 1 1.41 0l9.2 9.2a1 1 0 0 1 0 1.4l-.7.7a1 1 0 0 1-1.3.13l-9.54-6.72a1 1 0 0 1-.08-1.58l1-1L12 2.8ZM12 21.2a1 1 0 0 1 0 1.41l-.35.35a1 1 0 0 1-1.41 0l-9.2-9.19a1 1 0 0 1 0-1.41l.7-.7a1 1 0 0 1 1.3-.12l9.54 6.72a1 1 0 0 1 .07 1.58l-1 1 .35.36ZM15.66 16.8a1 1 0 0 1-1.38.28l-8.49-5.66A1 1 0 1 1 6.9 9.76l8.49 5.65a1 1 0 0 1 .27 1.39ZM17.1 14.25a1 1 0 1 0 1.11-1.66L9.73 6.93a1 1 0 0 0-1.11 1.66l8.49 5.66Z" />
          </svg>
        </span>
      )}
    </div>
  );
};
// ────────────────────────────────────────────────────────────────────────────

export interface ConversationListProps {
  conversations: ConversationWrap[];
  select?: Channel;
  /** 外部控制过滤，不传则内部默认 'all' */
  filter?: ConvFilter;
  /** 紧凑模式：隐藏头像/消息预览/时间戳，显示 # icon，用于群聊 Tab */
  compact?: boolean;
  onClick?: (conversation: ConversationWrap) => void;
  onClearMessages?: (channel: Channel) => void;
  /** 点击 "+N 个子区" 时的回调，传入父群组 ID */
  onThreadOverflowClick?: (groupNo: string) => void;
  /** 外部注入的额外右键菜单项，追加到内置菜单之后 */
  extraContextMenus?: (
    conversation: ConversationWrap | undefined
  ) => ContextMenusData[];
  /** 隐藏右键菜单的「关闭聊天窗口」项（关注 tab 不展示该入口，PM #337） */
  hideCloseChat?: boolean;
  /** 关闭按 channelInfo.top 拆分置顶 / 普通两段的渲染逻辑。
   *  关注 tab 里会话顺序由 /v2/follow/sort 决定（sidebar 给的 follow_sort），
   *  pin 只是标记不影响位置，关闭后保持 caller 传入的顺序原样渲染。 */
  disablePinSplit?: boolean;
  /** 隐藏「置顶/取消置顶」菜单项 + 行尾图钉图标。关注 tab 用手动拖拽排序，
   *  pin 与拖拽语义冲突（pin 会强制顶到分组顶端覆盖手动顺序），所以在关注 tab 移除 pin 入口。
   *  最近 tab 仍保留 pin。 */
  hidePin?: boolean;
  /** 递增 token：变化时滚到第一条 shouldScrollToUnreadTarget 命中的会话 */
  scrollToUnreadToken?: number;
  /** 外部提供导航目标口径，避免列表层重复理解具体业务规则 */
  shouldScrollToUnreadTarget?: (conversation: ConversationWrap) => boolean;
}

export interface ConversationListState {
  selectConversationWrap?: ConversationWrap;
  /** compact 模式：已展开全部子区的父群聊 ID 集合（点击 +N 后加入） */
  expandedGroupIds: Set<string>;
  locatingUnreadKey?: string;
  locatingUnreadPulse: number;
}

export default class ConversationList extends Component<
  ConversationListProps,
  ConversationListState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  channelListener!: ChannelInfoListener;
  contextMenusContext!: ContextMenusContext;
  typingListener!: TypingListener;
  private unsubscribeChannelInfoListener?: () => void;
  private listRef = React.createRef<HTMLDivElement>();
  private itemRefs = new Map<string, HTMLDivElement>();
  private lastRenderableItems: ConversationWrap[] = [];
  private scrollFrame: number | null = null;
  private unreadNudgeTimer: number | null = null;
  private _storageKey(): string {
    const uid = WKApp.loginInfo?.uid || 'unknown';
    const spaceId = WKApp.shared?.currentSpaceId || 'default';
    return `wk-thread-expanded-groups_${uid}_${spaceId}`;
  }

  constructor(props: ConversationListProps) {
    super(props);

    // 从 localStorage 恢复上次的展开状态
    let restoredIds: Set<string>;
    try {
      const raw = localStorage.getItem(this._storageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      restoredIds = Array.isArray(parsed) ? new Set<string>(parsed) : new Set();
    } catch {
      restoredIds = new Set();
    }
    this.state = {
      expandedGroupIds: restoredIds,
      locatingUnreadKey: undefined,
      locatingUnreadPulse: 0,
    };
  }

  componentDidMount() {
    this.channelListener = (channelInfo: ChannelInfo) => {
      this.setState({});
    };
    this.unsubscribeChannelInfoListener = addImChannelInfoListener(
      WKSDK.shared(),
      this.channelListener
    );

    this.typingListener = (channel: Channel, add: boolean) => {
      this.setState({});
    };
    TypingManager.shared.addTypingListener(this.typingListener);
  }

  componentDidUpdate(prevProps: ConversationListProps) {
    if (
      this.props.scrollToUnreadToken !== undefined &&
      this.props.scrollToUnreadToken !== prevProps.scrollToUnreadToken
    ) {
      this.scheduleScrollToFirstUnreadTarget();
    }
  }

  componentWillUnmount() {
    if (
      this.scrollFrame !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = null;
    }
    if (
      this.unreadNudgeTimer !== null &&
      typeof window !== "undefined" &&
      typeof window.clearTimeout === "function"
    ) {
      window.clearTimeout(this.unreadNudgeTimer);
      this.unreadNudgeTimer = null;
    }
    this.unsubscribeChannelInfoListener?.();
    this.unsubscribeChannelInfoListener = undefined;
    TypingManager.shared.removeTypingListener(this.typingListener);
  }

  private setConversationItemRef(
    conversationWrap: ConversationWrap,
    node: HTMLDivElement | null
  ) {
    const key = conversationWrap.channel.getChannelKey();
    if (node) {
      this.itemRefs.set(key, node);
    } else {
      this.itemRefs.delete(key);
    }
  }

  private scheduleScrollToFirstUnreadTarget() {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      this.scrollToFirstUnreadTarget();
      return;
    }

    if (this.scrollFrame !== null) {
      window.cancelAnimationFrame(this.scrollFrame);
    }
    this.scrollFrame = window.requestAnimationFrame(() => {
      this.scrollFrame = null;
      this.scrollToFirstUnreadTarget();
    });
  }

  private scrollToFirstUnreadTarget() {
    const root = this.listRef.current;
    const shouldTarget = this.props.shouldScrollToUnreadTarget;
    if (!root || !shouldTarget) return;

    const target = this.lastRenderableItems.find((conv) => shouldTarget(conv));
    if (!target) return;

    const node = this.itemRefs.get(target.channel.getChannelKey());
    if (!node) return;

    const rootRect = root.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const targetTop = Math.max(0, root.scrollTop + nodeRect.top - rootRect.top);

    if (typeof root.scrollTo === "function") {
      root.scrollTo({
        top: targetTop,
        behavior: "smooth",
      });
    } else {
      root.scrollTop = targetTop;
    }

    this.nudgeUnreadBadge(target.channel.getChannelKey());
  }

  private nudgeUnreadBadge(channelKey: string) {
    if (
      this.unreadNudgeTimer !== null &&
      typeof window !== "undefined" &&
      typeof window.clearTimeout === "function"
    ) {
      window.clearTimeout(this.unreadNudgeTimer);
      this.unreadNudgeTimer = null;
    }

    this.setState((state) => ({
      locatingUnreadKey: channelKey,
      locatingUnreadPulse: state.locatingUnreadPulse + 1,
    }));

    if (
      typeof window === "undefined" ||
      typeof window.setTimeout !== "function"
    ) {
      return;
    }

    this.unreadNudgeTimer = window.setTimeout(() => {
      this.unreadNudgeTimer = null;
      this.setState({ locatingUnreadKey: undefined });
    }, 700);
  }

  // 子区是否展开。
  // - 关注 tab（disablePinSplit）：默认展开，expandedGroupIds 记录"被用户折叠的"（反转语义）
  // - 其他 tab：默认折叠，expandedGroupIds 记录"被用户展开的"
  _isThreadExpanded = (parentGroupId: string): boolean => {
    const inSet = this.state.expandedGroupIds.has(parentGroupId);
    return this.props.disablePinSplit ? !inSet : inSet;
  };

  _handleScroll = () => {
    this.contextMenusContext.hide();
  };

  _toggleGroupExpand = (groupId: string) => {
    this.setState(
      (s) => {
        const next = new Set(s.expandedGroupIds);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return { expandedGroupIds: next };
      },
      () => {
        // setState 回调中执行副作用，避免在 updater 纯函数内写 localStorage
        try {
          localStorage.setItem(
            this._storageKey(),
            JSON.stringify([...this.state.expandedGroupIds])
          );
        } catch {
          // localStorage 不可用时静默忽略
        }
      }
    );
  };

  _handleContextMenu(
    conversationWrap: ConversationWrap,
    event: React.MouseEvent
  ) {
    this.contextMenusContext.show(event);
    this.setState({
      selectConversationWrap: conversationWrap,
    });
  }

  _getTypingUI(conversationWrap: ConversationWrap) {
    const { select } = this.props;
    const typing = TypingManager.shared.getTyping(conversationWrap.channel);
    const selected = select && select.isEqual(conversationWrap.channel);
    return (
      <div className="wk-typing">
        <BeatLoader
          size={4}
          margin={3}
          color={selected ? "white" : "var(--wk-color-theme)"}
        />
        &nbsp;&nbsp;
        {conversationWrap.channel.channelType !== ChannelTypePerson
          ? typing?.fromName
          : ""}
        {t("base.conversationList.typing")}
      </div>
    );
  }

  lastContent(conversationWrap: ConversationWrap) {
    const draft = conversationWrap.remoteExtra.draft;
    if (draft && draft !== "") {
      return formatDraftPreview(draft);
    }
    if (!conversationWrap.lastMessage) {
      return;
    }
    // 检查是否有进行中的 AI 折叠 session
    const foldPreview = ConversationVM.foldSessionPreview.get(
      conversationWrap.channel.getChannelKey()
    );
    if (foldPreview) {
      return (
        <span className="wk-ai-collab-preview">
          <span className="wk-ai-collab-tag">
            <span className="wk-ai-collab-pulse" />
            {t("base.conversationList.aiCollaborating")}
          </span>
          <span className="wk-ai-collab-text">
            {t("base.conversationList.aiCollabCount", {
              values: {
                participants: foldPreview.participants.join(" × "),
                count: foldPreview.count,
              },
            })}
          </span>
        </span>
      );
    }
    const lastMessage = new MessageWrap(conversationWrap.lastMessage);
    if (lastMessage.isDeleted) {
      return "";
    }
    if (lastMessage.revoke) {
      return RevokeCell.tip(lastMessage);
    }
    if (lastMessage.flame) {
      return FlameMessageCell.tip(lastMessage);
    }
    if (lastMessage.channel.channelType === ChannelTypePerson) {
      return lastMessage.content?.conversationDigest;
    } else {
      // 群组和子区频道都显示发送者名称
      let from = "";
      if (lastMessage.fromUID && lastMessage.fromUID !== "") {
        const fromChannel = new Channel(lastMessage.fromUID, ChannelTypePerson);
        const fromChannelInfo =
          getImChannelInfo(WKSDK.shared(), fromChannel);
        if (fromChannelInfo) {
          from = `${fromChannelInfo.title}: `;
        } else {
          void fetchImChannelInfo(WKSDK.shared(), fromChannel);
        }
      }

      return `${from}${lastMessage.content?.conversationDigest || ""}`;
    }
  }

  getOnlineTip(channelInfo: ChannelInfo) {
    return getOnlineTip(channelInfo);
  }

  // 是否需要显示在线状态
  needShowOnlineStatus(channelInfo?: ChannelInfo) {
    return needShowOnlineStatus(channelInfo);
  }

  conversationItem(
    conversationWrap: ConversationWrap,
    hasThreads = false,
    threadUnread = 0
  ) {
    let channelInfo = conversationWrap.channelInfo;
    if (!channelInfo) {
      void fetchImChannelInfo(WKSDK.shared(), conversationWrap.channel);
    }

    const { compact } = this.props;
    const avatarKey = WKApp.shared.getChannelAvatarTag(
      conversationWrap.channel
    );
    const isThread =
      conversationWrap.channel.channelType === ChannelTypeCommunityTopic;
    // 非 compact（最近 tab）下子区按时间扁平展示，需要拿父频道 displayName 做面包屑、
    // 父频道头像作为左侧图标。父群信息可能还没拉到，主动 fetch，依赖 channelListener 触发重渲染。
    const parentGroupNo = isThread
      ? (channelInfo?.orgData?.parentGroupNo as string | undefined) ||
        parseThreadChannelId(conversationWrap.channel.channelID)?.groupNo
      : undefined;
    const parentChannel = parentGroupNo
      ? new Channel(parentGroupNo, ChannelTypeGroup)
      : undefined;
    const parentChannelInfo = parentChannel
      ? getImChannelInfo(WKSDK.shared(), parentChannel)
      : undefined;
    if (parentChannel && !parentChannelInfo) {
      void fetchImChannelInfo(WKSDK.shared(), parentChannel);
    }

    // ── Compact 模式（群聊 Tab）：用 CompactGroupItem 函数组件（支持拖拽） ──
    if (compact) {
      const selected = !!(
        this.props.select && this.props.select.isEqual(conversationWrap.channel)
      );
      return (
        <CompactGroupItem
          key={conversationWrap.channel.getChannelKey()}
          conversationWrap={conversationWrap}
          selected={selected}
          avatarKey={avatarKey}
          hasThreads={hasThreads}
          threadUnread={threadUnread}
          onClick={() => {
            if (this.props.onClick) this.props.onClick(conversationWrap);
          }}
          onDoubleClick={
            conversationWrap.channel.channelType === ChannelTypeGroup &&
            hasThreads
              ? (e) => {
                  e.preventDefault();
                  this._toggleGroupExpand(conversationWrap.channel.channelID);
                }
              : undefined
          }
          onToggleThreads={
            conversationWrap.channel.channelType === ChannelTypeGroup &&
            hasThreads
              ? (e) => {
                  e.preventDefault();
                  this._toggleGroupExpand(conversationWrap.channel.channelID);
                }
              : undefined
          }
          onContextMenu={(e) => {
            this._handleContextMenu(conversationWrap, e);
          }}
        />
      );
    }

    const { select, onClick } = this.props;
    const { locatingUnreadKey, locatingUnreadPulse } = this.state;
    const typing = TypingManager.shared.getTyping(conversationWrap.channel);
    const selected = select && select.isEqual(conversationWrap.channel);
    // compact mode nests collapsed threads under the parent group, so the
    // parent item receives the collapsed unread count. Recent mode renders
    // threads as independent rows and must keep parent unread independent.
    const totalUnread = conversationWrap.unread + threadUnread;
    const hasMention = conversationWrap.isMentionMe && totalUnread > 0;
    const visibleSimpleReminders = conversationWrap.simpleReminders?.filter(
      (r) => !r.done && r.reminderType !== ReminderType.ReminderTypeMentionMe
    );
    // 子区静音继承父群（与 CompactGroupItem 保持一致）：显式设置看自身，未设置看父群
    const threadRawMute = isThread
      ? ((channelInfo?.orgData?.thread as any)?.mute as number | null | undefined)
      : undefined;
    const effectiveMute = isThread
      ? threadRawMute != null
        ? threadRawMute === 1
        : !!parentChannelInfo?.mute
      : !!channelInfo?.mute;
    // 非 compact 下子区按 design v3.1 走扁平时间序，左侧用父频道头像，
    // 不再套 .wk-conversationlist-item-thread（避免缩进 + 树形连接线视觉嵌套）。
    const avatarChannel = isThread && parentChannel ? parentChannel : conversationWrap.channel;
    const isDM = avatarChannel.channelType === ChannelTypePerson;
    const unreadNudgeClass =
      locatingUnreadKey === conversationWrap.channel.getChannelKey()
        ? locatingUnreadPulse % 2 === 0
          ? "wk-conv-unread-num--nudge-a"
          : "wk-conv-unread-num--nudge-b"
        : undefined;
    return (
      <div
        ref={(node) => this.setConversationItemRef(conversationWrap, node)}
        key={conversationWrap.channel.getChannelKey()}
        onClick={() => {
          if (onClick) {
            onClick(conversationWrap);
          }
        }}
        className={classNames(
          "wk-conversationlist-item",
          selected ? "wk-conversationlist-item-selected" : undefined,
          channelInfo?.top ? "wk-conversationlist-item-top" : undefined,
          totalUnread > 0
            ? "wk-conversationlist-item-unread"
            : undefined,
          effectiveMute ? "wk-conversationlist-item-muted" : undefined,
          isDM ? "wk-conversationlist-item-dm" : undefined
        )}
        onContextMenu={(e) => {
          this._handleContextMenu(conversationWrap, e);
        }}
      >
        <div className="wk-conversationlist-item-content">
          <div className="wk-conversationlist-item-left">
            <div className="wk-conversationlist-item-avatar-box">
              <WKAvatar
                channel={avatarChannel}
                key={avatarKey}
              ></WKAvatar>
              {hasThreads && (
                <div className="wk-conv-group-hash-badge">
                  <GroupIcon size={10} />
                </div>
              )}
              {!isThread && channelInfo && this.needShowOnlineStatus(channelInfo) ? (
                <OnlineStatusBadge
                  tip={this.getOnlineTip(channelInfo)}
                ></OnlineStatusBadge>
              ) : undefined}
            </div>
          </div>
          <div className="wk-conversationlist-item-right">
            {isThread && parentChannelInfo?.orgData?.displayName && (
              <div className="wk-conv-breadcrumb">
                {parentChannelInfo.orgData.displayName}
              </div>
            )}
            <div className="wk-conversationlist-item-right-first-line">
              <div className="wk-conversationlist-item-name">
                <h3>
                  {conversationWrap.channel.channelType ===
                    ChannelTypeCommunityTopic && (
                    <ThreadIcon
                      size={13}
                      className="wk-conv-channel-icon wk-conv-thread-icon"
                    />
                  )}
                  {channelInfo?.orgData.displayName}
                </h3>
                {conversationWrap.channel.channelType === ChannelTypeGroup &&
                  channelInfo?.orgData?.is_external_group === 1 && (
                    <Tag
                      size="small"
                      color="purple"
                      className="wk-conversationlist-item-external-tag"
                    >
                      {t("base.conversationList.external")}
                    </Tag>
                  )}
                {channelInfo?.orgData?.robot === 1 && <AiBadge />}
                {channelInfo?.orgData.identityIcon ? (
                  <img
                    style={{
                      width: channelInfo?.orgData?.identitySize.width,
                      height: channelInfo?.orgData?.identitySize.height,
                    }}
                    src={channelInfo?.orgData.identityIcon}
                  ></img>
                ) : undefined}
                {effectiveMute && (
                  <span className="wk-conv-mute-icon" aria-label={t("base.conversationList.doNotDisturb")}>
                    <svg
                      viewBox="0 0 1131 1024"
                      width="11"
                      height="11"
                    >
                      <path
                        d="M914.688 892.736L64 236.224l38.784-50.88L271.36 315.648a300.288 300.288 0 0 1 246.976-157.952v-33.28c0-16.64 13.504-30.08 30.08-30.08h2.304c16.576 0 30.08 13.44 30.08 30.08v32.96a299.776 299.776 0 0 1 284.928 299.136v294.272l45.504 58.624 48.768 37.696-45.312 45.632zM234.624 480.384l506.88 391.232H140.416l94.272-121.536-0.064-269.696z"
                        fill="currentColor"
                      ></path>
                    </svg>
                  </span>
                )}
                <div className="wk-conversationlist-item-time">
                  <span>
                    {getTimeStringAutoShort2(
                      conversationWrap.timestamp * 1000,
                      true
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="wk-conversationlist-item-right-second-line">
              <div className="wk-conversationlist-item-lastmsg">
                {!typing ? (
                  <label
                    className="wk-reminder"
                    style={{
                      display: conversationWrap.remoteExtra.draft
                        ? undefined
                        : "none",
                    }}
                  >
                    {t("base.conversationList.draft")}
                  </label>
                ) : undefined}
                {visibleSimpleReminders &&
                !typing &&
                visibleSimpleReminders.length > 0
                  ? visibleSimpleReminders.map((r) => {
                      return (
                        <label key={r.reminderID} className="wk-reminder">
                          {r.text}
                        </label>
                      );
                    })
                  : undefined}
                {typing
                  ? this._getTypingUI(conversationWrap)
                  : this.lastContent(conversationWrap)}
              </div>
              {(hasMention || totalUnread > 0) && (
                <span className="wk-conversationlist-item-indicators">
                  {hasMention && (
                    <span className="wk-mention" aria-hidden="true">
                      {t("base.conversationList.mentionMarker")}
                    </span>
                  )}
                  {totalUnread > 0 && (
                    <span
                      className={classNames(
                        "wk-conv-unread-num",
                        effectiveMute ? "wk-conv-unread-num--muted" : undefined,
                        unreadNudgeClass
                      )}
                    >
                      {totalUnread > 99 ? "99+" : totalUnread}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  onTop(channelInfo: ChannelInfo) {
    topChannelSetting({
      channel: channelInfo.channel,
      top: !channelInfo.top,
    })
      .catch((err) => {
        Toast.error(err?.msg);
      });
  }

  onMute(channelInfo: ChannelInfo) {
    this.onMuteWithValue(!channelInfo.mute, channelInfo)
  }

  onMuteWithValue(value: boolean, channelInfo: ChannelInfo) {
    muteChannelSetting({
      channel: channelInfo.channel,
      mute: value,
    })
      .then(() => {
        // 直接重拉（不删缓存），新数据覆盖旧缓存，避免删除期间出现 loading 骨架
        fetchImChannelInfo(WKSDK.shared(), channelInfo.channel)
          .then(() => this.setState({}))
      })
      .catch((err) => {
        Toast.error(err?.msg);
      });
  }

  onCloseChat(channel: Channel) {
    // 关闭聊天
    WKApp.conversationProvider.deleteConversation(channel);
  }

  async onClearMessages(channel: Channel) {
    if (this.props.onClearMessages) {
      this.props.onClearMessages(channel);
    }
  }

  filterConversation(conv: ConversationWrap): boolean {
    const filter = this.props.filter ?? "all";
    if (filter === "all") return true;
    const channelInfo = conv.channelInfo;
    // 群组和子区频道都归类到 group 过滤器
    if (filter === "group")
      return (
        conv.channel.channelType === ChannelTypeGroup ||
        conv.channel.channelType === ChannelTypeCommunityTopic
      );
    // dm = human + ai（私聊 Tab 包含所有私聊会话）
    if (filter === "dm") return conv.channel.channelType === ChannelTypePerson;
    if (filter === "ai") {
      if (conv.channel.channelType !== ChannelTypePerson) return false;
      // channelInfo 未加载时隐藏，等 channelInfoListener 触发重渲后再显示
      if (!channelInfo) return false;
      return channelInfo.orgData?.robot === 1;
    }
    if (filter === "human") {
      if (conv.channel.channelType !== ChannelTypePerson) return false;
      // channelInfo 未加载时暂时归入 human，channelInfoListener 更新后自动修正
      if (!channelInfo) return true;
      return channelInfo.orgData?.robot !== 1;
    }
    return true;
  }

  // 收集每个父群组下的子区列表（不重排），compact 模式下基于此再做嵌套；
  // 非 compact（最近 tab）只用它给父群组打 hash badge / 算菜单展开态。
  private buildThreadsByParent(
    convs: ConversationWrap[]
  ): Map<string, ConversationWrap[]> {
    const threadsByParent = new Map<string, ConversationWrap[]>();
    for (const conv of convs) {
      if (conv.channel.channelType === ChannelTypeCommunityTopic) {
        const parentGroupNo =
          conv.channelInfo?.orgData?.parentGroupNo ||
          parseThreadChannelId(conv.channel.channelID)?.groupNo;
        if (parentGroupNo) {
          const list = threadsByParent.get(parentGroupNo) || [];
          list.push(conv);
          threadsByParent.set(parentGroupNo, list);
        }
      }
    }
    return threadsByParent;
  }

  // 将子区放在父群组后面。maxVisibleThreads 控制默认可见数：
  // - 0 = 全部收起（最近 tab / 群聊 tab）
  // - Infinity = 全部展开（关注 tab，PR #208 行为）
  private groupThreadsWithParent(
    convs: ConversationWrap[],
    maxVisibleThreads: number = 0,
    keepOrphanThreads: boolean = false,
  ): {
    items: Array<
      | ConversationWrap
      | {
          type: "thread-overflow";
          parentGroupId: string;
          count: number;
          unreadCount: number;
        }
    >;
    threadsByParent: Map<string, ConversationWrap[]>;
  } {
    const MAX_VISIBLE_THREADS = maxVisibleThreads;

    // 分离群组和子区
    const threads: ConversationWrap[] = [];

    for (const conv of convs) {
      if (conv.channel.channelType === ChannelTypeCommunityTopic) {
        threads.push(conv);
      }
    }

    // 按父群组分组子区
    const threadsByParent = new Map<string, ConversationWrap[]>();
    for (const thread of threads) {
      const parentGroupNo =
        thread.channelInfo?.orgData?.parentGroupNo ||
        parseThreadChannelId(thread.channel.channelID)?.groupNo;
      if (parentGroupNo) {
        const list = threadsByParent.get(parentGroupNo) || [];
        list.push(thread);
        threadsByParent.set(parentGroupNo, list);
      }
    }

    // 重新组织：群组后面跟着其子区（默认全收起）
    const result: Array<
      | ConversationWrap
      | {
          type: "thread-overflow";
          parentGroupId: string;
          count: number;
          unreadCount: number;
        }
    > = [];
    const usedThreads = new Set<string>();

    // 预计算列表中存在的群组 ID（用于判断子区是否孤儿）
    const groupIdsInList = new Set(
      convs
        .filter((c) => c.channel.channelType === ChannelTypeGroup)
        .map((c) => c.channel.channelID)
    );

    for (const conv of convs) {
      if (conv.channel.channelType === ChannelTypeCommunityTopic) {
        // 子区：父群在列表中 → 跳过（在父群后面统一添加）；
        // 孤儿子区（父群不在列表）+ 关注 tab → 在原位保留为独立条目（保持 follow_sort 顺序）
        if (usedThreads.has(conv.channel.channelID)) continue;
        const parentGroupNo =
          conv.channelInfo?.orgData?.parentGroupNo ||
          parseThreadChannelId(conv.channel.channelID)?.groupNo;
        const parentInList = !!parentGroupNo && groupIdsInList.has(parentGroupNo);
        if (!parentInList && keepOrphanThreads) {
          result.push(conv);
          usedThreads.add(conv.channel.channelID);
        }
        continue;
      }
      result.push(conv);
      // 如果是群组，子区默认全部折叠进 overflow
      if (conv.channel.channelType === ChannelTypeGroup) {
        const groupThreads = threadsByParent.get(conv.channel.channelID) || [];
        const visibleThreads = groupThreads.slice(0, MAX_VISIBLE_THREADS);
        const overflowCount = groupThreads.length - MAX_VISIBLE_THREADS;

        // 标记所有已分组的子区（包括溢出的）为已使用
        for (const thread of groupThreads) {
          usedThreads.add(thread.channel.channelID);
        }

        for (const thread of visibleThreads) {
          result.push(thread);
        }

        // 如果有超出的子区，添加溢出提示
        if (overflowCount > 0) {
          // 计算溢出子区的总未读数
          const overflowThreads = groupThreads.slice(MAX_VISIBLE_THREADS);
          const overflowUnread = overflowThreads.reduce(
            (sum, t) => sum + t.unread,
            0
          );

          result.push({
            type: "thread-overflow",
            parentGroupId: conv.channel.channelID,
            count: overflowCount,
            unreadCount: overflowUnread,
          });
        }
      }
    }

    // 父群在列表但子区未被分组的兜底（理论上不应出现）
    for (const thread of threads) {
      if (!usedThreads.has(thread.channel.channelID)) {
        const parentGroupNo =
          thread.channelInfo?.orgData?.parentGroupNo ||
          parseThreadChannelId(thread.channel.channelID)?.groupNo;
        if (parentGroupNo && groupIdsInList.has(parentGroupNo)) {
          result.push(thread);
        }
        // 孤儿子区已在主循环原位处理；其他 tab 父群不在列表 → 隐藏
      }
    }

    return { items: result, threadsByParent };
  }

  render() {
    const { conversations, select, compact } = this.props;
    const { selectConversationWrap } = this.state;

    const filtered =
      conversations?.filter((c) => this.filterConversation(c)) ?? [];

    // compact（关注 tab）：把子区按父群嵌套；
    // 非 compact（最近 tab，design v3.1）：扁平按时间序，子区作为独立条目自带父频道面包屑。
    type GroupedItem =
      | ConversationWrap
      | {
          type: "thread-overflow";
          parentGroupId: string;
          count: number;
          unreadCount: number;
        };
    let grouped: GroupedItem[];
    let threadsByParent: Map<string, ConversationWrap[]>;
    if (compact) {
      // 关注 tab：默认展开子区 + 保留孤儿子区（PR #208）
      const r = this.groupThreadsWithParent(
        filtered,
        0,
        this.props.disablePinSplit ?? false,
      );
      grouped = r.items;
      threadsByParent = r.threadsByParent;
    } else {
      grouped = filtered;
      threadsByParent = this.buildThreadsByParent(filtered);
    }
    const groupedPinned = grouped.filter((item) => {
      if ("type" in item) return false;
      return (item as ConversationWrap).channelInfo?.top;
    });

    // 子区和溢出提示跟随父群组：如果父群组被置顶，把它的子区也移到置顶区
    const pinnedGroupIds = new Set(
      groupedPinned
        .filter(
          (item) =>
            !("type" in item) &&
            (item as ConversationWrap).channel.channelType === ChannelTypeGroup
        )
        .map((item) => (item as ConversationWrap).channel.channelID)
    );
    const finalPinned: typeof grouped = [];
    const finalRecent: typeof grouped = [];
    if (this.props.disablePinSplit) {
      // 关注 tab 顺序由 sidebar 的 follow_sort 决定，不按 pin 状态拆段
      finalRecent.push(...grouped);
    } else {
    for (const item of grouped) {
      if ("type" in item) {
        // thread-overflow 跟随父群组
        if (pinnedGroupIds.has(item.parentGroupId)) {
          finalPinned.push(item);
        } else {
          finalRecent.push(item);
        }
      } else {
        const conv = item as ConversationWrap;
        if (conv.channelInfo?.top) {
          finalPinned.push(item);
        } else if (compact && conv.channel.channelType === ChannelTypeCommunityTopic) {
          // compact 嵌套语义：子区跟随父群组
          const parentGroupNo =
            conv.channelInfo?.orgData?.parentGroupNo ||
            parseThreadChannelId(conv.channel.channelID)?.groupNo;
          if (parentGroupNo && pinnedGroupIds.has(parentGroupNo)) {
            finalPinned.push(item);
          } else {
            finalRecent.push(item);
          }
        } else {
          finalRecent.push(item);
        }
      }
    }
    }

    const { onThreadOverflowClick } = this.props;
    const { expandedGroupIds } = this.state;
    this.lastRenderableItems = [...finalPinned, ...finalRecent].filter(
      (item): item is ConversationWrap => !("type" in item)
    );

    const renderItem = (
      item:
        | ConversationWrap
        | {
            type: "thread-overflow";
            parentGroupId: string;
            count: number;
            unreadCount: number;
          }
    ) => {
      if ("type" in item && item.type === "thread-overflow") {
        // 展开/收起由双击群组行触发，不显示「+N 个子区」控件
        const isExpanded = this._isThreadExpanded(item.parentGroupId);
        if (!isExpanded) return null;
        const extraThreads = threadsByParent.get(item.parentGroupId) ?? [];
        return (
          <React.Fragment key={`overflow-${item.parentGroupId}`}>
            {extraThreads.map((conv) => {
              const selected = !!(
                this.props.select && this.props.select.isEqual(conv.channel)
              );
              return (
                <CompactGroupItem
                  key={conv.channel.getChannelKey()}
                  conversationWrap={conv}
                  selected={selected}
                  onClick={() => {
                    if (this.props.onClick) this.props.onClick(conv);
                  }}
                  onContextMenu={(e) => {
                    this._handleContextMenu(conv, e);
                  }}
                />
              );
            })}
          </React.Fragment>
        );
      }
      const conv = item as ConversationWrap;

      // compact 模式展开：已展开分组的子区（overflow 之后的部分）是否显示
      // 注意：groupThreadsWithParent 只给前 2 个，overflow 的在 threadsByParent 里
      // 这里 item 已经是 groupThreadsWithParent 处理后的，超出的不在 items 里
      // 所以只需要在 overflow click 后渲染额外的子区
      // → 用 expandedGroupIds 控制是否渲染 threadsByParent 里超出 MAX 的部分（见下方额外渲染）

      const hasThreads =
        conv.channel.channelType === ChannelTypeGroup &&
        threadsByParent.has(conv.channel.channelID);
      const threadUnread = (() => {
        if (!hasThreads) return 0;
        if (this._isThreadExpanded(conv.channel.channelID)) return 0;
        const threads = threadsByParent.get(conv.channel.channelID) ?? [];
        const parentInfo = getImChannelInfo(
          WKSDK.shared(),
          new Channel(conv.channel.channelID, ChannelTypeGroup)
        );
        return collapsedThreadUnread(threads, !!parentInfo?.mute, !!compact);
      })();
      return this.conversationItem(conv, hasThreads, threadUnread);
    };

    return (
      <div
        ref={this.listRef}
        id="wk-conversationlist"
        className="wk-conversationlist"
        onScroll={this._handleScroll}
      >
        {finalPinned.map(renderItem)}
        {finalRecent.map(renderItem)}

        <ContextMenus
          onContext={(ctx) => {
            this.contextMenusContext = ctx;
          }}
          menus={(() => {
            const conv = selectConversationWrap;
            const channelInfo = conv?.channelInfo;
            const channel = conv?.channel;
            const extraMenus = this.props.extraContextMenus
              ? this.props.extraContextMenus(conv)
              : [];

            const menus: any[] = [];

            // 1. 标为已读（有未读时显示）
            if (conv && conv.unread > 0) {
              menus.push({
                title: t("base.conversationList.context.markAsRead"),
                icon: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
                onClick: () => {
                  if (!channel) return;
                  WKApp.apiClient.put("conversation/clearUnread", {
                    channel_id: channel.channelID,
                    channel_type: channel.channelType,
                    unread: 0,
                  });
                },
              });
            }

            // 2. 关闭聊天窗口
            if (!this.props.hideCloseChat) {
              menus.push({
                title: t("base.conversationList.context.closeChat"),
                icon: "M18 6 6 18 M6 6l12 12",
                onClick: () => {
                  if (!channel) return;
                  wkConfirm({
                    title: t("base.conversationList.confirm.closeTitle"),
                    content: t("base.conversationList.confirm.closeContent"),
                    okText: t("base.common.ok"),
                    cancelText: t("base.common.cancel"),
                    onOk: () => {
                      this.onCloseChat(channel);
                    },
                  });
                },
              });
            }

            // 3. 额外菜单项（移出分组 / 移到分组等，由上层通过 extraContextMenus 传入）
            if (extraMenus.length > 0) {
              menus.push(...extraMenus);
            }

            // 4. 置顶 / 取消置顶（子区不显示；关注 tab 用 hidePin 关闭）
            if (channel?.channelType !== ChannelTypeCommunityTopic && !this.props.hidePin) {
              menus.push({
                title: channelInfo?.top
                  ? t("base.conversationList.context.unpin")
                  : t("base.conversationList.context.pin"),
                icon: channelInfo?.top
                  ? "M12 17v5 M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89 M2 2l20 20 M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"
                  : "M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
                onClick: () => {
                  if (channelInfo) this.onTop(channelInfo);
                },
              });
            }

            // 5. 免打扰 / 关闭免打扰
            // 菜单标题跟 effectiveMute（用户看到的静音状态）保持一致：
            // 子区：有显式设置看自身；未设置继承父群
            // 群组：只看自身
            const menuIsThread = channel?.channelType === ChannelTypeCommunityTopic
            const menuParentGroupNo = menuIsThread
              ? (channelInfo?.orgData?.parentGroupNo as string | undefined)
              : undefined
            const menuParentChannelInfo = menuParentGroupNo
              ? getImChannelInfo(WKSDK.shared(), new Channel(menuParentGroupNo, ChannelTypeGroup))
              : undefined
            const menuRawMute = menuIsThread
              ? (channelInfo?.orgData?.thread as any)?.mute as number | null | undefined
              : undefined
            const menuEffectiveMute = menuIsThread
              ? menuRawMute != null ? menuRawMute === 1 : !!(menuParentChannelInfo?.mute)
              : !!(channelInfo?.mute)
            menus.push({
              title: menuEffectiveMute
                ? t("base.conversationList.context.unmute")
                : t("base.conversationList.context.mute"),
              icon: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
              onClick: () => {
                if (channelInfo) this.onMuteWithValue(!menuEffectiveMute, channelInfo);
              },
            });

            // 6. 展开/收起子区（compact 模式下、群组且有子区时显示）
            if (
              compact &&
              channel &&
              channel.channelType === ChannelTypeGroup &&
              threadsByParent.has(channel.channelID)
            ) {
              const isExpanded = this._isThreadExpanded(channel.channelID);
              menus.push({
                title: isExpanded
                  ? t("base.conversationList.context.collapseThreads")
                  : t("base.conversationList.context.expandThreads"),
                icon: isExpanded ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7",
                onClick: () => {
                  this._toggleGroupExpand(channel.channelID);
                },
              });
            }

            // 7. 分隔线
            menus.push({ separator: true } as ContextMenusData);

            // 8. 清空聊天记录 / 关闭并清空
            // 子区：直接展开到顶层
            // 群组：保留在「更多」子菜单里
            // hideCloseChat（关注 tab）下只保留「仅清空记录」的项，否则即便上面隐藏了
            // 显式「关闭聊天窗口」项，「更多 → 关闭窗口并清空」仍能让用户关掉关注的会话。
            const clearItems: ContextMenusData[] = [
              {
                title: t("base.conversationList.context.clearMessages"),
                danger: true,
                onClick: () => {
                  if (!channel) return;
                  wkConfirm({
                    title: t("base.conversationList.confirm.clearTitle"),
                    content: t("base.conversationList.confirm.clearContent"),
                    okText: t("base.common.ok"),
                    cancelText: t("base.common.cancel"),
                    onOk: () => {
                      this.onClearMessages(channel);
                    },
                  });
                },
              },
            ];
            if (!this.props.hideCloseChat) {
              clearItems.push({
                title: t("base.conversationList.context.closeAndClear"),
                danger: true,
                onClick: () => {
                  if (!channel) return;
                  wkConfirm({
                    title: t("base.conversationList.confirm.closeAndClearTitle"),
                    content:
                      t("base.conversationList.confirm.closeAndClearContent"),
                    okText: t("base.common.ok"),
                    cancelText: t("base.common.cancel"),
                    onOk: () => {
                      this.onCloseChat(channel);
                      this.onClearMessages(channel);
                    },
                  });
                },
              });
            }

            if (channel?.channelType === ChannelTypeCommunityTopic) {
              menus.push(...clearItems);
            } else {
              menus.push({
                title: t("base.conversationList.context.more"),
                icon: "M12 12m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0 M12 5m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0 M12 19m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0",
                children: clearItems,
              });
            }

            return menus;
          })()}
        />
      </div>
    );
  }
}

interface OnlineStatusBadgeProps {
  tip?: string;
}
export class OnlineStatusBadge extends Component<OnlineStatusBadgeProps> {
  render(): React.ReactNode {
    const { tip } = this.props;
    return (
      <div
        className={classNames(
          "wk-onlinestatusbadge",
          !tip ? "wk-onlinestatusbadge-empty" : undefined
        )}
      >
        <div className="wk-onlinestatusbadge-content">
          <div className="wk-onlinestatusbadge-content-tip">{tip}</div>
        </div>
      </div>
    );
  }
}
