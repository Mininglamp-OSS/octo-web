import React, { Component, ReactNode } from "react";
import { Conversation } from "../../Components/Conversation";
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
import WKButton from "../../Components/WKButton";
import WKModal from "../../Components/WKModal";
import { Columns2 } from "lucide-react";
import ThreadIcon from "../../Components/Icons/ThreadIcon";
import { ChatVM, handleGlobalSearchClick } from "./vm";
import "./index.css";
import { ConversationWrap } from "../../Service/Model";
import WKApp, { ThemeMode } from "../../App";
import ChannelSetting from "../../Components/ChannelSetting";
import ChannelSearchPanel from "../../Components/ChannelSearch";
import { createChannelSearchApiDataSource } from "../../Components/ChannelSearch/apiAdapter";
import { isChannelSearchEnabled } from "../../Components/ChannelSearch/feature";
import type {
  ChannelSearchDataSource,
  ChannelSearchItem,
  ChannelSearchPanelState,
} from "../../Components/ChannelSearch/types";
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
import GlobalSearch from "../../Components/GlobalSearch";
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

// 消息 ACK 只代表发送成功；后端把归档子区恢复为活跃存在短暂异步窗口。
// 实测立即 threadGet 可能仍返回 Archived，因此发送后用短轮询等后端状态落稳。
const THREAD_REACTIVATE_REFRESH_DELAYS_MS = [0, 300, 800, 1500];

function extensionFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0] || "";
  const fileName = path.substring(path.lastIndexOf("/") + 1);
  return getExtension("", fileName);
}

function fallbackSearchMediaExtension(kind: ChannelSearchItem["kind"]) {
  return kind === "video" ? "mp4" : "jpg";
}

function searchMediaPreviewName(
  item: ChannelSearchItem,
  extension: string
): string {
  const prefix = item.kind === "video" ? "video" : "image";
  const id = item.messageSeq || item.messageId || "preview";
  return `${prefix}-${id}.${extension}`;
}

interface SidebarTabBarWithBadgesProps {
  conversations: ConversationWrap[];
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
 * 勿扰判定：通过 WKSDK.channelManager 查 channelInfo.mute（拿不到当作非勿扰）；
 * 子区未显式 mute 时回看父群组的 mute（与列表渲染保持一致）。
 *
 * 数据源由 <FollowSidebarProvider> 统一注入，避免双 hook 实例导致的重复
 * /sidebar/sync + follow 写操作只刷一份的 stale badge 问题。
 */
const SidebarTabBarWithBadges: React.FC<SidebarTabBarWithBadgesProps> = ({
  conversations,
  activeTab,
  onTabChange,
  onRecentUnreadNavigate,
}) => {
  const { items } = useFollowSidebarContext();

  const isItemMuted = (it: {
    target_type: number;
    target_id: string;
    parent_channel_id?: string;
  }): boolean => {
    let channelType: number | null = null;
    if (it.target_type === SidebarTargetType.DM)
      channelType = ChannelTypePerson;
    else if (it.target_type === SidebarTargetType.CHANNEL)
      channelType = ChannelTypeGroup;
    else if (it.target_type === SidebarTargetType.THREAD)
      channelType = ChannelTypeCommunityTopic;
    if (channelType == null) return false;
    const info = WKSDK.shared().channelManager.getChannelInfo(
      new Channel(it.target_id, channelType)
    );
    const isThread = it.target_type === SidebarTargetType.THREAD;
    let parentChannelInfo: any | undefined;
    if (isThread) {
      const parentGroupNo =
        it.parent_channel_id || parseThreadChannelId(it.target_id)?.groupNo;
      if (parentGroupNo) {
        parentChannelInfo = WKSDK.shared().channelManager.getChannelInfo(
          new Channel(parentGroupNo, ChannelTypeGroup)
        );
      }
    }
    return isEffectivelyMuted({
      isThread,
      channelInfo: info,
      parentChannelInfo,
    });
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
    if (isItemMuted(it)) return sum;
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
    return sum + unread;
  }, 0);

  const recentUnread = conversations.reduce(
    (sum: number, c: ConversationWrap) => {
      if (isMutedForRecentConversation(c)) return sum;
      return sum + (c.unread || 0);
    },
    0
  );

  return (
    <SidebarTabBar
      activeTab={activeTab}
      followUnread={followUnread}
      recentUnread={recentUnread}
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
}

export interface ChatContentPageState {
  showChannelSetting: boolean;
  selectionMode: boolean;
  selectedCount: number;
  /** 子区面板是否显示 */
  showThreadPanel: boolean;
  /** 当前选中的子区 */
  activeThread: Thread | null;
  /** 文件预览信息（非空时显示文件预览面板） */
  previewFile: FilePreviewInfo | null;
  /** 当前正在预览的文件消息 ID（用于卡片激活态） */
  activePreviewMessageId: string | null;
  /** 任务列表面板是否显示 */
  showMatterPanel: boolean;
  /** v0.7 Matter 详情面板是否显示（跟子区/文件预览/任务列表可并存） */
  showMatterDetailPanel: boolean;
  /**
   * 从事项详情面板触发文件预览时记下来源 matter ID。
   * 关闭/返回预览时, 据此把事项面板重新拉起来并自动选回这条 matter,
   * 避免用户落到子区列表或空白侧边。
   */
  previewReturnMatterId: string | null;
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
  private _unsubscribeChannelSearchConfig?: () => void;

  constructor(props: any) {
    super(props);
    this.state = {
      showChannelSetting: false,
      selectionMode: false,
      selectedCount: 0,
      showThreadPanel: false,
      activeThread: null,
      previewFile: null,
      activePreviewMessageId: null,
      showMatterPanel: false,
      showMatterDetailPanel: false,
      previewReturnMatterId: null,
      previewHadThreadShell: false,
      showSummaryPanel: false,
      summaryPanelView: "new",
      showChannelSearch:
        !!props.initialShowChannelSearch &&
        isChannelSearchEnabled(props.channel),
      channelSearchPreviewFile: null,
      previewReturnChannelSearch: false,
    };
  }

  private _onFilePreview = (
    file: FilePreviewInfo,
    options?: { returnToChannelSearch?: boolean }
  ) => {
    const { channel } = this.props;
    const { showThreadPanel, activeThread } = this.state;

    // 判断是否在子区面板内触发（群聊页面 + 子区面板打开 + 有活跃子区 + 来源是子区频道）
    const isFromThreadPanel =
      channel.channelType === ChannelTypeGroup &&
      showThreadPanel &&
      activeThread?.channel_id &&
      file.sourceChannelType === ChannelTypeCommunityTopic &&
      file.sourceChannelId === activeThread.channel_id;

    if (isFromThreadPanel && activeThread?.channel_id) {
      // 在子区面板内触发，切换到完整视图
      // 设置 pending 状态，让子区频道页面处理
      WKApp.shared.pendingFilePreview = {
        url: file.url,
        name: file.name,
        extension: file.extension,
        size: file.size,
        messageId: file.messageId,
        sourceChannelId: file.sourceChannelId,
        sourceChannelType: file.sourceChannelType,
        messageSeq: file.messageSeq,
        fromUID: file.fromUID,
        conversationDigest: file.conversationDigest,
      };
      // 关闭子区面板
      this.setState({
        showThreadPanel: false,
        activeThread: null,
        previewFile: null,
        activePreviewMessageId: null,
        previewReturnChannelSearch: false,
      });
      // 切换到子区完整视图
      const threadChannel = new Channel(
        activeThread.channel_id,
        ChannelTypeCommunityTopic
      );
      WKApp.endpoints.showConversation(threadChannel);
      return;
    }

    // 正常处理：打开文件预览，确保侧边面板打开（子区和文件预览共用一个壳子）。
    // 互斥：事项列表 / 事项详情跟文件预览都在同一个侧边容器区域，同时显示会
    // 相互遮盖。打开文件预览时强制关掉两个事项面板，避免 "看不到预览" 的
    // 死锁 (跟 _onToggleMatterPanel 打开事项时关文件预览的处理对称)。
    //
    // 例外: 来源 = 事项详情 (file.originMatterId 非空), 不卸事项面板,
    // 改成 display:none 暂时隐藏 (见 render), 关掉预览后 unhide 时
    // 内部 state (tab / 展开的时间线 / 选中的 matter) 全部保留, 用户感受
    // 上跟 "回到事项详情" 一致, 且不会闪一下重新拉数据。
    const fromMatter = !!file.originMatterId;
    const fromChannelSearch = !!options?.returnToChannelSearch;
    this.setState({
      previewFile: file,
      showThreadPanel: true, // 确保面板打开
      showChannelSetting: false, // 关闭设置面板，避免布局冲突
      showChannelSearch: false,
      showMatterPanel: fromMatter ? this.state.showMatterPanel : false,
      showMatterDetailPanel: fromMatter
        ? this.state.showMatterDetailPanel
        : false,
      showSummaryPanel: false,
      activePreviewMessageId: file.messageId || null, // 保存激活的消息 ID
      previewReturnMatterId: file.originMatterId || null,
      previewReturnChannelSearch: fromChannelSearch,
      // 仅当预览触发前用户已经在子区面板里 (showThreadPanel 已经是 true)
      // 才允许显示 ← 返回箭头, 让 ← 真正回到子区列表/详情。其他来源
      // (消息附件、事项详情等) 一律隐藏 ← , 避免误导用户跳到子区。
      previewHadThreadShell: fromChannelSearch
        ? false
        : this.state.showThreadPanel,
    });
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
    this.setState({
      channelSearchPreviewFile: {
        url,
        name,
        extension: getExtension(file.extension || "", name),
        size: file.size,
        sourceChannelId: item.channelId || channel.channelID,
        sourceChannelType: item.channelType || channel.channelType,
        messageId: item.messageId,
        messageSeq: item.messageSeq,
        fromUID: item.senderUid,
      },
    });
  };

  private _onSearchMediaPreview = (item: ChannelSearchItem) => {
    const media = item.media;
    if (!media || (item.kind !== "image" && item.kind !== "video")) return;

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
      },
    });
  };

  private _onChannelSearchStateChange = (state: ChannelSearchPanelState) => {
    this.channelSearchPanelState = state;
  };

  private _clearChannelSearchState = () => {
    this.channelSearchPanelState = undefined;
  };

  private _openChannelSearchPanel = () => {
    if (!isChannelSearchEnabled(this.props.channel)) return;
    this._clearChannelSearchState();
    this.setState({
      showChannelSearch: true,
      channelSearchPreviewFile: null,
      showChannelSetting: false,
      showThreadPanel: false,
      activeThread: null,
      previewFile: null,
      activePreviewMessageId: null,
      previewReturnChannelSearch: false,
      showMatterPanel: false,
      showMatterDetailPanel: false,
      showSummaryPanel: false,
    });
  };

  /**
   * 关闭文件预览 (X 或 ←) 的统一收尾。
   *   - 来源 = 事项详情 (previewReturnMatterId 非空): 事项面板被 display:none
   *     隐藏着 (见 render), 这里只清预览相关 state, unhide 后内部 state
   *     (tab / 展开的时间线 / 选中的 matter) 全部保留。但必须把 showThreadPanel
   *     复位, 否则 ThreadPanel 会留下退化成子区列表遮住事项。
   *   - 来源 = 其他: resetThreadShell 控制是否同时关掉子区壳 (群聊路径下
   *     X 全关传 true; 子区频道/私聊路径下 X / ← 也传 true)。
   */
  private _closePreviewAndMaybeRestoreMatter = (resetThreadShell: boolean) => {
    const fromMatter = !!this.state.previewReturnMatterId;
    const fromChannelSearch = !!this.state.previewReturnChannelSearch;
    const shouldResetThread =
      fromMatter || fromChannelSearch || resetThreadShell;
    this.setState({
      previewFile: null,
      activePreviewMessageId: null,
      previewReturnMatterId: null,
      previewReturnChannelSearch: false,
      previewHadThreadShell: false,
      showChannelSearch:
        fromChannelSearch && isChannelSearchEnabled(this.props.channel)
          ? true
          : this.state.showChannelSearch,
      ...(shouldResetThread
        ? { showThreadPanel: false, activeThread: null }
        : {}),
    });
  };

  componentDidMount() {
    const { channel } = this.props;

    // 监听文件预览事件
    WKApp.mittBus.on("wk:file-preview", this._onFilePreview);

    this.channelInfoListener = (channelInfo: ChannelInfo) => {
      // 监听当前频道或父群组的变化
      if (
        channelInfo.channel.isEqual(channel) ||
        (this.parentGroupChannel &&
          channelInfo.channel.isEqual(this.parentGroupChannel))
      ) {
        this.setState({});
      }
    };
    WKSDK.shared().channelManager.addListener(this.channelInfoListener);
    this._unsubscribeChannelSearchConfig =
      WKApp.remoteConfig.addConfigChangeListener(() => {
        if (
          !isChannelSearchEnabled(this.props.channel) &&
          (this.state.showChannelSearch ||
            this.state.previewReturnChannelSearch)
        ) {
          this._clearChannelSearchState();
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
    // 跟文件预览 / 事项列表 / 事项详情互斥 (同一侧边容器)。
    this._onPendingThread = (detail: {
      groupNo: string;
      thread: Thread | null;
    }) => {
      if (detail?.groupNo === this.props.channel.channelID) {
        this.setState({
          showThreadPanel: true,
          activeThread: detail.thread || null,
          previewFile: null, // 关闭文件预览
          activePreviewMessageId: null,
          showMatterPanel: false, // 关闭事项列表面板
          showMatterDetailPanel: false, // 关闭事项详情面板
          showSummaryPanel: false,
          showChannelSearch: false,
          channelSearchPreviewFile: null,
          previewReturnChannelSearch: false,
        });
      }
    };
    WKApp.mittBus.on("wk:pending-thread", this._onPendingThread);

    // 注册关闭子区面板事件监听
    this._onCloseThreadPanel = () => {
      if (this.state.showThreadPanel) {
        this.setState({ showThreadPanel: false, activeThread: null });
      }
    };
    WKApp.mittBus.on("wk:close-thread-panel", this._onCloseThreadPanel);

    // 注册任务列表面板切换事件监听。
    // 互斥关系: 打开事项列表时关掉其它同容器的侧边面板 (事项详情 / 子区 /
    // 文件预览), 关闭时不影响其它。
    this._onToggleMatterPanel = (data) => {
      if (
        data.channelId !== channel.channelID ||
        data.channelType !== channel.channelType
      )
        return;
      this.setState((prevState) => {
        const opening = !prevState.showMatterPanel;
        return {
          showMatterPanel: opening,
          showMatterDetailPanel: opening
            ? false
            : prevState.showMatterDetailPanel,
          showThreadPanel: opening ? false : prevState.showThreadPanel,
          activeThread: opening ? null : prevState.activeThread,
          previewFile: opening ? null : prevState.previewFile,
          previewReturnChannelSearch: opening
            ? false
            : prevState.previewReturnChannelSearch,
          activePreviewMessageId: opening
            ? null
            : prevState.activePreviewMessageId,
          showSummaryPanel: opening ? false : prevState.showSummaryPanel,
          showChannelSearch: opening ? false : prevState.showChannelSearch,
          channelSearchPreviewFile: opening
            ? null
            : prevState.channelSearchPreviewFile,
        };
      });
    };
    WKApp.mittBus.on("wk:toggle-matter-panel", this._onToggleMatterPanel);

    // 注册 v0.7 事项详情面板切换。
    // 跟文件预览 / 子区 / 任务列表互斥: 跟 _onToggleMatterPanel (事项列表)
    // 一样, 打开时关掉其它侧边面板, 关闭时不影响其它。
    this._onToggleMatterDetailPanel = (data) => {
      if (
        data.channelId !== channel.channelID ||
        data.channelType !== channel.channelType
      )
        return;
      this.setState((prevState) => {
        const opening = !prevState.showMatterDetailPanel;
        if (!opening) {
          return { showMatterDetailPanel: false };
        }
        return {
          showMatterDetailPanel: true,
          showMatterPanel: false,
          showThreadPanel: false,
          activeThread: null,
          previewFile: null,
          activePreviewMessageId: null,
          previewReturnChannelSearch: false,
          showSummaryPanel: false,
          showChannelSearch: false,
          channelSearchPreviewFile: null,
        };
      });
    };
    WKApp.mittBus.on(
      "wk:toggle-matter-detail-panel",
      this._onToggleMatterDetailPanel
    );

    this._onToggleSummaryPanel = (data) => {
      if (
        data.channelId !== channel.channelID ||
        data.channelType !== channel.channelType
      )
        return;
      this.setState((prevState) => {
        // forceOpen：始终打开（用于聊天内创建总结后展示），不做 toggle 关闭
        const opening = data.forceOpen ? true : !prevState.showSummaryPanel;
        return {
          showSummaryPanel: opening,
          summaryPanelView: opening
            ? data.summaryPanelView
            : prevState.summaryPanelView,
          showMatterPanel: opening ? false : prevState.showMatterPanel,
          showMatterDetailPanel: opening
            ? false
            : prevState.showMatterDetailPanel,
          showThreadPanel: opening ? false : prevState.showThreadPanel,
          activeThread: opening ? null : prevState.activeThread,
          previewFile: opening ? null : prevState.previewFile,
          previewReturnChannelSearch: opening
            ? false
            : prevState.previewReturnChannelSearch,
          activePreviewMessageId: opening
            ? null
            : prevState.activePreviewMessageId,
          showChannelSearch: opening ? false : prevState.showChannelSearch,
          channelSearchPreviewFile: opening
            ? null
            : prevState.channelSearchPreviewFile,
        };
      });
    };
    WKApp.mittBus.on("wk:toggle-summary-panel", this._onToggleSummaryPanel);

    // 检查是否需要自动打开子区面板（查看全部子区）
    if (WKApp.shared.pendingThreadPanel === channel.channelID) {
      this.setState({
        showThreadPanel: true,
        activeThread: null,
        previewFile: null,
        activePreviewMessageId: null,
        previewReturnChannelSearch: false,
        showMatterPanel: false, // 互斥
        showMatterDetailPanel: false, // 互斥
        showSummaryPanel: false,
        showChannelSearch: false,
        channelSearchPreviewFile: null,
      });
      WKApp.shared.pendingThreadPanel = undefined;
    }

    // 检查是否有待打开的文件预览（从子区面板切换过来）
    if (WKApp.shared.pendingFilePreview) {
      const pending = WKApp.shared.pendingFilePreview;
      WKApp.shared.pendingFilePreview = undefined;
      this.setState({
        previewFile: {
          url: pending.url,
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
        showMatterPanel: false, // 互斥
        showMatterDetailPanel: false, // 互斥
        showSummaryPanel: false,
        showChannelSearch: false,
        channelSearchPreviewFile: null,
        previewReturnChannelSearch: false,
      });
    }

    // 子区：预先获取父群组信息
    if (channel.channelType === ChannelTypeCommunityTopic) {
      const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
      const parentGroupNo = channelInfo?.orgData?.parentGroupNo;
      if (parentGroupNo) {
        this.parentGroupChannel = new Channel(parentGroupNo, ChannelTypeGroup);
        if (
          !WKSDK.shared().channelManager.getChannelInfo(this.parentGroupChannel)
        ) {
          WKSDK.shared().channelManager.fetchChannelInfo(
            this.parentGroupChannel
          );
        }
      }
    }
  }

  componentDidUpdate(prevProps: ChatContentPageProps) {
    const { channel } = this.props;
    const channelChanged =
      channel.channelID !== prevProps.channel.channelID ||
      channel.channelType !== prevProps.channel.channelType;

    if (channelChanged) {
      this._clearChannelSearchState();
      if (this.state.channelSearchPreviewFile) {
        this.setState({ channelSearchPreviewFile: null });
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
      this.setState({
        showChannelSearch: false,
        channelSearchPreviewFile: null,
        previewReturnChannelSearch: false,
      });
    }

    // 切换频道时消费 pendingThreadPanel 和 pendingFilePreview。
    // 两个场景都要跟事项列表 / 事项详情互斥 (同一侧边容器)。
    if (channelChanged) {
      // 打开全部子区列表
      if (WKApp.shared.pendingThreadPanel === channel.channelID) {
        WKApp.shared.pendingThreadPanel = undefined;
        this.setState({
          showThreadPanel: true,
          activeThread: null,
          previewFile: null, // 关闭文件预览（互斥）
          activePreviewMessageId: null,
          previewReturnChannelSearch: false,
          showMatterPanel: false, // 互斥
          showMatterDetailPanel: false, // 互斥
          showSummaryPanel: false,
          showChannelSearch: false,
          channelSearchPreviewFile: null,
        });
        return;
      }

      // 检查是否有待打开的文件预览（从子区面板切换过来）
      if (WKApp.shared.pendingFilePreview) {
        const pending = WKApp.shared.pendingFilePreview;
        WKApp.shared.pendingFilePreview = undefined;
        this.setState({
          previewFile: {
            url: pending.url,
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
          showMatterPanel: false, // 互斥
          showMatterDetailPanel: false, // 互斥
          showSummaryPanel: false,
          showChannelSearch: false,
          channelSearchPreviewFile: null,
          previewReturnChannelSearch: false,
        });
        return;
      }
    }

    // 子区 channelInfo 加载后，检查是否需要获取父群组信息
    if (
      channel.channelType === ChannelTypeCommunityTopic &&
      !this.parentGroupChannel
    ) {
      const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
      const parentGroupNo = channelInfo?.orgData?.parentGroupNo;
      if (parentGroupNo) {
        this.parentGroupChannel = new Channel(parentGroupNo, ChannelTypeGroup);
        if (
          !WKSDK.shared().channelManager.getChannelInfo(this.parentGroupChannel)
        ) {
          WKSDK.shared().channelManager.fetchChannelInfo(
            this.parentGroupChannel
          );
        }
      }
    }
  }

  private _onPendingThread?: (detail: {
    groupNo: string;
    thread: Thread | null;
  }) => void;
  private _onCloseThreadPanel?: () => void;
  private _onToggleMatterPanel?: (data: {
    channelId: string;
    channelType: number;
  }) => void;
  private _onToggleMatterDetailPanel?: (data: {
    channelId: string;
    channelType: number;
  }) => void;
  private _onToggleSummaryPanel?: (data: {
    channelId: string;
    channelType: number;
    summaryPanelView: "history" | "new";
    forceOpen?: boolean;
  }) => void;

  componentWillUnmount() {
    WKApp.mittBus.off("wk:file-preview", this._onFilePreview);
    if (this._onPendingThread) {
      WKApp.mittBus.off("wk:pending-thread", this._onPendingThread);
    }
    if (this._onCloseThreadPanel) {
      WKApp.mittBus.off("wk:close-thread-panel", this._onCloseThreadPanel);
    }
    if (this._onToggleMatterPanel) {
      WKApp.mittBus.off("wk:toggle-matter-panel", this._onToggleMatterPanel);
    }
    if (this._onToggleMatterDetailPanel) {
      WKApp.mittBus.off(
        "wk:toggle-matter-detail-panel",
        this._onToggleMatterDetailPanel
      );
    }
    if (this._onToggleSummaryPanel) {
      WKApp.mittBus.off("wk:toggle-summary-panel", this._onToggleSummaryPanel);
    }
    this._unsubscribeChannelSearchConfig?.();
    this._unsubscribeChannelSearchConfig = undefined;
    WKSDK.shared().channelManager.removeListener(this.channelInfoListener);
  }

  private getThreadStatus(channelInfo?: ChannelInfo | null) {
    return (channelInfo?.orgData?.thread as any)?.status as
      | ThreadStatus
      | undefined;
  }

  private handleConversationMessageSent = () => {
    const { channel } = this.props;
    if (channel.channelType !== ChannelTypeCommunityTopic) return;

    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
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
    WKSDK.shared().channelManager.deleteChannelInfo(channel);
    await WKSDK.shared().channelManager.fetchChannelInfo(channel);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
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
      showMatterPanel,
      showMatterDetailPanel,
      showSummaryPanel,
      summaryPanelView,
      showChannelSearch,
      channelSearchPreviewFile,
    } = this.state;
    // 子区页面不显示讨论串按钮
    const isThreadChannel = channel.channelType === ChannelTypeCommunityTopic;
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
    if (!channelInfo) {
      WKSDK.shared().channelManager.fetchChannelInfo(channel);
    }
    const threadStatus = this.getThreadStatus(channelInfo);
    return (
      <div
        className={classNames(
          "wk-chat-content-right",
          showChannelSetting ? "wk-chat-channelsetting-open" : "",
          showChannelSearch ? "wk-chat-channel-search-open" : "",
          showThreadPanel || previewFile || showMatterPanel
            ? "wk-chat-threadpanel-open"
            : "",
          showMatterDetailPanel ? "wk-chat-matter-detail-panel-open" : "",
          showSummaryPanel ? "wk-chat-summary-panel-open" : ""
        )}
      >
        <div
          className={classNames(
            "wk-chat-content-chat",
            selectionMode ? "wk-chat-content-chat-selection" : undefined
          )}
        >
          <div
            className={classNames(
              "wk-chat-conversation-header",
              selectionMode
                ? "wk-chat-conversation-header-selection"
                : undefined
            )}
          >
            <div className="wk-chat-conversation-header-content">
              <div className="wk-chat-conversation-header-left">
                {selectionMode ? (
                  <div className="wk-chat-conversation-selection-header">
                    <div className="wk-chat-conversation-selection-title">
                      {t("base.chatPage.selectionCount", {
                        values: { count: selectedCount },
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="wk-chat-conversation-header-back"
                      onClick={(e) => {
                        e.stopPropagation();
                        WKApp.routeRight.pop();
                      }}
                    >
                      <div className="wk-chat-conversation-header-back-icon"></div>
                    </div>
                    <div className="wk-chat-conversation-header-channel">
                      <div className="wk-chat-conversation-header-channel-avatar">
                        {channel.channelType === ChannelTypeGroup ? (
                          // 群聊：真实头像
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
                        ) : channel.channelType ===
                          ChannelTypeCommunityTopic ? (
                          // 子区：🧵 icon，圆角背景（对齐群聊 hash-icon 样式）
                          <div className="wk-chat-conversation-header-channel-thread-icon">
                            <ThreadIcon
                              size={18}
                              color="var(--wk-text-secondary, #5C6070)"
                            />
                          </div>
                        ) : (
                          // 私聊：头像
                          <img
                            alt=""
                            src={WKApp.shared.avatarChannel(channel)}
                          ></img>
                        )}
                      </div>
                      <div className="wk-chat-conversation-header-channel-info">
                        <div className="wk-chat-conversation-header-channel-info-name">
                          {channel.channelType === ChannelTypeCommunityTopic &&
                          channelInfo?.orgData?.parentGroupNo ? (
                            <>
                              {/* 面包屑：# 父群组 › 🧵 子区名 */}
                              <span
                                className="wk-chat-conversation-header-parent-group"
                                style={{ cursor: "pointer" }}
                                onClick={() => {
                                  if (this.parentGroupChannel) {
                                    WKApp.endpoints.showConversation(
                                      this.parentGroupChannel
                                    );
                                  } else {
                                    WKApp.endpoints.showConversation(
                                      new Channel(
                                        channelInfo.orgData.parentGroupNo,
                                        ChannelTypeGroup
                                      )
                                    );
                                  }
                                }}
                              >
                                {WKSDK.shared().channelManager.getChannelInfo(
                                  new Channel(
                                    channelInfo.orgData.parentGroupNo,
                                    ChannelTypeGroup
                                  )
                                )?.title || channelInfo.orgData.parentGroupNo}
                              </span>
                              <span className="wk-chat-conversation-header-separator">
                                ›
                              </span>
                              <span className="wk-chat-conversation-header-thread-name">
                                {channelInfo?.orgData?.displayName}
                              </span>
                            </>
                          ) : (
                            channelInfo?.orgData?.displayName
                          )}
                        </div>
                        <div className="wk-chat-conversation-header-channel-info-tip"></div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="wk-chat-conversation-header-right">
                {selectionMode ? (
                  <button
                    type="button"
                    className="wk-chat-conversation-selection-cancel"
                    onClick={(e) => {
                      e.stopPropagation();
                      this.conversationContext?.clearCheckedMessages();
                      this.conversationContext?.setEditOn(false);
                    }}
                  >
                    {t("base.common.cancel")}
                  </button>
                ) : (
                  <>
                    {WKApp.endpoints
                      .channelHeaderRightItems(channel)
                      .map((item: any, i: number) => {
                        return (
                          <div
                            key={i}
                            className="wk-chat-conversation-header-right-item"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item}
                          </div>
                        );
                      })}
                    {/* 子区按钮 - 切换子区列表 */}
                    {!isThreadChannel &&
                      channel.channelType === ChannelTypeGroup &&
                      WKApp.remoteConfig.threadOn && (
                        <div
                          className="wk-chat-conversation-header-right-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            this.setState((prevState) => {
                              // 如果有文件预览或其他面板打开，视为"子区列表未显示"，点击应打开子区列表
                              const isThreadListVisible =
                                prevState.showThreadPanel &&
                                !prevState.previewFile &&
                                !prevState.activeThread;
                              return {
                                showThreadPanel: !isThreadListVisible,
                                showMatterPanel: false, // 与事项列表面板互斥
                                showMatterDetailPanel: false, // 与事项详情面板互斥
                                showSummaryPanel: false,
                                showChannelSearch: false,
                                channelSearchPreviewFile: null,
                                activeThread: null,
                                previewFile: null, // 关闭文件预览（互斥）
                                activePreviewMessageId: null,
                              };
                            });
                          }}
                          title={t("base.chatPage.threadPanel")}
                        >
                          <ThreadIcon size={20} color="currentColor" />
                        </div>
                      )}
                    <div
                      className="wk-chat-conversation-header-right-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        // 点击更多按钮只切换设置面板，不影响文件预览/子区面板状态
                        this.setState({
                          showChannelSetting: !this.state.showChannelSetting,
                          showChannelSearch: false,
                          channelSearchPreviewFile: null,
                        });
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
                      <div className="wk-conversation-header-mask"></div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="wk-chat-conversation">
            <ErrorBoundary moduleName={t("base.chatPage.chatModuleName")}>
              <Conversation
                initLocateMessageSeq={initLocateMessageSeq}
                shouldShowHistorySplit={true}
                onContext={(ctx) => {
                  this.conversationContext = ctx;
                  (WKApp.shared as any).activeConversationContext = ctx;
                  this.setState({
                    selectionMode: ctx.editOn(),
                    selectedCount: ctx.getCheckedMessageCount(),
                  });
                }}
                onSelectionStateChange={({ editOn, checkedCount }) => {
                  this.setState({
                    selectionMode: editOn,
                    selectedCount: checkedCount,
                  });
                }}
                onOpenThreadPanel={(threadChannelId, threadName) => {
                  const threadInfo = parseThreadChannelId(threadChannelId);
                  if (threadInfo) {
                    this.setState({
                      showThreadPanel: true,
                      showMatterPanel: false, // 与事项列表面板互斥
                      showMatterDetailPanel: false, // 与事项详情面板互斥
                      showSummaryPanel: false,
                      showChannelSearch: false,
                      channelSearchPreviewFile: null,
                      previewFile: null, // 关闭文件预览（互斥）
                      activePreviewMessageId: null,
                      activeThread: buildThreadStub(
                        threadInfo.shortId,
                        threadInfo.groupNo,
                        threadChannelId,
                        threadName
                      ),
                    });
                  }
                }}
                key={channel.getChannelKey()}
                chatBg={
                  WKApp.config.themeMode === ThemeMode.dark
                    ? undefined
                    : require("./assets/chat_bg.svg").default
                }
                channel={channel}
                activePreviewMessageId={this.state.activePreviewMessageId}
                inputNotice={
                  isThreadChannel && threadStatus === ThreadStatus.Archived
                    ? t("base.chatPage.archivedThreadNotice")
                    : undefined
                }
                onMessageSent={this.handleConversationMessageSent}
              ></Conversation>
            </ErrorBoundary>
          </div>
        </div>

        <div className={classNames("wk-chat-channelsetting")}>
          <ErrorBoundary moduleName={t("base.chatPage.channelSettings")}>
            <ChannelSetting
              conversationContext={this.conversationContext}
              key={channel.getChannelKey()}
              channel={channel}
              onOpenChannelSearch={
                isChannelSearchEnabled(channel)
                  ? this._openChannelSearchPanel
                  : undefined
              }
              onClose={() => {
                this.setState({
                  showChannelSetting: false,
                });
              }}
            ></ChannelSetting>
          </ErrorBoundary>
        </div>

        {showChannelSearch && (
          <div className="wk-chat-channel-search-panel">
            <ErrorBoundary moduleName={t("base.chatPage.searchModuleName")}>
              <div
                className={classNames(
                  "wk-chat-channel-search-stack",
                  channelSearchPreviewFile &&
                    "wk-chat-channel-search-stack--previewing"
                )}
              >
                <div className="wk-chat-channel-search-main">
                  <ChannelSearchPanel
                    key={channel.getChannelKey()}
                    channel={channel}
                    conversationContext={this.conversationContext}
                    dataSource={this.getChannelSearchDataSource(channel)}
                    onPreviewFile={this._onSearchFilePreview}
                    onPreviewMedia={this._onSearchMediaPreview}
                    initialState={this.channelSearchPanelState}
                    onStateChange={this._onChannelSearchStateChange}
                    onClose={() => {
                      this._clearChannelSearchState();
                      this.setState({
                        showChannelSearch: false,
                        channelSearchPreviewFile: null,
                      });
                    }}
                  />
                </div>
                {channelSearchPreviewFile && (
                  <div className="wk-chat-channel-search-preview">
                    <FilePreviewPanel
                      file={channelSearchPreviewFile}
                      showOpenExternal={false}
                      onClose={() => {
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
        {!isThreadChannel &&
          channel.channelType === ChannelTypeGroup &&
          WKApp.remoteConfig.threadOn &&
          (showThreadPanel || previewFile) && (
            <ThreadPanel
              groupNo={channel.channelID}
              thread={activeThread}
              onClose={() => {
                // X 关闭: 若当前是从事项详情打开的预览, 回到事项详情;
                // 否则沿用原行为, 把整个侧边壳 (子区 + 预览) 一起关掉。
                if (
                  previewFile &&
                  (this.state.previewReturnMatterId ||
                    this.state.previewReturnChannelSearch)
                ) {
                  this._closePreviewAndMaybeRestoreMatter(true);
                  return;
                }
                this.setState({
                  showThreadPanel: false,
                  activeThread: null,
                  previewFile: null,
                  activePreviewMessageId: null,
                  previewReturnMatterId: null,
                  previewReturnChannelSearch: false,
                  previewHadThreadShell: false,
                });
              }}
              onThreadSelect={(thread) => {
                this.setState({ activeThread: thread });
              }}
              filePreview={previewFile}
              showBackButton={this.state.previewHadThreadShell}
              onFilePreviewClose={() => {
                // ← 返回: 来自事项详情的预览统一走 restore 路径, 落回事项详情;
                // 否则按原行为只清预览, 保留 showThreadPanel 让用户回到子区列表。
                this._closePreviewAndMaybeRestoreMatter(false);
              }}
              onReplyFile={(info) => {
                // 触发回复功能，保持文件预览面板打开
                this.conversationContext?.replyToFileMessage?.(info);
              }}
              onFilePreviewChange={(file) => {
                // 切换预览的文件
                this.setState({
                  previewFile: file,
                  activePreviewMessageId: file.messageId || null,
                  previewHadThreadShell:
                    this.state.showThreadPanel ||
                    this.state.previewHadThreadShell,
                });
              }}
            />
          )}

        {/* 子区频道或私聊的文件预览（使用 ThreadPanel 壳子，获得拖拽功能） */}
        {(isThreadChannel || channel.channelType === ChannelTypePerson) &&
          previewFile && (
            <ThreadPanel
              onClose={() => this._closePreviewAndMaybeRestoreMatter(true)}
              filePreview={previewFile}
              onFilePreviewClose={() =>
                this._closePreviewAndMaybeRestoreMatter(true)
              }
              onReplyFile={(info) => {
                // 触发回复功能，保持文件预览面板打开
                this.conversationContext?.replyToFileMessage?.(info);
              }}
              onFilePreviewChange={(file) => {
                // 切换预览的文件
                this.setState({
                  previewFile: file,
                  activePreviewMessageId: file.messageId || null,
                });
              }}
            />
          )}

        {/* 任务列表面板（与子区互斥，复用 ThreadPanel 容器样式）。
            从事项详情触发文件预览时不卸面板, 只 display:none 隐藏,
            unhide 时 ChatMatterPanel 内部 state (active matter / tab /
            展开的时间线) 全部保留, 用户感受像 "回到原样"。 */}
        {showMatterPanel && (
          <div
            className="wk-thread-panel"
            style={
              previewFile && this.state.previewReturnMatterId
                ? { display: "none" }
                : undefined
            }
          >
            {WKApp.endpoints.chatMatterPanel(channel, () =>
              this.setState({ showMatterPanel: false })
            )}
          </div>
        )}

        {/* v0.7 Matter 详情面板（跟子区/文件预览/任务列表可并存，不互斥）。
            从事项详情触发文件预览时同样改 display:none 保留 state。 */}
        {showMatterDetailPanel && (
          <div
            className="wk-matter-detail-panel"
            style={
              previewFile && this.state.previewReturnMatterId
                ? { display: "none" }
                : undefined
            }
          >
            {WKApp.endpoints.chatMatterDetailPanel(channel, () =>
              this.setState({ showMatterDetailPanel: false })
            )}
          </div>
        )}

        {showSummaryPanel && (
          <div className="wk-summary-panel">
            {WKApp.endpoints.chatSummaryPanel(channel, () =>
              this.setState({ showSummaryPanel: false })
            )}
          </div>
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
                  <div className="wk-chat-search">
                    {/* Space 名称（原下拉筛选位置） */}
                    <div className="wk-chat-space-name">
                      {this.state.currentSpaceName}
                    </div>
                    <div className="wk-chat-header-actions">
                      <NavSignalBadge showText />
                      <div
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
                                if (groupMenu?.onClick) groupMenu.onClick();
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
                visible={vm.showGlobalSearch}
                onCancel={() => {
                  vm.showGlobalSearch = false;
                }}
              >
                <div style={{ marginTop: "30px" }}>
                  <ErrorBoundary
                    moduleName={t("base.chatPage.searchModuleName")}
                  >
                    <GlobalSearch
                      onClick={(item, type: string) => {
                        void handleGlobalSearchClick(item, type, () => {
                          vm.showGlobalSearch = false;
                        });
                      }}
                      hideModal={() => {
                        vm.showGlobalSearch = false;
                      }}
                    />
                  </ErrorBoundary>
                </div>
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
