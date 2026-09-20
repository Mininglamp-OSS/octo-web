import React, { Component, ReactNode } from "react";
import { ConversationWindow } from "../../Components/ConversationWindow";
import ConversationList, {
  ConvFilter,
} from "../../Components/ConversationList";
import SidebarTabBar, { SidebarTab } from "../../Components/SidebarTabBar";
import ConversationListGrouped from "../../Components/ConversationListGrouped";
import {
  isThreadArchivedForBadge,
  type ThreadSidebarStatusMap,
} from "../../Components/ConversationListGrouped/archivedThreads";
import ChatConversationList, {
  isMutedForRecentConversation,
} from "../../Components/ChatConversationList";
import Provider from "../../Service/Provider";
import { ErrorBoundary } from "../../Components/ErrorBoundary";

import { Spin, Popover, Toast } from "@douyinfe/semi-ui";
import { getElectronLinksBridge } from "../../electron/desktopBridge";
import WKButton from "../../Components/WKButton";
import WKModal from "../../Components/WKModal";
import { Columns2, ChevronRight } from "lucide-react";
import ThreadIcon from "../../Components/Icons/ThreadIcon";
import { ChatVM, handleGlobalSearchClick } from "./vm";
import "./index.css";
import { ConversationWrap } from "../../Service/Model";
import WKApp, { ThemeMode } from "../../App";
import { Dap } from "../../Service/Dap";
import { stripSpacePrefix } from "../../Service/SpacePrefix";
import { isBotfatherChannelID } from "../../Service/botfatherChannel";
import {
  subchannelOpenFromMount,
  subchannelOpenFromThreadChange,
} from "../../Service/subchannelOpenTracking";
import ChannelSetting from "../../Components/ChannelSetting";
import ChannelSearchPanel from "../../features/channelSearch/ChannelSearchPanel";
import { createChannelSearchApiDataSource } from "../../bridge/channelSearch/createChannelSearchDataSource";
import { isChannelSearchEnabled } from "../../features/channelSearch/feature";
import { openDriveFileHit } from "./openDriveFileHit";
import type {
  ChannelSearchDataSource,
  ChannelSearchItem,
  ChannelSearchPanelState,
} from "../../Service/SearchTypes";
import classNames from "classnames";
import {
  Channel,
  ChannelInfo,
  ChannelTypeGroup,
  ChannelTypePerson,
  WKSDK,
} from "wukongimjssdk";
import WKAvatar from "../../Components/WKAvatar";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { ChannelInfoListener } from "wukongimjssdk";
import { ChatMenus } from "../../App";
import ConversationContext from "../../Components/Conversation/context";
import GlobalSearch from "../../features/globalSearch/GlobalSearchPanel";
import {
  buildDocLink,
  resolveDocLinkForExternalOpen,
} from "../../Utils/docLink";
import { ShowConversationOptions } from "../../EndpointCommon";
import SpaceList from "../../Components/SpaceList";
import SpaceCreate from "../../Components/SpaceCreate";
import { Space, SpaceService } from "../../Service/SpaceService";
import NavSignalBadge from "../../Components/NavRail/NavSignalBadge";
import ThreadPanel from "../../Components/ThreadPanel";
import {
  Thread,
  ThreadStatus,
  parseThreadChannelId,
  buildThreadStub,
  isEffectivelyMuted,
} from "../../Service/Thread";
import FilePreviewPanel, {
  FilePreviewInfo,
  getExtension,
} from "../../Components/FilePreviewPanel";
import {
  FollowSidebarProvider,
  useFollowSidebarContext,
} from "../../Hooks/useFollowSidebar";
import { SidebarTargetType } from "../../Service/SidebarService";
import { I18nContext, t } from "../../i18n";
import {
  addImChannelInfoListener,
  deleteImChannelInfo,
  fetchImChannelInfo,
  getImChannelInfo,
  getPendingImChannelInfoFetch,
} from "../../im-runtime/channelRuntime";
import WebhookIssuePreviewPanel from "../../features/webhookMessagePreview/WebhookIssuePreviewPanel";
import type { WebhookIssuePreviewTarget } from "../../bridge/message/webhookPreview";
import { apiUrlOrigin } from "../../bridge/message/webhookPreview";
import {
  closeChatRightPanels, openChatRightPanel,
  type ChatRightPanelKind, type ChatRightPanelStatePatch,
} from "./rightPanelState";
import { observeChatLayout, type ChatLayout } from "./responsiveLayout";
import { chatPageTitleController } from "./chatPageTitleController";
import { getImChannelDisplayName } from "../../im-runtime/channelDisplayName";
import { loadChatChannelInfo } from "./loadChannelInfo";
import {
  shouldHideFollowUnreadBadge,
  shouldHideRecentUnreadBadge,
  unreadContribution,
} from "./sidebarUnreadBadge";
import { getLegacyChatRuntime } from "../../features/chat-capability/legacyChatClient";
import { WorkspaceGroupTitle } from "../../features/workspaceGroup/WorkspaceGroupTitle";
import {
  cancelHostAttachmentRequests,
  canForwardToHost,
  tryHostTakeover,
  subscribeHostAttachmentPreview,
} from "../../features/filePreview/attachmentHost";

// 消息 ACK 只代表发送成功；后端把归档子区恢复为活跃存在短暂异步窗口。
// 实测立即 threadGet 可能仍返回 Archived，因此发送后用短轮询等后端状态落稳。
const THREAD_REACTIVATE_REFRESH_DELAYS_MS = [0, 300, 800, 1500];

export function extensionFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0] || "";
  const fileName = path.substring(path.lastIndexOf("/") + 1);
  return getExtension("", fileName);
}

export function fallbackSearchMediaExtension(kind: ChannelSearchItem["kind"]) {
  return kind === "video" ? "mp4" : "jpg";
}

export function searchMediaPreviewName(
  item: ChannelSearchItem,
  extension: string
): string {
  const prefix = item.kind === "video" ? "video" : "image";
  const id = item.messageSeq || item.messageId || "preview";
  return `${prefix}-${id}.${extension}`;
}

interface SidebarTabBarWithBadgesProps {
  conversations: ConversationWrap[];
  recentLoading: boolean;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onRecentUnreadNavigate?: () => void;
}

/**
 * 关注 / 最近 tab 角标。按 PM #337 spec：
 * - 关注 tab：sum 自 sidebar /sidebar/sync 的 items[].unread（已是后端 follow 视图）。
 *   不再 sum IM 缓存——sidebar-only 的关注（用户关注但还没聊过，IM 缓存里没有）会被丢掉。
 * - 最近 tab：sum IM 缓存里非勿扰的 conversations，和 recent tab filter='all' 一致。
 *
 * 勿扰判定：通过 IM runtime 查 channelInfo.mute（拿不到当作非勿扰）；
 * 子区未显式 mute 时回看父群组的 mute（与列表渲染保持一致）。
 *
 * 数据源由 <FollowSidebarProvider> 统一注入，避免双 hook 实例导致的重复
 * /sidebar/sync + follow 写操作只刷一份的 stale badge 问题。
 */
const SidebarTabBarWithBadges: React.FC<SidebarTabBarWithBadgesProps> = ({
  conversations,
  recentLoading,
  activeTab,
  onTabChange,
  onRecentUnreadNavigate,
}) => {
  const { items, isLoading: followingLoading } = useFollowSidebarContext();
  const requestedUnreadAuthorityRef = React.useRef<Set<string>>(new Set());
  const missingRecentMuteAuthority = new Map<string, Channel>();
  const missingFollowMuteAuthority = new Map<string, Channel>();

  const rememberMissingAuthority = (
    target: Map<string, Channel>,
    channel: Channel
  ) => {
    target.set(channel.getChannelKey(), channel);
  };

  const resolveMuteAuthority = (
    channel: Channel,
    parentGroupNo: string | undefined,
    target: Map<string, Channel>
  ) => {
    const channelInfo = getImChannelInfo(WKSDK.shared(), channel);
    if (!channelInfo) rememberMissingAuthority(target, channel);

    let parentChannelInfo: ChannelInfo | undefined;
    if (parentGroupNo) {
      const parentChannel = new Channel(parentGroupNo, ChannelTypeGroup);
      parentChannelInfo = getImChannelInfo(WKSDK.shared(), parentChannel);
      if (!parentChannelInfo) {
        rememberMissingAuthority(target, parentChannel);
      }
    }

    return { channelInfo, parentChannelInfo };
  };

  const getItemMuteState = (it: {
    target_type: number;
    target_id: string;
    parent_channel_id?: string;
  }) => {
    let channelType: number | null = null;
    if (it.target_type === SidebarTargetType.DM)
      channelType = ChannelTypePerson;
    else if (it.target_type === SidebarTargetType.CHANNEL)
      channelType = ChannelTypeGroup;
    else if (it.target_type === SidebarTargetType.THREAD)
      channelType = ChannelTypeCommunityTopic;
    if (channelType == null) {
      return { ready: true, muted: false };
    }
    const channel = new Channel(it.target_id, channelType);
    const isThread = it.target_type === SidebarTargetType.THREAD;
    const parentGroupNo = isThread
      ? it.parent_channel_id || parseThreadChannelId(it.target_id)?.groupNo
      : undefined;
    const { channelInfo, parentChannelInfo } = resolveMuteAuthority(
      channel,
      parentGroupNo,
      missingFollowMuteAuthority
    );
    const ready = !!channelInfo && (!parentGroupNo || !!parentChannelInfo);
    return {
      ready,
      muted: isEffectivelyMuted({
        isThread,
        channelInfo,
        parentChannelInfo,
      }),
    };
  };

  // sidebar items 是 /sidebar/sync 的快照，IM 缓存里 conv 才是 reactive 的。
  // IM 缓存有这条会话就用 live unread；没有（sidebar-only 关注，从未聊过）才
  // fallback sidebar 的 unread 快照——这样新消息一来 badge 即刻同步，sidebar-
  // only 关注又不会被漏算。
  // 子区 channelID → sidebar status（来自 /sidebar/sync 的 target_type=5 项）。
  // 与展开列表(ConversationListGrouped)用同一路信号：冷启动刷新后第一帧即可用，
  // 无需等 channelInfo 异步补齐。下方角标过滤据此与列表的冷启动隐藏保持一致。
  const threadSidebarStatus: ThreadSidebarStatusMap = new Map();
  for (const it of items) {
    if (it.target_type !== SidebarTargetType.THREAD) continue;
    if (it.status == null) continue;
    threadSidebarStatus.set(it.target_id, it.status);
  }
  const followUnread = items.reduce((sum, it) => {
    let channelType: number | null = null;
    if (it.target_type === SidebarTargetType.DM)
      channelType = ChannelTypePerson;
    else if (it.target_type === SidebarTargetType.CHANNEL)
      channelType = ChannelTypeGroup;
    else if (it.target_type === SidebarTargetType.THREAD)
      channelType = ChannelTypeCommunityTopic;
    const liveConv =
      channelType != null
        ? conversations.find(
            (c) =>
              c.channel.channelType === channelType &&
              c.channel.channelID === it.target_id
          )
        : undefined;
    // 与展开列表的展示层过滤一致：明确已归档的子区已从列表隐藏，未读也不计入
    // 角标，否则会出现「红点 N 但列表里看不到对应未读」。
    //   - liveConv 存在：走 channelInfo 优先（回退 sidebar statusMap）判归档；
    //   - liveConv 缺失（sidebar-only 关注，从未聊过、无 channelInfo）：回退 sidebar
    //     statusMap，sidebar=Archived 即隐藏，与列表的冷启动隐藏对齐。
    // fail-open：status 未知（既非 archived，也无 liveConv channelInfo）仍累加，不漏算。
    if (
      it.target_type === SidebarTargetType.THREAD &&
      isThreadArchivedForBadge(liveConv, it.target_id, threadSidebarStatus)
    ) {
      return sum;
    }
    const unread = liveConv ? liveConv.unread || 0 : it.unread || 0;
    if (unread <= 0) return sum;
    const muteState = getItemMuteState(it);
    return (
      sum +
      unreadContribution({
        unread,
        muteAuthorityReady: muteState.ready,
        muted: muteState.muted,
      })
    );
  }, 0);

  const recentUnread = conversations.reduce(
    (sum: number, c: ConversationWrap) => {
      const unread = c.unread || 0;
      if (unread <= 0) return sum;
      const isThread = c.channel.channelType === ChannelTypeCommunityTopic;
      const parentGroupNo = isThread
        ? (c.channelInfo?.orgData?.parentGroupNo as string | undefined) ||
          parseThreadChannelId(c.channel.channelID)?.groupNo
        : undefined;
      const authority = resolveMuteAuthority(
        c.channel,
        parentGroupNo,
        missingRecentMuteAuthority
      );
      return (
        sum +
        unreadContribution({
          unread,
          muteAuthorityReady:
            !!authority.channelInfo &&
            (!parentGroupNo || !!authority.parentChannelInfo),
          muted: isMutedForRecentConversation(c),
        })
      );
    },
    0
  );

  const missingUnreadAuthority = new Map([
    ...missingRecentMuteAuthority,
    ...missingFollowMuteAuthority,
  ]);
  const missingUnreadAuthorityKey = [...missingUnreadAuthority.keys()]
    .sort()
    .join("|");

  React.useEffect(() => {
    const sdk = WKSDK.shared();
    for (const [key, channel] of missingUnreadAuthority) {
      if (requestedUnreadAuthorityRef.current.has(key)) continue;
      requestedUnreadAuthorityRef.current.add(key);
      const request =
        getPendingImChannelInfoFetch(sdk, channel) ||
        fetchImChannelInfo(sdk, channel);
      void Promise.resolve(request)
        .catch(() => undefined)
        .finally(() => {
          requestedUnreadAuthorityRef.current.delete(key);
        });
    }
  }, [missingUnreadAuthorityKey]);

  const hideRecentUnread = shouldHideRecentUnreadBadge({
    recentLoading,
    followingLoading,
  });
  const hideFollowUnread = shouldHideFollowUnreadBadge({
    recentLoading,
    followingLoading,
  });

  return (
    <SidebarTabBar
      activeTab={activeTab}
      // 最近和关注快照齐备后再显示 Tab 角标；单个频道缺少免打扰信息时
      // 只跳过该频道，不能把两个 Tab 的已知未读一起隐藏。
      followUnread={hideFollowUnread ? 0 : followUnread}
      recentUnread={hideRecentUnread ? 0 : recentUnread}
      onTabChange={onTabChange}
      onActiveTabClick={(tab) => {
        if (tab === "recent" && activeTab === "recent" && recentUnread > 0) {
          onRecentUnreadNavigate?.();
        }
      }}
    />
  );
};

export interface ChatContentPageProps {
  channel: Channel;
  initLocateMessageSeq?: number; // 打开时定位到某条消息
  /** 打开会话后默认展开右侧聊天记录搜索面板 */
  initialShowChannelSearch?: boolean;
  /**
   * 工作空间内嵌模式：显式传入时不展开任何真实侧边面板（文件预览、webhook、
   * 智能总结、频道内搜索、子区/设置面板等）。子区会话入口改为通过
   * openConversation 导航到完整消息页的对应子区，其余侧边打开尝试通过
   * onSidePanelUnavailable 提示用户去完整消息页。未传时保持现有 Web 行为。
   */
  workspaceEmbedding?: {
    openConversation: (channel: Channel) => void;
    onSidePanelUnavailable: () => void;
  };
}

export interface ChatContentPageState {
  channelInfoLoading: boolean;
  contentLayout?: ChatLayout;
  hostPreviewSource?: { channelId: string; channelType: number } | null;
  workspaceEmbedding?: ChatContentPageProps["workspaceEmbedding"];
  showChannelSetting: boolean;
  selectionMode: boolean;
  selectedCount: number;
  /** 子区面板是否显示 */
  showThreadPanel: boolean;
  /** 当前选中的子区 */
  activeThread: Thread | null;
  threadFromDirectory?: boolean;
  /** 文件预览信息（非空时显示文件预览面板） */
  previewFile: FilePreviewInfo | null;
  /** 当前正在预览的文件消息 ID（用于卡片激活态） */
  activePreviewMessageId: string | null;
  /**
   * 文件预览触发前是否真有子区面板上下文 (用户先打开了子区列表 / 子区详情)。
   * 据此决定 ThreadPanel 文件预览模式下要不要显示左上角 ← 返回箭头 —
   * 没来过子区的情况下让 ← 把用户带到子区列表会很突兀。
   */
  previewHadThreadShell: boolean;
  /** 智能总结面板是否显示 */
  showSummaryPanel: boolean;
  /** 总结面板初始视图 */
  summaryPanelView: "history" | "new";
  /** 频道内聊天搜索面板是否显示 */
  showChannelSearch: boolean;
  /** 频道内搜索面板中的预览文件 */
  channelSearchPreviewFile: FilePreviewInfo | null;
  /** 当前文件预览关闭后是否需要回到频道内搜索面板 */
  previewReturnChannelSearch: boolean;
  /** 当前正在右侧预览的 Webhook Fleet 任务链接。 */
  webhookIssuePreviewTarget: WebhookIssuePreviewTarget | null;
}
export class ChatContentPage extends Component<
  ChatContentPageProps,
  ChatContentPageState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  channelInfoListener!: ChannelInfoListener;
  conversationContext!: ConversationContext;
  private parentGroupChannel?: Channel;
  private channelSearchDataSourceKey = "";
  private channelSearchDataSource?: ChannelSearchDataSource;
  private channelSearchPanelState?: ChannelSearchPanelState;
  private _unsubscribeChannelInfoListener?: () => void;
  private stopChannelInfoLoad?: () => void;
  private _unsubscribeChannelSearchConfig?: () => void;
  private readonly titlePageOwner = Symbol("chat-content-page");
  private readonly chatRuntime = getLegacyChatRuntime();
  private readonly channelSettingPanelRef = React.createRef<HTMLDivElement>();
  private readonly chatContentRef = React.createRef<HTMLDivElement>();
  private readonly layoutRef = React.createRef<HTMLDivElement>();
  private layoutObserver?: ReturnType<typeof observeChatLayout>;
  private unsubscribeHostPreview?: () => void;
  private channelSettingReturnFocusElement?: HTMLElement;
  private shouldRestoreChannelSettingFocus = false;

  private _closeChannelSetting = () => {
    this.shouldRestoreChannelSettingFocus = true;
    this.setState({ showChannelSetting: false });
  };

  private _onChannelSettingKeyDown = (event: KeyboardEvent) => {
    if (!this.state.showChannelSetting) return;

    const panel = this.channelSettingPanelRef.current;
    const chatContent = this.chatContentRef.current;
    const eventTarget = event.target;
    if (
      !panel ||
      !(eventTarget instanceof Node) ||
      (!panel.contains(eventTarget) && !chatContent?.contains(eventTarget))
    ) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this._closeChannelSetting();
      return;
    }

    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
      )
    ).filter((element) => {
      if (
        element.closest('[aria-hidden="true"]') ||
        element.getClientRects().length === 0
      ) {
        return false;
      }

      const routeView = element.closest<HTMLElement>(".wk-viewqueue-view");
      if (!routeView) return true;

      const route = routeView.parentElement;
      const activeRouteView =
        route?.querySelector<HTMLElement>(":scope > #wk-viewqueue-view-last") ||
        route?.querySelector<HTMLElement>(":scope > .wk-viewqueue-view");
      return routeView === activeRouteView;
    });

    if (focusableElements.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;
    if (
      !panel.contains(activeElement) ||
      activeElement === panel ||
      (event.shiftKey && activeElement === first) ||
      (!event.shiftKey && activeElement === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  constructor(props: any) {
    super(props);
    this.state = {
      channelInfoLoading: true,
      workspaceEmbedding: props.workspaceEmbedding,
      showChannelSetting: false,
      selectionMode: false,
      selectedCount: 0,
      showThreadPanel: false,
      activeThread: null,
      previewFile: null,
      activePreviewMessageId: null,
      previewHadThreadShell: false,
      showSummaryPanel: false,
      summaryPanelView: "new",
      showChannelSearch:
        !!props.initialShowChannelSearch &&
        !props.workspaceEmbedding &&
        isChannelSearchEnabled(props.channel),
      channelSearchPreviewFile: null,
      previewReturnChannelSearch: false,
      webhookIssuePreviewTarget: null,
    };
  }

  updateWorkspaceEmbedding(
    workspaceEmbedding?: ChatContentPageProps["workspaceEmbedding"],
    onCommitted?: () => void
  ) {
    // Evaluate against queued state so a newer presentation supersedes an uncommitted one.
    if (this.state.workspaceEmbedding !== workspaceEmbedding) this._invalidateFilePreviewTakeover();
    this.setState((state) => state.workspaceEmbedding === workspaceEmbedding ? null : {
      ...closeChatRightPanels(),
      workspaceEmbedding,
    }, onCommitted);
  }

  private _openWebhookPreview = (target: WebhookIssuePreviewTarget) => {
    if (this.state.workspaceEmbedding) {
      this.state.workspaceEmbedding.onSidePanelUnavailable();
      return;
    }
    this._clearChannelSearchState();
    this._openRightPanel("webhookPreview", {
      webhookIssuePreviewTarget: target,
    });
  };

  private _onFilePreview = (
    file: FilePreviewInfo | null,
    options?: { returnToChannelSearch?: boolean }
  ) => {
    if (!file) {
      this._closePreview();
      this.setState({ channelSearchPreviewFile: null });
      return;
    }
    if (this.state.workspaceEmbedding) {
      this.state.workspaceEmbedding.onSidePanelUnavailable();
      return;
    }
    this._previewInHostOrWeb(file, (next) => this._openWebFilePreview(next, options));
  };

  private _openWebFilePreview = (
    file: FilePreviewInfo,
    options?: { returnToChannelSearch?: boolean }
  ) => {
    const fromChannelSearch = !!options?.returnToChannelSearch;
    this.setState(
      openChatRightPanel("filePreview", {
        previewFile: file,
        activeThread: this.state.activeThread,
        threadFromDirectory: !!this.state.threadFromDirectory,
        activePreviewMessageId: file.messageId || null,
        previewReturnChannelSearch: fromChannelSearch,
        previewHadThreadShell: fromChannelSearch
          ? false
          : this.state.previewFile
            ? this.state.previewHadThreadShell
            : this.state.showThreadPanel,
      })
    );
  };

  private getChannelSearchDataSource(
    channel: Channel
  ): ChannelSearchDataSource {
    const key = channel.getChannelKey();
    if (
      !this.channelSearchDataSource ||
      this.channelSearchDataSourceKey !== key
    ) {
      this.channelSearchDataSourceKey = key;
      this.channelSearchDataSource = createChannelSearchApiDataSource(channel);
    }
    return this.channelSearchDataSource;
  }

  private _onSearchFilePreview = (item: ChannelSearchItem) => {
    const file = item.file;
    if (!file) return;

    const { channel } = this.props;
    const name = file.name || t("base.conversation.file.unknown");
    const url = file.previewUrl || file.downloadUrl || file.url || "";
    if (!url) {
      Toast.warning(t("base.channelSearch.downloadUnavailable"));
      return;
    }
    const previewInfo: FilePreviewInfo = {
      url,
      downloadUrl: file.downloadUrl,
      name,
      extension: getExtension(file.extension || "", name),
      size: file.size,
      sourceChannelId: item.channelId || channel.channelID,
      sourceChannelType: item.channelType || channel.channelType,
      messageId: item.messageId,
      messageSeq: item.messageSeq,
      fromUID: item.senderUid,
      attachmentIndex: 0,
    };
    this._previewInHostOrWeb(previewInfo, (next) => {
      this.setState({ channelSearchPreviewFile: next });
    });
  };

  private _previewInHostOrWeb(
    file: FilePreviewInfo,
    openInWeb: (next: FilePreviewInfo) => void,
  ): Promise<void> {
    const seq = ++this._filePreviewTakeoverSeq;
    cancelHostAttachmentRequests();
    if (!canForwardToHost(file)) {
      openInWeb(file);
      return Promise.resolve();
    }
    let inlineFile: FilePreviewInfo | undefined;
    return tryHostTakeover(file, (next) => {
      inlineFile = {
        ...next,
        hostPreview: { ...next.hostPreview!, onRetry: () => { void this._previewInHostOrWeb(file, openInWeb); } },
      };
      openInWeb(inlineFile);
    }).then((takeover) => {
      if (seq !== this._filePreviewTakeoverSeq) return;
      if (takeover === "fallback") openInWeb(file);
      if (takeover === "error") {
        Toast.error(t("base.messageFile.previewFailed"));
        if (inlineFile?.hostPreview) openInWeb({
          ...inlineFile, hostPreview: { ...inlineFile.hostPreview, failed: true },
        });
      }
      if (takeover === "taken" && !inlineFile) {
        this.setState({
          previewFile: null,
          activePreviewMessageId: null,
          channelSearchPreviewFile: null,
          showThreadPanel: this.state.previewFile
            ? this.state.previewHadThreadShell
            : this.state.showThreadPanel,
          previewReturnChannelSearch: false,
          previewHadThreadShell: false,
        });
      }
    });
  }

  private _onSearchMediaPreview = (item: ChannelSearchItem) => {
    const media = item.media;
    if (!media || (item.kind !== "image" && item.kind !== "video")) return;
    this._filePreviewTakeoverSeq++;
    cancelHostAttachmentRequests();

    const { channel } = this.props;
    const url =
      media.previewUrl ||
      media.url ||
      media.downloadUrl ||
      (item.kind === "image" ? media.thumbUrl : "") ||
      "";
    if (!url) {
      Toast.warning(t("base.channelSearch.downloadUnavailable"));
      return;
    }

    const extension =
      extensionFromUrl(url) || fallbackSearchMediaExtension(item.kind);
    const name = media.name || searchMediaPreviewName(item, extension);

    this.setState({
      channelSearchPreviewFile: {
        url,
        name,
        extension,
        category: item.kind,
        posterUrl: media.thumbUrl || media.inlineThumbUrl,
        width: media.width,
        height: media.height,
        duration: media.duration,
        sourceChannelId: item.channelId || channel.channelID,
        sourceChannelType: item.channelType || channel.channelType,
        messageId: item.messageId,
        messageSeq: item.messageSeq,
        fromUID: item.senderUid,
        attachmentIndex: 0,
      },
    });
  };

  private _onChannelSearchStateChange = (state: ChannelSearchPanelState) => {
    this.channelSearchPanelState = state;
  };

  private _clearChannelSearchState = () => {
    this.channelSearchPanelState = undefined;
  };

  /** Also cancels accepted native previews when their owning panel is superseded. */
  private _invalidateFilePreviewTakeover = () => {
    this._filePreviewTakeoverSeq++;
    cancelHostAttachmentRequests();
  };

  private _openRightPanel = (
    kind: Exclude<ChatRightPanelKind, "filePreview">,
    overrides?: Partial<ChatRightPanelStatePatch>
  ) => {
    this._invalidateFilePreviewTakeover();
    this.setState(openChatRightPanel(kind, overrides));
  };

  private _openChannelSearchPanel = () => {
    if (this.state.workspaceEmbedding) {
      this.state.workspaceEmbedding.onSidePanelUnavailable();
      return;
    }
    if (!isChannelSearchEnabled(this.props.channel)) return;
    this._clearChannelSearchState();
    this._openRightPanel("channelSearch");
  };

  private _closeChannelSearchPanel = () => {
    this._filePreviewTakeoverSeq++;
    cancelHostAttachmentRequests();
    this._clearChannelSearchState();
    this.setState({
      showChannelSearch: false,
      channelSearchPreviewFile: null,
    }, () => {
      this.chatContentRef.current?.querySelector<HTMLElement>('[data-testid="channel-search-entry"]')?.focus();
    });
  };

  private _closeThreadPanel = () => {
    if (this.state.previewFile) {
      this._closePreview();
      return;
    }
    this._invalidateFilePreviewTakeover();
    this.setState({
      showThreadPanel: false,
      activeThread: null,
      threadFromDirectory: false,
    }, () => {
      this.chatContentRef.current?.querySelector<HTMLElement>('[data-testid="chat-thread-panel-entry"]')?.focus();
    });
  };

  // Both close controls exit only the file layer, regardless of screen width.
  private _closePreview = (_resetThreadShell?: boolean) => {
    this._filePreviewTakeoverSeq++;
    cancelHostAttachmentRequests();
    const fromChannelSearch = !!this.state.previewReturnChannelSearch;
    const keepThread = !fromChannelSearch && this.state.previewHadThreadShell;
    this.setState({
      previewFile: null,
      activePreviewMessageId: null,
      previewReturnChannelSearch: false,
      previewHadThreadShell: false,
      showChannelSearch:
        fromChannelSearch && isChannelSearchEnabled(this.props.channel)
          ? true
          : this.state.showChannelSearch,
      showThreadPanel: keepThread,
      activeThread: keepThread ? this.state.activeThread : null,
    });
  };

  private updateResponsiveLayout() {
    const threadContext = this.state.showThreadPanel &&
      (!this.state.previewFile || this.state.previewHadThreadShell);
    const hasAuxiliary =
      !this.state.workspaceEmbedding &&
      (!this.state.hostPreviewSource || !!this.state.previewFile?.hostPreview ||
        !!this.state.channelSearchPreviewFile?.hostPreview);
    this.layoutObserver?.update(
      hasAuxiliary
        ? this.state.showChannelSearch ? "search" :
          threadContext ? (this.state.previewFile ? "threadPreview" : "thread") : !!this.state.previewFile
        : false
    );
  }

  componentDidMount() {
    const { channel } = this.props;
    this.unsubscribeHostPreview = subscribeHostAttachmentPreview((hostPreviewSource) => {
      this.setState({ hostPreviewSource });
    });
    if (this.layoutRef.current && !this.state.workspaceEmbedding) {
      this.layoutObserver = observeChatLayout(this.layoutRef.current, (contentLayout) => {
        this.setState({ contentLayout });
      });
      this.updateResponsiveLayout();
    }

    chatPageTitleController.activate(channel, this.titlePageOwner);

    // 监听文件预览事件
    WKApp.mittBus.on("wk:file-preview", this._onFilePreview);

    this.channelInfoListener = (channelInfo: ChannelInfo) => {
      const titleContextChanged =
        chatPageTitleController.handleChannelInfoChanged(channelInfo);
      // 监听当前频道或父群组的变化
      if (
        titleContextChanged ||
        channelInfo.channel.isEqual(this.props.channel) ||
        (this.parentGroupChannel &&
          channelInfo.channel.isEqual(this.parentGroupChannel))
      ) {
        this.setState({});
      }
    };
    this._unsubscribeChannelInfoListener = addImChannelInfoListener(
      WKSDK.shared(),
      this.channelInfoListener
    );
    this.loadChannelInfo();
    this._unsubscribeChannelSearchConfig =
      WKApp.remoteConfig.addConfigChangeListener(() => {
        if (
          !isChannelSearchEnabled(this.props.channel) &&
          (this.state.showChannelSearch ||
            this.state.previewReturnChannelSearch)
        ) {
          this._clearChannelSearchState();
          this._invalidateFilePreviewTakeover();
          this.setState({
            showChannelSearch: false,
            channelSearchPreviewFile: null,
            previewReturnChannelSearch: false,
          });
          return;
        }
        this.forceUpdate();
      });

    // 注册 pending-thread 事件监听（当前频道已打开时直接导航到子区）。
    // 跟文件预览互斥 (同一侧边容器)。
    this._onPendingThread = (detail: {
      groupNo: string;
      thread: Thread | null;
    }) => {
      if (detail?.groupNo === this.props.channel.channelID) {
        const workspaceEmbedding = this.state.workspaceEmbedding;
        if (workspaceEmbedding) {
          // 有明确 thread 时导航到对应子区完整页
          if (detail?.thread?.channel_id) {
            workspaceEmbedding.openConversation(
              new Channel(detail.thread.channel_id, ChannelTypeCommunityTopic)
            );
          } else {
            workspaceEmbedding.onSidePanelUnavailable();
          }
          return;
        }
        this._openRightPanel("thread", { activeThread: detail.thread || null });
      }
    };
    WKApp.mittBus.on("wk:pending-thread", this._onPendingThread);

    // 注册关闭子区面板事件监听
    this._onCloseThreadPanel = () => {
      this._invalidateFilePreviewTakeover();
      if (this.state.showThreadPanel) {
        this.setState({ showThreadPanel: false, activeThread: null });
      }
    };
    WKApp.mittBus.on("wk:close-thread-panel", this._onCloseThreadPanel);

    this._onToggleSummaryPanel = (data) => {
      if (
        data.channelId !== channel.channelID ||
        data.channelType !== channel.channelType
      )
        return;
      if (this.state.workspaceEmbedding) {
        this.state.workspaceEmbedding.onSidePanelUnavailable();
        return;
      }
      this._invalidateFilePreviewTakeover();
      this.setState((prevState) => {
        // forceOpen：始终打开（用于聊天内创建总结后展示），不做 toggle 关闭
        const opening = data.forceOpen ? true : !prevState.showSummaryPanel;
        if (!opening) {
          return { ...prevState, showSummaryPanel: false };
        }
        return {
          ...prevState,
          ...openChatRightPanel("summary"),
          summaryPanelView: data.summaryPanelView,
        };
      });
    };
    WKApp.mittBus.on("wk:toggle-summary-panel", this._onToggleSummaryPanel);

    // 主聊天头「查找聊天内容」入口按钮触发。等同于信息栏「查找聊天内容」：
    // 复用 _openChannelSearchPanel，内含 feature 门禁 + 与其它侧边面板互斥。
    this._onOpenChannelSearch = (data) => {
      if (
        data.channelId !== channel.channelID ||
        data.channelType !== channel.channelType
      )
        return;
      if (this.state.workspaceEmbedding) {
        this.state.workspaceEmbedding.onSidePanelUnavailable();
        return;
      }
      this._openChannelSearchPanel();
    };
    WKApp.mittBus.on("wk:open-channel-search", this._onOpenChannelSearch);

    // 检查是否需要自动打开子区面板（查看全部子区）。
    // 内嵌模式只消费 pending 标记。
    if (WKApp.shared.pendingThreadPanel === channel.channelID) {
      WKApp.shared.pendingThreadPanel = undefined;
      if (!this.state.workspaceEmbedding) {
        this._openRightPanel("thread");
      }
    }

    // 检查是否有待打开的文件预览（从子区面板切换过来）。
    // 内嵌模式仅消费 pending 标记。
    if (WKApp.shared.pendingFilePreview) {
      const pending = WKApp.shared.pendingFilePreview;
      WKApp.shared.pendingFilePreview = undefined;
      if (!this.state.workspaceEmbedding) {
        this.setState(
          openChatRightPanel("filePreview", {
            previewFile: {
              url: pending.url,
              sourceUrl: pending.sourceUrl,
              downloadUrl: pending.downloadUrl,
              name: pending.name,
              extension: pending.extension,
              size: pending.size,
              messageId: pending.messageId,
              sourceChannelId: pending.sourceChannelId,
              sourceChannelType: pending.sourceChannelType,
              messageSeq: pending.messageSeq,
              fromUID: pending.fromUID,
              conversationDigest: pending.conversationDigest,
            },
            activePreviewMessageId: pending.messageId || null,
          })
        );
      }
    }

    // 子区：预先获取父群组信息
    if (channel.channelType === ChannelTypeCommunityTopic) {
      const channelInfo = getImChannelInfo(WKSDK.shared(), channel);
      const parsed = parseThreadChannelId(channel.channelID);
      const parentGroupNo =
        channelInfo?.orgData?.parentGroupNo || parsed?.groupNo;
      // subchannel_opened(入口一):本页以子区频道挂载 = 会话列表点子区行 / 文件预览
      // showConversation(threadChannel) / 深链或路由恢复进子区。这些都会 remount 走 componentDidMount。
      // 去重(R10 P1-1):若本次挂载来自「已打开面板子区」再导航(全屏/搜索/文件预览),didUpdate 已发过,
      // 由 pendingSubchannelOpenTracked sentinel 抑制(one-shot 消费);直接从列表/深链挂载则照常发。
      // channel_id/subchannel_id 归一与判空均在 subchannelOpenFromMount 内(bare id,strip 前缀)。
      const suppressSubchannelOpen = WKApp.shared.pendingSubchannelOpenTracked;
      WKApp.shared.pendingSubchannelOpenTracked = undefined;
      const openEvent = subchannelOpenFromMount(
        channel,
        parentGroupNo,
        suppressSubchannelOpen
      );
      if (openEvent) {
        Dap.shared.track("subchannel_opened", openEvent);
      }
      if (parentGroupNo) {
        this.parentGroupChannel = new Channel(parentGroupNo, ChannelTypeGroup);
        if (!getImChannelInfo(WKSDK.shared(), this.parentGroupChannel)) {
          void fetchImChannelInfo(WKSDK.shared(), this.parentGroupChannel);
        }
      }
    }

    // botfather_opened:本页以 botfather DM 挂载 = 进入 botfather 会话。覆盖全部入口——通讯录横幅/
    // 联系人行点入(handleContactClick→showConversation)、深链、路由恢复,以及会话列表内
    // 「切换」到 botfather:ChatContentPage 以 channel.getChannelKey()(channelID-channelType)为 React
    // key,任何频道切换都会换 key → remount → 重走 componentDidMount,故挂载处即唯一发点(无需 didUpdate
    // 补一路,那条 channelChanged 分支永不为真)。一次进入发一次。DAP「BotFather 命令使用分布」图分母 =
    // 进入 botfather 会话的去重用户;actor_id 由 collector 附。
    // 门用后缀匹配 isBotfatherChannelID:Space 部署下 channelID = s{spaceId}_botfather(spaceId 任意
    // 串,如 sminglue_default_botfather),裸 "botfather" 只在无 Space 时出现。判定与分子(vm.ts botfather
    // 命令)共用同一 helper,保证图两侧同步。详见 Service/botfatherChannel.ts。
    // entry 来源:各入口(通讯录顶端横幅 contact_banner)在 showConversation 前写 pendingBotfatherOpenEntry
    // sentinel,此处一次性消费;未写入(会话列表点行 / 深链 / 路由恢复)缺省 "conversation"。消费后即清,
    // 避免下一次非标记进入误带上一次来源。
    if (
      channel.channelType === ChannelTypePerson &&
      isBotfatherChannelID(channel.channelID)
    ) {
      const entry = WKApp.shared.pendingBotfatherOpenEntry || "conversation";
      WKApp.shared.pendingBotfatherOpenEntry = undefined;
      // spec 关键属性为 source(进入 botfather 会话的来源枚举);entry 值即来源,按 spec 命名为 source。
      Dap.shared.track("botfather_opened", { source: entry });
    }
  }

  componentDidUpdate(
    prevProps: ChatContentPageProps,
    prevState: ChatContentPageState
  ) {
    if (this.props.workspaceEmbedding !== prevProps.workspaceEmbedding) {
      this.layoutObserver?.dispose();
      this.layoutObserver = undefined;
      if (!this.props.workspaceEmbedding && this.layoutRef.current) {
        this.layoutObserver = observeChatLayout(this.layoutRef.current, (contentLayout) => {
          this.setState({ contentLayout });
        });
      }
    }
    this.updateResponsiveLayout();
    if (!prevState.showChannelSetting && this.state.showChannelSetting) {
      document.addEventListener("keydown", this._onChannelSettingKeyDown, true);
      this.shouldRestoreChannelSettingFocus = false;
      this.channelSettingPanelRef.current?.focus();
    } else if (prevState.showChannelSetting && !this.state.showChannelSetting) {
      document.removeEventListener(
        "keydown",
        this._onChannelSettingKeyDown,
        true
      );
      if (this.shouldRestoreChannelSettingFocus) {
        this.channelSettingReturnFocusElement?.focus();
      }
      this.shouldRestoreChannelSettingFocus = false;
      this.channelSettingReturnFocusElement = undefined;
    }

    // embed↔full 切换时清理侧栏状态。
    if (this.props.workspaceEmbedding !== prevProps.workspaceEmbedding) {
      this.updateWorkspaceEmbedding(this.props.workspaceEmbedding);
    }

    // 子区打开(入口二:页内子区选择)——本页 channel 为父群、activeThread 身份(channel_id)变化即一次
    // subchannel_opened,覆盖 onOpenThreadPanel / onThreadSelect 这类不 remount 只改 state 的页内入口。
    // 与挂载入口(入口一)的去重由 subchannelOpenFromMount 的 sentinel 负责:本支照发,若用户随后把该
    // 子区导航成完整视图/搜索/文件预览触发 remount,挂载处凭 sentinel 跳过,故一次开子区手势只发一次。
    // 文件预览等不改 activeThread → 不误发;关闭(→null)也不发。channel_id 归一/判空在 helper 内。
    const openEvent = subchannelOpenFromThreadChange(
      this.state.activeThread,
      prevState.activeThread?.channel_id
    );
    if (openEvent) {
      Dap.shared.track("subchannel_opened", openEvent);
    }
    const { channel } = this.props;
    const channelChanged =
      channel.channelID !== prevProps.channel.channelID ||
      channel.channelType !== prevProps.channel.channelType;

    if (channelChanged) {
      this.loadChannelInfo();
      cancelHostAttachmentRequests();
      this._filePreviewTakeoverSeq++;
      chatPageTitleController.activate(channel, this.titlePageOwner);
      this._clearChannelSearchState();
      if (
        this.state.channelSearchPreviewFile ||
        this.state.webhookIssuePreviewTarget
      ) {
        this.setState({
          channelSearchPreviewFile: null,
          webhookIssuePreviewTarget: null,
        });
      }
    }

    if (
      this.props.initialShowChannelSearch &&
      !prevProps.initialShowChannelSearch &&
      isChannelSearchEnabled(channel)
    ) {
      this._openChannelSearchPanel();
    }

    if (!isChannelSearchEnabled(channel) && this.state.showChannelSearch) {
      this._clearChannelSearchState();
      this._invalidateFilePreviewTakeover();
      this.setState({
        showChannelSearch: false,
        channelSearchPreviewFile: null,
        previewReturnChannelSearch: false,
      });
    }

    if (channelChanged) {
      // 打开全部子区列表；内嵌模式只消费标记。
      if (WKApp.shared.pendingThreadPanel === channel.channelID) {
        WKApp.shared.pendingThreadPanel = undefined;
        if (this.state.workspaceEmbedding) return;
        this._openRightPanel("thread");
        return;
      }

      // 打开文件预览；内嵌模式只消费标记。
      if (WKApp.shared.pendingFilePreview) {
        const pending = WKApp.shared.pendingFilePreview;
        WKApp.shared.pendingFilePreview = undefined;
        if (this.state.workspaceEmbedding) return;
        this.setState(
          openChatRightPanel("filePreview", {
            previewFile: {
              url: pending.url,
              sourceUrl: pending.sourceUrl,
              downloadUrl: pending.downloadUrl,
              name: pending.name,
              extension: pending.extension,
              size: pending.size,
              messageId: pending.messageId,
              sourceChannelId: pending.sourceChannelId,
              sourceChannelType: pending.sourceChannelType,
              messageSeq: pending.messageSeq,
              fromUID: pending.fromUID,
              conversationDigest: pending.conversationDigest,
            },
            activePreviewMessageId: pending.messageId || null,
          })
        );
        return;
      }
    }

    // 子区 channelInfo 加载后，检查是否需要获取父群组信息
    if (
      channel.channelType === ChannelTypeCommunityTopic &&
      !this.parentGroupChannel
    ) {
      const channelInfo = getImChannelInfo(WKSDK.shared(), channel);
      const parentGroupNo =
        channelInfo?.orgData?.parentGroupNo ||
        parseThreadChannelId(channel.channelID)?.groupNo;
      if (parentGroupNo) {
        this.parentGroupChannel = new Channel(parentGroupNo, ChannelTypeGroup);
        if (!getImChannelInfo(WKSDK.shared(), this.parentGroupChannel)) {
          void fetchImChannelInfo(WKSDK.shared(), this.parentGroupChannel);
        }
      }
    }
  }

  private _onPendingThread?: (detail: {
    groupNo: string;
    thread: Thread | null;
  }) => void;
  private _onCloseThreadPanel?: () => void;
  private _onToggleSummaryPanel?: (data: {
    channelId: string;
    channelType: number;
    summaryPanelView: "history" | "new";
    forceOpen?: boolean;
  }) => void;
  private _onOpenChannelSearch?: (data: {
    channelId: string;
    channelType: number;
  }) => void;
  // Monotonic guard: ignores stale host-takeover results from superseded clicks.
  private _filePreviewTakeoverSeq = 0;

  componentWillUnmount() {
    this.stopChannelInfoLoad?.();
    this.unsubscribeHostPreview?.();
    this.layoutObserver?.dispose();
    document.removeEventListener(
      "keydown",
      this._onChannelSettingKeyDown,
      true
    );
    chatPageTitleController.deactivate(this.titlePageOwner);
    this._filePreviewTakeoverSeq++;
    cancelHostAttachmentRequests();
    WKApp.mittBus.off("wk:file-preview", this._onFilePreview);
    if (this._onPendingThread) {
      WKApp.mittBus.off("wk:pending-thread", this._onPendingThread);
    }
    if (this._onCloseThreadPanel) {
      WKApp.mittBus.off("wk:close-thread-panel", this._onCloseThreadPanel);
    }
    if (this._onToggleSummaryPanel) {
      WKApp.mittBus.off("wk:toggle-summary-panel", this._onToggleSummaryPanel);
    }
    if (this._onOpenChannelSearch) {
      WKApp.mittBus.off("wk:open-channel-search", this._onOpenChannelSearch);
    }
    this._unsubscribeChannelSearchConfig?.();
    this._unsubscribeChannelSearchConfig = undefined;
    this._unsubscribeChannelInfoListener?.();
    this._unsubscribeChannelInfoListener = undefined;
  }

  private loadChannelInfo() {
    this.stopChannelInfoLoad?.();
    this.stopChannelInfoLoad = loadChatChannelInfo(this.props.channel, (channelInfoLoading) => {
      this.setState({ channelInfoLoading });
    });
  }

  private getThreadStatus(channelInfo?: ChannelInfo | null) {
    return (channelInfo?.orgData?.thread as any)?.status as
      | ThreadStatus
      | undefined;
  }

  private handleConversationMessageSent = () => {
    const { channel } = this.props;
    if (channel.channelType !== ChannelTypeCommunityTopic) return;

    const channelInfo = getImChannelInfo(WKSDK.shared(), channel);
    if (this.getThreadStatus(channelInfo) !== ThreadStatus.Archived) return;

    const threadInfo = parseThreadChannelId(channel.channelID);
    if (threadInfo) {
      void this.reconcileConversationThreadAfterMessageSent(
        threadInfo.groupNo,
        threadInfo.shortId,
        channel
      );
    }
  };

  private async reconcileConversationThreadAfterMessageSent(
    groupNo: string,
    shortId: string,
    channel: Channel
  ) {
    try {
      const updatedThread = await this.fetchThreadAfterMessageSent(
        groupNo,
        shortId
      );
      if (!this.props.channel.isEqual(channel)) return;
      if (updatedThread.status === ThreadStatus.Archived) return;

      // 独立子区会话的提示来自 SDK channelInfo。
      // 只有 threadGet 确认非归档后才刷新 channelInfo，避免 UI 先切活跃再回退。
      await this.refreshCurrentThreadChannelInfo(channel);
      if (!this.props.channel.isEqual(channel)) return;

      this.setState({});
    } catch {
      // Message sending already succeeded. Leave the archived prompt visible
      // until a backend-backed channel-info refresh confirms the state change.
    }
  }

  private async fetchThreadAfterMessageSent(
    groupNo: string,
    shortId: string
  ): Promise<Thread> {
    let lastThread: Thread | null = null;

    for (const delay of THREAD_REACTIVATE_REFRESH_DELAYS_MS) {
      if (delay > 0) {
        await this.sleep(delay);
      }

      const updatedThread = await WKApp.dataSource.channelDataSource.threadGet(
        groupNo,
        shortId
      );
      lastThread = updatedThread;
      if (updatedThread.status !== ThreadStatus.Archived) {
        break;
      }
    }

    if (!lastThread) {
      throw new Error("thread status refresh failed");
    }
    return lastThread;
  }

  private async refreshCurrentThreadChannelInfo(channel: Channel) {
    deleteImChannelInfo(WKSDK.shared(), channel);
    await fetchImChannelInfo(WKSDK.shared(), channel);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  }

  private renderConversationHeaderAvatar(
    channel: Channel,
    isThreadChannel: boolean
  ): ReactNode {
    if (channel.channelType === ChannelTypeGroup) {
      return (
        <WKAvatar
          key={WKApp.shared.getChannelAvatarTag(channel)}
          channel={channel}
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--wk-avatar-radius, 50%)",
            flexShrink: 0,
          }}
        />
      );
    }
    if (isThreadChannel) {
      return (
        <div className="wk-chat-conversation-header-channel-thread-icon">
          <ThreadIcon size={18} color="var(--wk-text-secondary, #5C6070)" />
        </div>
      );
    }
    return <img alt="" src={WKApp.shared.avatarChannel(channel)} />;
  }

  private renderConversationHeaderTitle(
    channel: Channel,
    channelInfo: ChannelInfo | undefined,
    threadParentGroupNo: string | undefined
  ): ReactNode {
    const name = getImChannelDisplayName(channelInfo) || t(
      this.state.channelInfoLoading ? "base.chatPage.loadingName" : "base.chatPage.nameUnavailable"
    );
    if (
      channel.channelType !== ChannelTypeCommunityTopic ||
      !threadParentGroupNo
    ) {
      return channel.channelType === ChannelTypeGroup ? (
        <WorkspaceGroupTitle channelId={channel.channelID} channelType={channel.channelType}>
          {name}
        </WorkspaceGroupTitle>
      ) : name;
    }

    return (
      <>
        <button
          type="button"
          className="wk-chat-conversation-header-parent-group"
          onClick={() => {
            WKApp.endpoints.showConversation(
              this.parentGroupChannel ||
                new Channel(threadParentGroupNo, ChannelTypeGroup)
            );
          }}
        >
          {getImChannelInfo(
            WKSDK.shared(),
            new Channel(threadParentGroupNo, ChannelTypeGroup)
          )?.title || threadParentGroupNo}
        </button>
        <span className="wk-chat-conversation-header-separator">
          <ChevronRight aria-hidden="true" size={14} />
        </span>
        <span className="wk-chat-conversation-header-thread-name">
          {name}
        </span>
      </>
    );
  }

  private renderConversationHeaderActions(
    channel: Channel,
    isThreadChannel: boolean,
    showChannelSetting: boolean,
    workspaceEmbedding: boolean
  ): ReactNode {
    return (
      <>
        {WKApp.endpoints
          .channelHeaderRightItems(channel)
          .map((item: ReactNode, index: number) => (
            <div
              key={index}
              className="wk-chat-conversation-header-right-item"
              onClick={(event) => event.stopPropagation()}
            >
              {item}
            </div>
          ))}
        {!workspaceEmbedding &&
          !isThreadChannel &&
          channel.channelType === ChannelTypeGroup &&
          WKApp.remoteConfig.threadOn && (
            <button
              type="button"
              data-testid="chat-thread-panel-entry"
              className="wk-chat-conversation-header-right-item"
              aria-label={t("base.chatPage.threadPanel")}
              aria-expanded={this.state.showThreadPanel}
              onClick={(event) => {
                event.stopPropagation();
                const isThreadListVisibleNow =
                  this.state.showThreadPanel &&
                  !this.state.previewFile &&
                  !this.state.activeThread;
                if (!isThreadListVisibleNow) {
                  Dap.shared.track("channel_subchannel_panel_opened", {
                    channel_id: stripSpacePrefix(channel.channelID),
                  });
                  this._openRightPanel("thread");
                } else {
                  this._closeThreadPanel();
                }
              }}
              title={t("base.chatPage.threadPanel")}
            >
              <ThreadIcon size={20} color="currentColor" />
            </button>
          )}
        {!workspaceEmbedding && (
        <div
          data-testid="chat-channel-setting-entry"
          className="wk-chat-conversation-header-right-item"
          role="button"
          tabIndex={0}
          aria-controls="chat-channel-setting-panel"
          aria-expanded={showChannelSetting}
          aria-label={t("base.channelSetting.title")}
          onClick={(event) => {
            event.stopPropagation();
            if (this.state.showChannelSetting) {
              this._closeChannelSetting();
              return;
            }
            this.channelSettingReturnFocusElement = event.currentTarget;
            if (channel.channelType === ChannelTypeGroup) {
              Dap.shared.track("group_info_panel_opened", {
                channel_id: stripSpacePrefix(channel.channelID),
              });
            }
            this._openRightPanel("channelSetting");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 16 16"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M4.66658 7.99998C4.66658 8.92045 3.92039 9.66665 2.99992 9.66665C2.07945 9.66665 1.33325 8.92045 1.33325 7.99998C1.33325 7.07951 2.07945 6.33331 2.99992 6.33331C3.92039 6.33331 4.66658 7.07951 4.66658 7.99998Z" />
            <path d="M9.66659 7.99998C9.66659 8.92045 8.92039 9.66665 7.99992 9.66665C7.07945 9.66665 6.33325 8.92045 6.33325 7.99998C6.33325 7.07951 7.07945 6.33331 7.99992 6.33331C8.92039 6.33331 9.66659 7.07951 9.66659 7.99998Z" />
            <path d="M12.9999 9.66665C13.9204 9.66665 14.6666 8.92045 14.6666 7.99998C14.6666 7.07951 13.9204 6.33331 12.9999 6.33331C12.0795 6.33331 11.3333 7.07951 11.3333 7.99998C11.3333 8.92045 12.0795 9.66665 12.9999 9.66665Z" />
          </svg>
          <div className="wk-conversation-header-mask" />
        </div>
        )}
      </>
    );
  }

  render(): React.ReactNode {
    const { channel, initLocateMessageSeq } = this.props;
    const {
      showChannelSetting,
      selectionMode,
      selectedCount,
      showThreadPanel,
      activeThread,
      previewFile,
      showSummaryPanel,
      summaryPanelView,
      showChannelSearch,
      channelSearchPreviewFile,
      webhookIssuePreviewTarget,
    } = this.state;
    // 子区页面不显示讨论串按钮
    const isThreadChannel = channel.channelType === ChannelTypeCommunityTopic;
    const channelInfo = getImChannelInfo(WKSDK.shared(), channel);
    const threadParentGroupNo = isThreadChannel
      ? (channelInfo?.orgData?.parentGroupNo as string | undefined) ||
        this.parentGroupChannel?.channelID ||
        parseThreadChannelId(channel.channelID)?.groupNo
      : undefined;
    const threadStatus = this.getThreadStatus(channelInfo);
    const workspaceEmbedding = !!this.state.workspaceEmbedding;
    const hostPreviewSource = previewFile?.hostPreview || channelSearchPreviewFile?.hostPreview
      ? null : this.state.hostPreviewSource;
    const panelLayout = hostPreviewSource
      ? "overlay"
      : this.state.contentLayout?.panelLayout || "overlay";
    const previewInThreadContext = !!(
      previewFile && activeThread &&
      previewFile.sourceChannelType === ChannelTypeCommunityTopic &&
      previewFile.sourceChannelId === activeThread.channel_id
    );
    const hostPreviewingParent = !!(hostPreviewSource && !showChannelSearch &&
      hostPreviewSource.channelId === channel.channelID &&
      hostPreviewSource.channelType === channel.channelType);
    const auxiliaryVisible = !workspaceEmbedding && !hostPreviewingParent &&
      !!(showThreadPanel || previewFile || showChannelSearch);
    const parentHidden = auxiliaryVisible &&
      (panelLayout === "overlay" || previewInThreadContext);
    return (
      <div
        ref={this.layoutRef}
        data-chat-panel-layout={auxiliaryVisible ? panelLayout : undefined}
        data-chat-parent-hidden={parentHidden || undefined}
        data-chat-thread-hidden={hostPreviewingParent || undefined}
        className={classNames(
          "wk-chat-content-right",
          !workspaceEmbedding && showChannelSetting && "wk-chat-channelsetting-open",
          !workspaceEmbedding && showChannelSearch && "wk-chat-channel-search-open",
          !workspaceEmbedding && (showThreadPanel || previewFile) && "wk-chat-threadpanel-open",
          !workspaceEmbedding && showThreadPanel && !previewFile && "wk-chat-threadpanel-compact",
          !workspaceEmbedding && showSummaryPanel && "wk-chat-summary-panel-open",
          !workspaceEmbedding && webhookIssuePreviewTarget && "wk-chat-webhook-preview-open"
        )}
      >
        <ConversationWindow
          client={this.chatRuntime.client}
          channel={channel}
          errorModuleName={t("base.chatPage.chatModuleName")}
          bindConversationContext={this.chatRuntime.bindConversationContext}
          surfaceRef={this.chatContentRef}
          inactive={!workspaceEmbedding && (showChannelSetting || parentHidden)}
          headerMode={
            workspaceEmbedding ? "selection-only" : undefined
          }
          header={{
            avatar: this.renderConversationHeaderAvatar(
              channel,
              isThreadChannel
            ),
            title: this.renderConversationHeaderTitle(
              channel,
              channelInfo,
              threadParentGroupNo
            ),
            titleClassName: classNames(
              isThreadChannel &&
                threadParentGroupNo &&
                "wk-chat-conversation-header-channel-info-name--thread"
            ),
            onBack: workspaceEmbedding
              ? undefined
              : () => {
                  WKApp.routeRight.pop();
                },
            actions: this.renderConversationHeaderActions(
              channel,
              isThreadChannel,
              showChannelSetting,
              workspaceEmbedding
            ),
          }}
          selection={
            selectionMode
              ? {
                  active: true,
                  count: selectedCount,
                  label: t("base.chatPage.selectionCount", {
                    values: { count: selectedCount },
                  }),
                  cancelLabel: t("base.common.cancel"),
                  onCancel: () => {
                    this.conversationContext?.clearCheckedMessages();
                    this.conversationContext?.setEditOn(false);
                  },
                }
              : undefined
          }
          conversationProps={{
            initLocateMessageSeq,
            onContext: (ctx) => {
              this.conversationContext = ctx;
              (WKApp.shared as any).activeConversationContext = ctx;
              this.setState({
                selectionMode: ctx.editOn(),
                selectedCount: ctx.getCheckedMessageCount(),
              });
            },
            onSelectionStateChange: ({ editOn, checkedCount }) => {
              this.setState({
                selectionMode: editOn,
                selectedCount: checkedCount,
              });
            },
            onOpenThreadPanel: (threadChannelId, threadName) => {
              const workspaceEmbedding = this.state.workspaceEmbedding;
              if (workspaceEmbedding && threadChannelId) {
                // 子区入口：导航到完整消息页对应子区。
                workspaceEmbedding.openConversation(
                  new Channel(threadChannelId, ChannelTypeCommunityTopic)
                );
                return;
              }
              const threadInfo = parseThreadChannelId(threadChannelId);
              if (threadInfo) {
                this._openRightPanel("thread", {
                  activeThread: buildThreadStub(
                    threadInfo.shortId,
                    threadInfo.groupNo,
                    threadChannelId,
                    threadName
                  ),
                });
              }
            },
            onOpenWebhookPreview: this._openWebhookPreview,
            chatBg:
              WKApp.config.themeMode === ThemeMode.dark
                ? undefined
                : require("./assets/chat_bg.svg").default,
            activePreviewMessageId: this.state.activePreviewMessageId,
            inputNotice:
              isThreadChannel && threadStatus === ThreadStatus.Archived
                ? t("base.chatPage.archivedThreadNotice")
                : undefined,
            onMessageSent: this.handleConversationMessageSent,
          }}
        />

        {!workspaceEmbedding && showChannelSetting && (
          <div
            className="wk-chat-channelsetting-mask"
            data-testid="chat-channel-setting-mask"
            onClick={this._closeChannelSetting}
          />
        )}

        {!workspaceEmbedding && (
        <div
          id="chat-channel-setting-panel"
          ref={this.channelSettingPanelRef}
          className={classNames("wk-chat-channelsetting")}
          role="dialog"
          aria-modal={showChannelSetting || undefined}
          aria-hidden={showChannelSetting ? undefined : true}
          aria-label={t("base.channelSetting.title")}
          tabIndex={-1}
          {...(!showChannelSetting ? { inert: "" } : {})}
        >
          <ErrorBoundary moduleName={t("base.chatPage.channelSettings")}>
            <ChannelSetting
              conversationContext={this.conversationContext}
              key={channel.getChannelKey()}
              channel={channel}
              onClose={() => {
                this._closeChannelSetting();
              }}
            ></ChannelSetting>
          </ErrorBoundary>
        </div>
        )}

        {!workspaceEmbedding && showChannelSearch && (
          <div className="wk-chat-channel-search-panel" data-desktop-overlay="">
            <ErrorBoundary moduleName={t("base.chatPage.searchModuleName")}>
              <div
                className={classNames(
                  "wk-chat-channel-search-stack",
                  channelSearchPreviewFile &&
                    "wk-chat-channel-search-stack--previewing"
                )}
              >
                <div
                  className="wk-chat-channel-search-main"
                  aria-hidden={channelSearchPreviewFile ? true : undefined}
                  {...(channelSearchPreviewFile ? { inert: "" } : {})}
                >
                  <ChannelSearchPanel
                    key={channel.getChannelKey()}
                    channel={channel}
                    conversationContext={this.conversationContext}
                    dataSource={this.getChannelSearchDataSource(channel)}
                    onPreviewFile={this._onSearchFilePreview}
                    onPreviewMedia={this._onSearchMediaPreview}
                    initialState={this.channelSearchPanelState}
                    onStateChange={this._onChannelSearchStateChange}
                    onClose={this._closeChannelSearchPanel}
                  />
                </div>
                {channelSearchPreviewFile && (
                  <div className="wk-chat-channel-search-preview">
                    <FilePreviewPanel
                      file={channelSearchPreviewFile}
                      showOpenExternal={false}
                      onClose={() => {
                        this._filePreviewTakeoverSeq++;
                        cancelHostAttachmentRequests();
                        this.setState({ channelSearchPreviewFile: null });
                      }}
                    />
                  </div>
                )}
              </div>
            </ErrorBoundary>
          </div>
        )}

        {/* 统一侧边面板：子区 + 文件预览共用一个壳子（仅群聊） */}
        {!workspaceEmbedding &&
          !isThreadChannel &&
          channel.channelType === ChannelTypeGroup &&
          (WKApp.remoteConfig.threadOn || previewFile) &&
          (showThreadPanel || previewFile) && (
            <ThreadPanel
              groupNo={WKApp.remoteConfig.threadOn ? channel.channelID : undefined}
              thread={activeThread}
              layout={panelLayout}
              compact={!previewFile}
              previewInThreadContext={previewInThreadContext}
              onBackFromThread={this.state.threadFromDirectory ? undefined : this._closeThreadPanel}
              onClose={this._closeThreadPanel}
              onThreadSelect={(thread) => {
                this.setState({
                  activeThread: thread,
                  threadFromDirectory: !!thread,
                });
              }}
              filePreview={previewFile}
              showBackButton={this.state.previewHadThreadShell}
              onFilePreviewClose={() => {
                this._closePreview();
              }}
              onReplyFile={(info) => {
                // 触发回复功能，保持文件预览面板打开
                this.conversationContext?.replyToFileMessage?.(info);
              }}
              onFilePreviewChange={(file) => {
                this._onFilePreview(file);
              }}
            />
          )}

        {/* 子区频道或私聊的文件预览（使用 ThreadPanel 壳子，获得拖拽功能） */}
        {!workspaceEmbedding &&
          (isThreadChannel || channel.channelType === ChannelTypePerson) &&
          previewFile && (
            <ThreadPanel
              layout={panelLayout}
              onClose={() => this._closePreview(true)}
              filePreview={previewFile}
              onFilePreviewClose={() => this._closePreview(true)}
              onReplyFile={(info) => {
                // 触发回复功能，保持文件预览面板打开
                this.conversationContext?.replyToFileMessage?.(info);
              }}
              onFilePreviewChange={(file) => {
                this._onFilePreview(file);
              }}
            />
          )}

        {!workspaceEmbedding && showSummaryPanel && (
          <div className="wk-summary-panel" data-desktop-overlay="">
            {WKApp.endpoints.chatSummaryPanel(
              channel,
              () => this.setState({ showSummaryPanel: false }),
              summaryPanelView
            )}
          </div>
        )}

        {!workspaceEmbedding && webhookIssuePreviewTarget && (
          <ErrorBoundary moduleName={t("base.message.webhookPreview.title")}>
            <WebhookIssuePreviewPanel
              target={webhookIssuePreviewTarget}
              onClose={() => this.setState({ webhookIssuePreviewTarget: null })}
            />
          </ErrorBoundary>
        )}
      </div>
    );
  }
}

const SIDEBAR_TAB_KEY = "wk_sidebar_active_tab";

function getSavedTab(): SidebarTab {
  try {
    const v = localStorage.getItem(SIDEBAR_TAB_KEY);
    // 兼容旧值：group → follow, dm → recent
    if (v === "follow" || v === "recent") return v;
    if (v === "group") return "follow";
    if (v === "dm") return "recent";
  } catch {}
  return "follow";
}

interface ChatPageState {
  activeTab: SidebarTab;
  currentSpaceName: string;
  pendingConfirm: null | { onOk: () => void }; // 附件切换确认弹窗
  recentUnreadJumpToken: number;
}

export default class ChatPage extends Component<any, ChatPageState> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  vm!: ChatVM;
  spaceListRef: SpaceList | null = null;
  openCreateCategoryRef: React.MutableRefObject<(() => void) | null> = {
    current: null,
  };
  constructor(props: any) {
    super(props);
    this.state = {
      activeTab: getSavedTab(),
      currentSpaceName: WKApp.config.appName,
      pendingConfirm: null,
      recentUnreadJumpToken: 0,
    };
  }

  _handleTabChange = (tab: SidebarTab) => {
    try {
      localStorage.setItem(SIDEBAR_TAB_KEY, tab);
    } catch {}
    this.setState({ activeTab: tab });
  };

  _handleRecentUnreadNavigate = () => {
    this.setState((state) => ({
      recentUnreadJumpToken: state.recentUnreadJumpToken + 1,
    }));
  };

  private _onSpaceChanged?: (space: any) => void;
  private _onSwitchTab?: (tab: string) => void;
  private _unsubscribeRemoteConfig?: () => void;

  componentDidMount() {
    // 监听 space-changed，同步 spacename 到 state
    this._onSpaceChanged = (space: any) => {
      this.setState({
        currentSpaceName:
          (space as Space | undefined)?.name ?? WKApp.config.appName,
      });
    };
    WKApp.mittBus.on("space-changed", this._onSpaceChanged);

    this._onSwitchTab = (tab: string) => {
      // 兼容旧事件：group → follow, dm → recent
      if (tab === "follow" || tab === "recent") {
        this._handleTabChange(tab as SidebarTab);
      } else if (tab === "group") {
        this._handleTabChange("follow");
      } else if (tab === "dm") {
        this._handleTabChange("recent");
      }
    };
    WKApp.mittBus.on("wk:switch-sidebar-tab", this._onSwitchTab);

    this._unsubscribeRemoteConfig = WKApp.remoteConfig.addConfigChangeListener(
      () => {
        if (
          WKApp.remoteConfig.disableUserCreateSpace &&
          this.vm?.showSpaceCreate
        ) {
          this.vm.showSpaceCreate = false;
        } else {
          this.forceUpdate();
        }
      }
    );

    // 初始化：主动拉当前 Space 名称（首次渲染时 space-changed 还没触发）
    const currentSpaceId = WKApp.shared.currentSpaceId;
    if (currentSpaceId) {
      SpaceService.shared
        .getMySpaces()
        .then((spaces) => {
          const space = spaces.find((s) => s.space_id === currentSpaceId);
          if (space) {
            this.setState({ currentSpaceName: space.name });
          }
        })
        .catch(() => {});
    }
  }

  componentWillUnmount() {
    if (this._onSpaceChanged) {
      WKApp.mittBus.off("space-changed", this._onSpaceChanged);
    }
    if (this._onSwitchTab) {
      WKApp.mittBus.off("wk:switch-sidebar-tab", this._onSwitchTab);
    }
    this._unsubscribeRemoteConfig?.();
  }

  render(): ReactNode {
    return (
      <Provider
        create={() => {
          this.vm = new ChatVM();
          return this.vm;
        }}
        render={(vm: ChatVM) => {
          const { activeTab, recentUnreadJumpToken } = this.state;
          // filter 用于 ConversationList
          // follow Tab 用 group（分组视图），recent Tab 用 all（所有会话混合）
          const filter: ConvFilter = activeTab === "follow" ? "group" : "all";
          return (
            <div className="wk-chat">
              <div
                className={classNames(
                  "wk-chat-content",
                  vm.selectedConversation ? "wk-conversation-open" : undefined
                )}
              >
                <div className="wk-chat-content-left">
                  <div className="wk-chat-search" data-desktop-chrome="header">
                    {/* Space 名称（原下拉筛选位置） */}
                    <div className="wk-chat-space-name">
                      {this.state.currentSpaceName}
                    </div>
                    <div className="wk-chat-header-actions">
                      <NavSignalBadge showText />
                      <div
                        data-testid="chat-global-search-entry"
                        className="wk-chat-header-btn"
                        onClick={() => {
                          vm.showGlobalSearch = true;
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M7.00004 1.33337C3.87043 1.33337 1.33337 3.87043 1.33337 7.00004C1.33337 10.1297 3.87043 12.6667 7.00004 12.6667C8.20366 12.6667 9.31963 12.2915 10.2373 11.6516L12.9596 14.3738C13.3501 14.7643 13.9833 14.7643 14.3738 14.3738C14.7643 13.9833 14.7643 13.3501 14.3738 12.9596L11.6516 10.2373C12.2915 9.31963 12.6667 8.20366 12.6667 7.00004C12.6667 3.87043 10.1297 1.33337 7.00004 1.33337ZM3.33337 7.00004C3.33337 4.975 4.975 3.33337 7.00004 3.33337C9.02509 3.33337 10.6667 4.975 10.6667 7.00004C10.6667 9.02509 9.02509 10.6667 7.00004 10.6667C4.975 10.6667 3.33337 9.02509 3.33337 7.00004Z"
                          />
                        </svg>
                      </div>
                      {/* + 按钮：群聊 Tab 额外显示「创建分组」，其余菜单项保持不变 */}
                      <Popover
                        onClickOutSide={() => {
                          vm.showAddPopover = false;
                        }}
                        className="wk-chat-popover"
                        position="bottomRight"
                        visible={vm.showAddPopover}
                        showArrow={false}
                        trigger="custom"
                        content={
                          <div>
                            {/* 关注 Tab 下在顶部插入「创建分组」，对齐 ChatMenusPopover li 样式 */}
                            {activeTab === "follow" && (
                              <div
                                className="wk-chat-menu-item"
                                onClick={() => {
                                  vm.showAddPopover = false;
                                  this.openCreateCategoryRef.current?.();
                                }}
                              >
                                <div className="wk-chatmenuspopover-avatar">
                                  <Columns2 size={16} strokeWidth={1.5} />
                                </div>
                                <div className="wk-chatmenuspopover-title">
                                  {t("base.chatPage.createCategory")}
                                </div>
                              </div>
                            )}
                            <ChatMenusPopover
                              onItem={() => {
                                vm.showAddPopover = false;
                              }}
                            />
                          </div>
                        }
                      >
                        <div
                          data-testid="chat-add-entry"
                          className="wk-chat-header-btn"
                          onClick={() => {
                            vm.showAddPopover = !vm.showAddPopover;
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M13.3333 8.66667C13.8856 8.66667 14.3333 8.21895 14.3333 7.66667C14.3333 7.11438 13.8856 6.66667 13.3333 6.66667L8.66667 6.66667L8.66667 2C8.66667 1.44772 8.21895 1 7.66667 1C7.11438 1 6.66667 1.44772 6.66667 2L6.66667 6.66667L2 6.66667C1.44772 6.66667 1 7.11438 1 7.66667C1 8.21895 1.44772 8.66667 2 8.66667L6.66667 8.66667V13.3333C6.66667 13.8856 7.11438 14.3333 7.66667 14.3333C8.21895 14.3333 8.66667 13.8856 8.66667 13.3333V8.66667L13.3333 8.66667Z" />
                          </svg>
                        </div>
                      </Popover>
                    </div>
                  </div>
                  {/* 关注/最近 Tab Bar — Provider 给 tab 角标 + 列表共享一份 sidebar/sync */}
                  <FollowSidebarProvider>
                    <SidebarTabBarWithBadges
                      conversations={vm.conversations}
                      recentLoading={vm.loading}
                      activeTab={activeTab}
                      onTabChange={this._handleTabChange}
                      onRecentUnreadNavigate={this._handleRecentUnreadNavigate}
                    />
                    <div className="wk-chat-conversation-list">
                      {vm.loading ? (
                        <div className="wk-chat-conversation-list-loading">
                          <Spin style={{ marginTop: "20px" }} />
                        </div>
                      ) : activeTab === "recent" &&
                        vm.filteredConversations.length === 0 ? (
                        <div className="wk-chat-empty-guide">
                          <div style={{ fontSize: 28, marginBottom: 12 }}>
                            💬
                          </div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                              marginBottom: 6,
                            }}
                          >
                            {t("base.chatPage.emptyTitle")}
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              color: "#999",
                              marginBottom: 24,
                            }}
                          >
                            {t("base.chatPage.emptyDescription")}
                          </div>
                          <div style={{ display: "flex", gap: 12 }}>
                            <button
                              className="wk-chat-empty-guide-btn"
                              onClick={() => {
                                WKApp.endpoints.showConversationSelect?.(
                                  (channels) => {
                                    if (channels?.length > 0) {
                                      WKApp.endpoints.showConversation(
                                        channels[0]
                                      );
                                    }
                                  },
                                  t("base.chatPage.findContact")
                                );
                              }}
                            >
                              {t("base.chatPage.findContact")}
                            </button>
                            <button
                              className="wk-chat-empty-guide-btn"
                              onClick={() => {
                                const menus = WKApp.shared.chatMenus();
                                const groupMenu = menus.find(
                                  (m) => m.key === "start-group"
                                );
                                // 空态入口与「+」气泡里的 start-group 项(见 ChatMenusPopover
                                // 的 data-track)触发同一 groupMenu.onClick,但此按钮无 data-track,
                                // 声明式委托采不到(PR #1320 review P1-4)。两处互斥,这里补发一次
                                // 与气泡项一致的 channel_create_started。
                                if (groupMenu?.onClick) {
                                  Dap.shared.track("channel_create_started");
                                  groupMenu.onClick();
                                }
                              }}
                            >
                              {t("base.chatPage.startGroup")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <ErrorBoundary
                          moduleName={t(
                            "base.chatPage.conversationListModuleName"
                          )}
                        >
                          <ChatConversationList
                            conversations={vm.filteredConversations}
                            filter={filter}
                            select={WKApp.shared.openChannel}
                            scrollToUnreadToken={
                              activeTab === "recent"
                                ? recentUnreadJumpToken
                                : undefined
                            }
                            onOpenCreateCategoryRef={this.openCreateCategoryRef}
                            onGroupCreated={() =>
                              vm.reloadRequestConversationList()
                            }
                            onConversationClick={(
                              conversation: ConversationWrap
                            ) => {
                              const doSwitch = () => {
                                // 子区：直接进入完整视图（参考 Discord 逻辑）
                                if (
                                  conversation.channel.channelType ===
                                  ChannelTypeCommunityTopic
                                ) {
                                  WKApp.mittBus.emit(
                                    "wk:close-thread-panel",
                                    undefined
                                  );
                                  vm.selectedConversation = conversation;
                                  // 在 sidebar 列表里点击：保持当前 tab，
                                  // 不要被 EndpointCommon 强切到 recent。
                                  WKApp.endpoints.showConversation(
                                    conversation.channel,
                                    { fromSidebarList: true }
                                  );
                                  vm.notifyListener();
                                  return;
                                }
                                // 普通会话：关闭子区面板
                                WKApp.mittBus.emit(
                                  "wk:close-thread-panel",
                                  undefined
                                );
                                vm.selectedConversation = conversation;
                                WKApp.endpoints.showConversation(
                                  conversation.channel,
                                  { fromSidebarList: true }
                                );
                                vm.notifyListener();
                              };
                              const guard = WKApp.shared.pendingAttachmentGuard;
                              if (guard && !guard()) {
                                this.setState({
                                  pendingConfirm: { onOk: doSwitch },
                                });
                                return;
                              }
                              doSwitch();
                            }}
                            onClearMessages={this.vm.clearMessages.bind(
                              this.vm
                            )}
                            onThreadOverflowClick={(groupNo: string) => {
                              // 通过 mittBus 通知导航到父群聊子区列表
                              WKApp.mittBus.emit("wk:pending-thread", {
                                groupNo,
                                thread: null,
                              });
                              // 若当前不是目标群聊，切换频道
                              if (this.props.channel?.channelID !== groupNo) {
                                WKApp.shared.pendingThreadPanel = groupNo;
                                const groupConv = vm.filteredConversations.find(
                                  (c) =>
                                    c.channel.channelType ===
                                      ChannelTypeGroup &&
                                    c.channel.channelID === groupNo
                                );
                                if (groupConv) {
                                  vm.selectedConversation = groupConv;
                                  vm.notifyListener();
                                }
                                WKApp.endpoints.showConversation(
                                  new Channel(groupNo, ChannelTypeGroup),
                                  { fromSidebarList: true }
                                );
                              }
                            }}
                          />
                        </ErrorBoundary>
                      )}
                    </div>
                  </FollowSidebarProvider>
                </div>
              </div>
              {!WKApp.remoteConfig.disableUserCreateSpace && (
                <SpaceCreate
                  visible={vm.showSpaceCreate}
                  onClose={() => {
                    vm.showSpaceCreate = false;
                  }}
                  onSuccess={() => {
                    this.spaceListRef?.loadSpaces();
                  }}
                />
              )}
              <WKModal
                size="full"
                className="wk-global-search-modal"
                visible={vm.showGlobalSearch}
                onCancel={() => {
                  vm.showGlobalSearch = false;
                }}
              >
                <ErrorBoundary moduleName={t("base.chatPage.searchModuleName")}>
                  <GlobalSearch
                    onClick={(item, type: string) => {
                      void handleGlobalSearchClick(item, type, () => {
                        vm.showGlobalSearch = false;
                      });
                    }}
                    onOpenDoc={(item) => {
                      // Open the clicked cloud-doc in the standalone `/d/:docId`
                      // page. buildDocLink intentionally emits no Space locator;
                      // authenticated open-context resolves canonical addressing. The
                      // `/d` namespace is intercepted by apps/web Layout OUTSIDE
                      // the app shell and is not a RouteManager route, so it can't
                      // be reached by an in-shell soft push — open it in a new tab
                      // (same as DocsHome's onOpenInNewPage), which leaves this
                      // page untouched. The search modal stays open so the user
                      // can open more results in a row.
                      const url = buildDocLink({
                        docId: item.docId,
                        space: item.spaceId,
                      });
                      // Desktop shell: use the dedicated IPC bridge —
                      // setWindowOpenHandler routes everything to the system
                      // browser, so the web-era about:blank dance would never
                      // produce a usable window reference. buildDocLink emits
                      // a RELATIVE /d/<docId> path on file:// shells (the
                      // webOrigin allowlist degrades there), which the
                      // http(s)-only bridge would reject — resolve against
                      // the API origin so the standalone doc page opens in
                      // the browser.
                      const linksBridge = getElectronLinksBridge();
                      if (linksBridge) {
                        const absoluteUrl = resolveDocLinkForExternalOpen(
                          url,
                          apiUrlOrigin()
                        );
                        linksBridge
                          .openExternal(absoluteUrl)
                          .then((result) => {
                            if (!result.ok) {
                              Toast.warning(
                                t("base.globalSearch.docs.popupBlocked")
                              );
                            }
                          })
                          .catch(() => {
                            Toast.warning(
                              t("base.globalSearch.docs.popupBlocked")
                            );
                          });
                        return;
                      }
                      // Web: window.open(url, "_blank", "noopener,noreferrer")
                      // cannot be null-checked: per MDN, passing the
                      // `noopener` feature makes window.open return null on
                      // SUCCESS too, so `if (!opened)` false-positives on
                      // every successful open. Open about:blank first to get
                      // a truthful blocked/succeeded signal, then null the
                      // opener (equivalent noopener isolation) and navigate.
                      // Never fall back to location.href here: the search
                      // modal must stay open so several results can be opened
                      // in a row (see MeInfo/vm.tsx for the same pattern).
                      const opened = window.open("about:blank", "_blank");
                      if (!opened) {
                        Toast.warning(t("base.globalSearch.docs.popupBlocked"));
                        return;
                      }
                      try {
                        opened.opener = null;
                      } catch {
                        // A few sandboxes freeze the opener setter; continue
                        // navigating. about:blank is same-origin so the
                        // residual risk is already contained.
                      }
                      opened.location.href = url;
                    }}
                    onOpenDriveHit={(hit) => {
                      // Routing lives in openDriveFileHit (unit-tested directly)
                      // so folder-skip / URL / popup handling can't drift. On
                      // desktop the hit opens via the Electron links bridge.
                      openDriveFileHit(hit, {
                        open: (u, target) => window.open(u, target),
                        onBlocked: () =>
                          Toast.warning(
                            t("base.globalSearch.drive.popupBlocked")
                          ),
                        onUnavailable: () =>
                          Toast.warning(
                            t("base.globalSearch.drive.unavailable")
                          ),
                        getLinksBridge: () => getElectronLinksBridge() ?? null,
                        toAbsoluteUrl: (u) =>
                          resolveDocLinkForExternalOpen(u, apiUrlOrigin()),
                      });
                    }}
                    hideModal={() => {
                      vm.showGlobalSearch = false;
                    }}
                  />
                </ErrorBoundary>
              </WKModal>

              {/* 附件未发送切换会话确认弹窗 */}
              <WKModal
                visible={!!this.state.pendingConfirm}
                title={t("base.chatPage.unsentAttachmentTitle")}
                footerConfig={{
                  cancelText: t("base.common.cancel"),
                  okText: t("base.chatPage.continueSwitch"),
                  onOk: () => {
                    this.state.pendingConfirm?.onOk();
                    this.setState({ pendingConfirm: null });
                  },
                }}
                onCancel={() => this.setState({ pendingConfirm: null })}
                options={{ closable: false }}
              >
                <p className="wk-modal-confirm-text">
                  {t("base.chatPage.unsentAttachmentContent")}
                </p>
              </WKModal>
            </div>
          );
        }}
      />
    );
  }
}

interface ChatMenusPopoverState {
  chatMenus: ChatMenus[];
}

interface ChatMenusPopoverProps {
  onItem?: (menus: ChatMenus) => void;
}
class ChatMenusPopover extends Component<
  ChatMenusPopoverProps,
  ChatMenusPopoverState
> {
  constructor(props: any) {
    super(props);
    this.state = {
      chatMenus: [],
    };
  }
  componentDidMount() {
    this.setState({
      chatMenus: WKApp.shared.chatMenus(),
    });
  }

  render(): React.ReactNode {
    const { chatMenus } = this.state;
    const { onItem } = this.props;
    return (
      <div className="wk-chatmenuspopover">
        <ul>
          {chatMenus.map((c, i) => {
            return (
              <li
                key={i}
                data-track={
                  c.key === "start-group" ? "channel_create_started" : undefined
                }
                onClick={() => {
                  if (c.onClick) {
                    c.onClick();
                  }
                  if (onItem) {
                    onItem(c);
                  }
                }}
              >
                <div className="wk-chatmenuspopover-avatar">
                  <img alt="" src={c.icon}></img>
                </div>
                <div className="wk-chatmenuspopover-title">{c.title}</div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
}
