import React, { Component, useState } from "react";
import {
  Channel,
  ChannelTypePerson,
  ChannelTypeGroup,
  WKSDK,
} from "wukongimjssdk";
import { Toast, Spin, Popover } from "@douyinfe/semi-ui";
import {
  Thread,
  ThreadStatus,
  buildThreadChannelId,
} from "../../Service/Thread";
import { ThreadPanelVM, ThreadPanelState } from "./vm";
import {
  X,
  Plus,
  ChevronDown,
  ArrowLeft,
  MoreHorizontal,
  Star,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import ThreadIcon from "../Icons/ThreadIcon";
import classNames from "classnames";
import { Conversation } from "../Conversation";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { canManageThread, isParentGroupManager } from "../../Service/threadPermission";
import ChannelWebhookPanel from "../ChannelWebhook";
import { ErrorBoundary } from "../ErrorBoundary";
import WKApp from "../../App";
import { ShowConversationOptions } from "../../EndpointCommon";
import { formatRelativeTime } from "../../Utils/time";
import { isChannelDisbanded } from "../../Utils/groupDisband";
import FollowService from "../../Service/FollowService";
import SidebarService from "../../Service/SidebarService";
import CategoryService from "../../Service/CategoryService";
import { createThreadByNameAndNotify } from "../../bridge/thread/createThread";
import { syncThreadArchiveState } from "../../Service/threadArchiveSync";
import { FilePreviewInfo } from "../FilePreviewPanel/types";
import { fileRendererRegistry } from "../FilePreviewPanel/registry";
import { getExtension } from "../FilePreviewPanel/types";
import FilePreviewHeader, {
  ConversationFile,
} from "../FilePreviewPanel/FilePreviewHeader";
import { FileListPanel } from "../FilePreviewPanel/FileListPanel";
import { MarkdownRenderer } from "../FilePreviewPanel/renderers/MarkdownRenderer";
import { HtmlRenderer } from "../FilePreviewPanel/renderers/HtmlRenderer";
import { ImageRenderer } from "../FilePreviewPanel/renderers/ImageRenderer";
import { VideoRenderer } from "../FilePreviewPanel/renderers/VideoRenderer";
import { isChannelSearchEnabled } from "../ChannelSearch/feature";
import { I18nContext, t } from "../../i18n";
import { wkConfirm } from "../WKModal";
import { THREAD_NAME_MAX_LENGTH } from "../../Service/nameLimits";
import ThreadCreateDialog, { ThreadCreateLabels } from "../../ui/ThreadCreateDialog";
import {
  ArchiveAction,
  deriveArchiveAction,
  shouldShowArchiveButton,
} from "./archiveActions";
import {
  SMALL_SCREEN_WIDTH,
  THREAD_DEFAULT_WIDTH,
  SPLITTER_DEFAULT_WIDTH,
  clampThreadWidth,
  restoreThreadWidth,
  persistThreadWidth,
} from "../WKLayout/layoutWidth";
import {
  deleteImChannelInfo,
  fetchImChannelInfo,
  getImChannelInfo,
} from "../../im-runtime/channelRuntime";
import "./index.css";

/**
 * 子区名称输入框 — 带字数计数器（当前/最大）。
 * 目前仍用于重命名子区的 legacy wkConfirm。
 */
const ThreadNameInput = React.forwardRef<
  HTMLInputElement,
  {
    defaultValue?: string;
    placeholder?: string;
    autoFocus?: boolean;
  }
>(({ defaultValue = "", placeholder, autoFocus }, ref) => {
  const [value, setValue] = useState(defaultValue);
  const exceeded = value.length > THREAD_NAME_MAX_LENGTH;
  return (
    <div>
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          width: "100%",
          padding: "10px 12px",
          background: "var(--wk-bg-base)",
          border: exceeded ? "1px solid var(--wk-color-danger)" : "1px solid var(--wk-border-default)",
          borderRadius: "6px",
          fontSize: "14px",
          color: "var(--wk-text-primary)",
          outline: "none",
          boxSizing: "border-box",
        }}
        onChange={(e) => setValue(e.target.value)}
      />
      <div
        style={{
          textAlign: "right",
          marginTop: "4px",
          fontSize: "12px",
          color: exceeded ? "var(--wk-color-danger)" : "var(--wk-text-tertiary)",
        }}
      >
        {value.length} / {THREAD_NAME_MAX_LENGTH}
      </div>
    </div>
  );
});
ThreadNameInput.displayName = "ThreadNameInput";

// 消息 ACK 只代表发送成功；后端把归档子区恢复为活跃存在短暂异步窗口。
// 实测立即 threadGet 可能仍返回 Archived，因此发送后用短轮询等后端状态落稳。
const THREAD_REACTIVATE_REFRESH_DELAYS_MS = [0, 300, 800, 1500];

/** API 返回的文件数据结构 */
interface ChannelFileResponse {
  message_id: string | number;
  message_seq?: number;
  name: string;
  url: string;
  size?: number;
  category?: string;
  from_uid?: string;
  from_name?: string;
  timestamp?: number;
}

export interface ThreadPanelProps {
  /** 群组 ID，纯文件预览模式时可不传 */
  groupNo?: string;
  thread?: Thread | null;
  onClose: () => void;
  onThreadSelect?: (thread: Thread | null) => void;
  onCreateThread?: () => void;
  /** 文件预览信息，传入时渲染文件预览内容而非子区内容 */
  filePreview?: FilePreviewInfo | null;
  /** 关闭文件预览的回调 */
  onFilePreviewClose?: () => void;
  /** 回复文件消息的回调，传入回复所需的完整信息 */
  onReplyFile?: (info: {
    messageId: string;
    messageSeq: number;
    fromUID: string;
    conversationDigest: string;
    channelId: string;
    channelType: number;
  }) => void;
  /** 切换预览文件的回调（从文件列表选择其他文件时触发） */
  onFilePreviewChange?: (file: FilePreviewInfo) => void;
  /**
   * 文件预览模式下是否显示左上角的返回箭头 (←)。
   * 仅当预览之前确实有子区面板上下文 (用户先打开了子区列表 / 子区详情)
   * 时传 true, ← 表示"回到子区"; 否则 (从消息附件、事项详情等其他来源
   * 触发预览) 不应该让 ← 把用户带到子区列表 — 整段子区上下文不存在,
   * ← 显得突兀。Chat 页面据 _onFilePreview 触发时 showThreadPanel 的
   * 状态判断, 不传 / false 隐藏箭头。
   */
  showBackButton?: boolean;
}

interface ThreadPanelComponentState {
  view: "detail" | "list";
  activeExpanded: boolean;
  archivedExpanded: boolean;
  vmState: ThreadPanelState;
  threads: Thread[];
  threadsLoading: boolean;
  showMoreMenu: boolean;
  /** 子区 Webhook 管理子视图是否展开（#451）。展开时替换子区详情的头部与内容。 */
  showWebhookPanel: boolean;
  panelWidth: number;
  isDragging: boolean;
  /** 文件预览视图模式 */
  fileViewMode: "preview" | "source";
  /** Markdown TOC 是否展开 */
  isTocOpen: boolean;
  /** Markdown TOC 是否可用（h2 ≥ 3） */
  isTocAvailable: boolean;
  /** 对话内文件列表 */
  conversationFiles: ConversationFile[];
  /** 文件列表侧边面板是否打开 */
  isFilePanelOpen: boolean;
  /** 文件列表初始加载中 */
  conversationFilesLoading: boolean;
  /** 文件列表加载更多中 */
  conversationFilesLoadingMore: boolean;
  /** 文件列表当前页码 */
  conversationFilesPage: number;
  /** 文件列表是否还有更多 */
  conversationFilesHasMore: boolean;
  createDialogVisible: boolean;
  createLoading: boolean;
  createError: string | null;
}

export default class ThreadPanel extends Component<
  ThreadPanelProps,
  ThreadPanelComponentState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  private vm: ThreadPanelVM | null = null;
  private panelRef = React.createRef<HTMLDivElement>();
  private dragStartX = 0;
  private dragStartWidth = 0;
  private lastPanelWidth = THREAD_DEFAULT_WIDTH;
  private cachedWindowWidth = 1920; // cached on drag start
  private cachedLeftPanelWidth = 300; // cached on drag start
  /** 同步标志，防止 loadMore 竞态条件 */
  private _loadingMore = false;
  /** 行内归档操作进行中的子区集合，防止重复点击 / 撤销窗口竞态 */
  private archivingShortIds = new Set<string>();
  /** 撤销 Toast 的自动关闭计时器，按 short_id 记录，卸载时统一清理 */
  private undoToastTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 撤销 Toast 的 id，便于点击撤销后主动关闭 */
  private undoToastIds = new Map<string, string>();
  /** 组件是否已卸载，撤销 Toast 渲染在全局 portal，卸载后回调需短路 */
  private isUnmounted = false;
  private _unsubscribeRemoteConfig?: () => void;

  constructor(props: ThreadPanelProps) {
    super(props);
    const leftPanelWidth = this.getLeftPanelWidth();
    const savedWidth = clampThreadWidth(
      restoreThreadWidth(),
      window.innerWidth,
      leftPanelWidth
    );
    this.lastPanelWidth = savedWidth;

    this.state = {
      view: props.thread ? "detail" : "list",
      activeExpanded: true,
      archivedExpanded: false,
      vmState: {
        loading: false,
        thread: props.thread,
        parentMessage: null,
        replies: [],
        hasMore: false,
        error: null,
      },
      threads: [],
      threadsLoading: true,
      showMoreMenu: false,
      showWebhookPanel: false,
      panelWidth: savedWidth,
      isDragging: false,
      fileViewMode: "preview",
      isTocOpen: false,
      isTocAvailable: false,
      conversationFiles: [],
      isFilePanelOpen: false,
      conversationFilesLoading: false,
      conversationFilesLoadingMore: false,
      conversationFilesPage: 1,
      conversationFilesHasMore: false,
      createDialogVisible: false,
      createLoading: false,
      createError: null,
    };
  }

  componentDidMount() {
    // 纯文件预览模式时跳过子区相关逻辑
    if (this.props.groupNo) {
      this.loadThreads();
      if (this.props.thread) {
        this.initVM(this.props.thread.short_id);
      }
    }
    // 文件预览模式时加载对话内文件列表
    if (this.props.filePreview) {
      this.loadConversationFiles();
    }
    // Set CSS variable on mount so chat area calc has the correct width
    this.syncCssVariable(this.state.panelWidth);
    this._unsubscribeRemoteConfig = WKApp.remoteConfig.addConfigChangeListener(
      () => {
        if (!this.isUnmounted) this.forceUpdate();
      }
    );
  }

  componentWillUnmount() {
    this.isUnmounted = true;
    this._unsubscribeRemoteConfig?.();
    this._unsubscribeRemoteConfig = undefined;
    document.removeEventListener("mousemove", this.onPanelDragMove);
    document.removeEventListener("mouseup", this.onPanelDragEnd);
    if (this.state.isDragging) {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    // 清理撤销 Toast：撤销 Toast 渲染在 Semi 全局 portal，不随本组件卸载销毁，
    // 其「撤销」按钮仍持有已卸载实例的 handleUndoArchive。卸载时必须主动关闭
    // 这些 Toast 并清空计时器与 id 两个集合，避免卸载后点撤销对已卸载组件
    // setState 并发出无意义请求。
    this.undoToastIds.forEach((toastId) => Toast.close(toastId));
    this.undoToastTimers.forEach((timer) => clearTimeout(timer));
    this.undoToastTimers.clear();
    this.undoToastIds.clear();
  }

  // ── Helper to get left panel width from CSS variable or default ──
  private getLeftPanelWidth(): number {
    try {
      const root = document.documentElement;
      const cssValue = getComputedStyle(root)
        .getPropertyValue("--wk-wdith-conversation-list")
        .trim();
      if (cssValue) {
        const parsed = parseInt(cssValue, 10);
        if (!isNaN(parsed)) return parsed;
      }
    } catch (_) {
      // Best-effort CSS variable read: silently fall through to default.
      // This is intentional — DOM access may fail in edge cases (SSR, tests).
      // Falls back to SPLITTER_DEFAULT_WIDTH; does not affect core functionality.
    }
    return SPLITTER_DEFAULT_WIDTH;
  }

  // ── Splitter drag for thread panel width ──

  private onPanelDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    this.dragStartX = e.clientX;
    this.dragStartWidth = this.lastPanelWidth;
    // Cache window width and left panel width for max calculation
    this.cachedWindowWidth = window.innerWidth;
    this.cachedLeftPanelWidth = this.getLeftPanelWidth();
    this.setState({ isDragging: true });
    document.addEventListener("mousemove", this.onPanelDragMove);
    document.addEventListener("mouseup", this.onPanelDragEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  private onPanelDragMove = (e: MouseEvent) => {
    // Dragging LEFT edge: moving mouse left = wider panel
    const delta = this.dragStartX - e.clientX;
    const newWidth = clampThreadWidth(
      this.dragStartWidth + delta,
      this.cachedWindowWidth,
      this.cachedLeftPanelWidth
    );
    this.lastPanelWidth = newWidth;

    // Direct DOM update — no React re-render during drag
    const panel = this.panelRef.current;
    if (panel) {
      panel.style.width = newWidth + "px";
      // Update CSS variable on parent for chat area calc
      panel.parentElement?.style.setProperty(
        "--wk-width-thread-panel",
        newWidth + "px"
      );
    }
  };

  private onPanelDragEnd = () => {
    document.removeEventListener("mousemove", this.onPanelDragMove);
    document.removeEventListener("mouseup", this.onPanelDragEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    this.setState({ panelWidth: this.lastPanelWidth, isDragging: false });
    persistThreadWidth(this.lastPanelWidth);
  };

  private onPanelDoubleClick = () => {
    this.lastPanelWidth = THREAD_DEFAULT_WIDTH;
    this.setState({ panelWidth: THREAD_DEFAULT_WIDTH });
    persistThreadWidth(THREAD_DEFAULT_WIDTH);
    this.syncCssVariable(THREAD_DEFAULT_WIDTH);
  };

  /** Keep --wk-width-thread-panel in sync so chat area calc stays correct */
  private syncCssVariable(width: number) {
    const panel = this.panelRef.current;
    panel?.parentElement?.style.setProperty(
      "--wk-width-thread-panel",
      width + "px"
    );
  }

  componentDidUpdate(prevProps: ThreadPanelProps) {
    // 纯文件预览模式时跳过子区相关逻辑
    if (this.props.groupNo) {
      const prevThreadShortId = prevProps.thread?.short_id;
      const currentThreadShortId = this.props.thread?.short_id;
      if (currentThreadShortId !== prevThreadShortId) {
        // 切换 / 清空子区时退出 Webhook 子视图，否则会停留在上一个子区的 Webhook 面板（#451 review）。
        if (this.props.thread) {
          this.setState({ view: "detail", showWebhookPanel: false });
          this.initVM(this.props.thread.short_id);
        } else {
          this.setState({ view: "list", showWebhookPanel: false });
        }
      } else if (this.props.thread !== prevProps.thread && this.props.thread) {
        // 同一个子区的状态同步只合并数据，不能重新 initVM。
        // 否则发送消息后父级传回新 thread 对象会重建右侧面板，造成二次刷新体感。
        const nextThread = this.props.thread;
        this.setState((prevState) => ({
          vmState:
            prevState.vmState.thread?.short_id === nextThread.short_id
              ? {
                  ...prevState.vmState,
                  thread: {
                    ...prevState.vmState.thread,
                    ...nextThread,
                  },
                }
              : prevState.vmState,
        }));
      }
      if (this.props.groupNo !== prevProps.groupNo) {
        this.loadThreads();
      }
    }
    // 文件预览变化时处理文件列表
    if (this.props.filePreview !== prevProps.filePreview) {
      if (this.props.filePreview) {
        // 只有当频道变化时才重新加载文件列表
        const prevChannelId =
          prevProps.filePreview?.sourceChannelId || prevProps.groupNo;
        const currChannelId =
          this.props.filePreview.sourceChannelId || this.props.groupNo;
        if (prevChannelId !== currChannelId || !prevProps.filePreview) {
          this.loadConversationFiles();
        }
      } else {
        // 退出文件预览模式时清空文件列表
        this.setState({ conversationFiles: [], isFilePanelOpen: false });
      }
    }
  }

  private initVM(threadShortId: string) {
    if (!this.props.groupNo) return;
    const vm = new ThreadPanelVM(this.props.groupNo, threadShortId, (state) => {
      if (this.vm === vm) {
        this.setState({ vmState: state });
      }
    });
    this.vm = vm;
    vm.load();
  }

  /** 获取文件列表的频道信息 */
  private getFileChannelInfo(): {
    channelId: string;
    channelType: number;
  } | null {
    const { filePreview, groupNo } = this.props;
    if (!filePreview) return null;

    // 优先使用 filePreview 中的 sourceChannelId/sourceChannelType
    // 其次使用 groupNo（如果在群聊/子区中）
    const channelId = filePreview.sourceChannelId || groupNo;
    const channelType =
      filePreview.sourceChannelType ??
      (groupNo ? ChannelTypeGroup : ChannelTypePerson);

    // 如果没有 channelId（如私聊场景未传入 sourceChannelId），跳过文件列表加载
    if (!channelId) {
      // 私聊场景不需要文件列表，静默返回 null
      return null;
    }

    return { channelId, channelType };
  }

  /** 将 API 返回的文件数据转换为 ConversationFile */
  private mapFileToConversationFile(f: ChannelFileResponse): ConversationFile {
    return {
      id: String(f.message_id),
      messageSeq: f.message_seq,
      name: f.name,
      extension: f.name.includes(".") ? f.name.split(".").pop() || "" : "",
      url: f.url,
      size: f.size,
      isAiGenerated: false, // TODO: 后端暂无此字段
      senderUid: f.from_uid,
      senderName: f.from_name,
      timestamp: f.timestamp,
      category: f.category,
    };
  }

  /** 加载对话内文件列表（首次加载） */
  private async loadConversationFiles() {
    const channelInfo = this.getFileChannelInfo();
    if (!channelInfo) return;

    this.setState({ conversationFilesLoading: true });
    try {
      const resp = await WKApp.dataSource.channelDataSource.channelFiles(
        channelInfo.channelId,
        channelInfo.channelType,
        { page: 1, limit: 30 }
      );
      const files: ConversationFile[] = resp.files
        .map((f) => this.mapFileToConversationFile(f))
        // 按 timestamp 降序排列（最新的在前面）
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      this.setState({
        conversationFiles: files,
        conversationFilesLoading: false,
        conversationFilesPage: resp.page,
        conversationFilesHasMore: resp.has_more,
      });
    } catch (err) {
      console.error("[ThreadPanel] loadConversationFiles failed:", err);
      this.setState({ conversationFilesLoading: false });
    }
  }

  /** 加载更多文件（触底加载） */
  private loadMoreConversationFiles = async () => {
    const { conversationFilesHasMore, conversationFilesPage } = this.state;

    // 使用同步标志防止竞态条件（setState 是异步的）
    if (this._loadingMore || !conversationFilesHasMore) return;
    this._loadingMore = true;

    const channelInfo = this.getFileChannelInfo();
    if (!channelInfo) {
      this._loadingMore = false;
      return;
    }

    this.setState({ conversationFilesLoadingMore: true });
    try {
      const nextPage = conversationFilesPage + 1;
      const resp = await WKApp.dataSource.channelDataSource.channelFiles(
        channelInfo.channelId,
        channelInfo.channelType,
        { page: nextPage, limit: 30 }
      );
      const newFiles: ConversationFile[] = resp.files
        .map((f) => this.mapFileToConversationFile(f))
        // 按 timestamp 降序排列（最新的在前面）
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      this.setState((prevState) => ({
        conversationFiles: [...prevState.conversationFiles, ...newFiles],
        conversationFilesLoadingMore: false,
        conversationFilesPage: resp.page,
        conversationFilesHasMore: resp.has_more,
      }));
    } catch (err) {
      console.error("[ThreadPanel] loadMoreConversationFiles failed:", err);
      this.setState({ conversationFilesLoadingMore: false });
    } finally {
      this._loadingMore = false;
    }
  };

  private async loadThreads(silent?: boolean) {
    const { groupNo } = this.props;
    // 纯文件预览模式时跳过
    if (!groupNo) return;

    if (!silent) {
      this.setState({ threadsLoading: true });
    }
    try {
      // 并行拉取子区列表 + 关注状态（用 recent tab，含 is_followed 字段）
      const [threads, sidebarResp] = await Promise.all([
        WKApp.dataSource.channelDataSource.threadList(groupNo, {
          page_index: 1,
          page_size: 100,
          status: "all",
        }),
        SidebarService.sync({
          tab: "follow",
          device_uuid: WKApp.shared.deviceId,
        }).catch(() => null),
      ]);

      // 建立已关注子区的 channel_id 集合（target_type=5，is_followed=true）
      const followedChannelIds = new Set<string>();
      if (sidebarResp?.items) {
        for (const item of sidebarResp.items) {
          if (
            item.target_type === ChannelTypeCommunityTopic &&
            item.is_followed
          ) {
            followedChannelIds.add(item.target_id);
          }
        }
      }

      // 合并 is_followed 状态
      const threadsWithFollow = threads.map((t) => ({
        ...t,
        is_followed: followedChannelIds.has(t.channel_id),
      }));

      threadsWithFollow.sort(
        (a, b) => this.threadSortTime(b) - this.threadSortTime(a)
      );
      this.setState((prevState) => {
        const currentThread = prevState.vmState.thread;
        const refreshedCurrentThread = currentThread
          ? threadsWithFollow.find(
              (item) => item.short_id === currentThread.short_id
            )
          : undefined;
        return {
          threads: threadsWithFollow,
          threadsLoading: false,
          vmState:
            currentThread && refreshedCurrentThread
              ? {
                  ...prevState.vmState,
                  thread: {
                    ...currentThread,
                    ...refreshedCurrentThread,
                  },
                }
              : prevState.vmState,
        };
      });
    } catch {
      this.setState({ threadsLoading: false });
    }
  }

  private threadSortTime(thread: Thread): number {
    const raw =
      thread.last_message_at || thread.updated_at || thread.created_at;
    const time = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  private handleThreadClick = (thread: Thread) => {
    // 子区列表点击 → 在面板内切换到 detail 视图，不切主窗口
    this.setState({
      view: "detail",
      vmState: {
        ...this.state.vmState,
        thread,
        loading: true,
        replies: [],
        hasMore: false,
        error: null,
      },
    });
    this.initVM(thread.short_id);
    // 同步状态到父组件，用于文件预览等功能判断当前活跃的子区
    this.props.onThreadSelect?.(thread);
  };

  private handleBackToList = () => {
    this.setState((prevState) => ({
      view: "list",
      showMoreMenu: false,
      vmState: {
        ...prevState.vmState,
        thread: null,
        loading: false,
        error: null,
      },
    }));
    this.props.onThreadSelect?.(null);
    this.loadThreads();
  };

  private handleOpenFullView = () => {
    const { vmState } = this.state;
    const thread = vmState.thread;
    if (!thread?.channel_id) return;
    this.setState({ showMoreMenu: false });
    try {
      const threadChannel = new Channel(
        thread.channel_id,
        ChannelTypeCommunityTopic
      );
      WKApp.endpoints.showConversation(threadChannel);
      this.props.onClose();
    } catch {
      Toast.error(t("base.threadPanel.openFailedRetry"));
    }
  };

  private getThreadSearchChannel(thread?: Thread | null): Channel | null {
    if (!thread) return null;
    const channelId =
      thread.channel_id ||
      (this.props.groupNo
        ? buildThreadChannelId(this.props.groupNo, thread.short_id)
        : "");
    if (!channelId) return null;
    return new Channel(channelId, ChannelTypeCommunityTopic);
  }

  private handleOpenChannelSearch = () => {
    const threadChannel = this.getThreadSearchChannel(
      this.state.vmState.thread
    );
    if (!isChannelSearchEnabled(threadChannel)) return;

    const opts = new ShowConversationOptions();
    opts.openChannelSearch = true;
    opts.fromSidebarList = true;
    this.setState({ showMoreMenu: false });
    WKApp.endpoints.showConversation(threadChannel, opts);
    this.props.onClose();
  };

  // 子区 Webhook 管理：复用群面板 ChannelWebhookPanel，传【父群】channel + 子区 short_id，
  // isManager 锚父群（子区无独立角色矩阵，#451）。展开为子视图（替换头部+内容），
  // 返回箭头回到子区详情，X 关闭整个面板。
  private handleOpenThreadWebhook = () => {
    this.setState({ showMoreMenu: false, showWebhookPanel: true });
  };

  private handleCloseThreadWebhook = () => {
    this.setState({ showWebhookPanel: false });
  };

  private canEditThread(thread: Thread): boolean {
    if (!this.props.groupNo) return false;
    // 父群解散后只读：更多菜单里的编辑名称 / 归档 / 取消归档全部隐藏（与创建子区
    // 按钮的 isChannelDisbanded guard 对齐）。这三项都经 canEditThread 门控
    // （渲染处 index.tsx ~1238、归档按钮 shouldShowArchiveButton ~1623），故在此
    // 单点拦截即可覆盖全部写入口。注：改名能力本身在后端解散后仍解禁、右侧面板
    // 「子区名称」行仍可改（企业微信式低风险写）；这里只是收敛 ThreadPanel 菜单入口。
    if (isChannelDisbanded(new Channel(this.props.groupNo, ChannelTypeGroup))) {
      return false;
    }
    return canManageThread(thread, this.props.groupNo);
  }

  private handleEditThread = () => {
    const { vmState } = this.state;
    const { groupNo } = this.props;
    const thread = vmState.thread;
    if (!thread || !groupNo) return;
    this.setState({ showMoreMenu: false });

    // 延迟弹窗，等 Popover 完全关闭后再触发，避免 Modal 被 Popover 关闭事件误关
    setTimeout(() => {
      let newName = thread.name;
      const inputRef = React.createRef<HTMLInputElement>();
      wkConfirm({
        title: t("base.threadPanel.editNameTitle"),
        okText: t("base.threadPanel.save"),
        cancelText: t("base.common.cancel"),
        content: (
          <ThreadNameInput
            ref={inputRef}
            defaultValue={thread.name}
            autoFocus
          />
        ),
        onOk: async () => {
          newName = inputRef.current?.value ?? thread.name;
          if (!newName || newName.trim() === "") {
            Toast.error(t("base.threadPanel.nameRequired"));
            return;
          }
          if (newName.length > THREAD_NAME_MAX_LENGTH) {
            Toast.warning(t("base.threadCreate.nameMaxLength"));
            return;
          }
          try {
            await WKApp.dataSource.channelDataSource.threadUpdate(
              groupNo,
              thread.short_id,
              { name: newName.trim() }
            );
            Toast.success(t("base.threadPanel.updateSuccess"));
            // 刷新左侧列表
            this.loadThreads();
            // 更新详情页标题
            this.setState({
              vmState: {
                ...this.state.vmState,
                thread: { ...thread, name: newName.trim() },
              },
            });

            // 清除 SDK 缓存，刷新 Chat header 展示的子区名称
            this.refreshThreadChannelInfo({
              ...thread,
              name: newName.trim(),
            });
          } catch {
            Toast.error(t("base.module.thread.saveFailedRetry"));
          }
        },
      });
    }, 100);
  };

  /**
   * 参数化的归档 / 取消归档执行函数，不依赖当前打开的子区（vmState.thread）。
   * detail 菜单（确认弹窗后）与未来其它入口都复用这里，避免逻辑重复。
   *
   * 副作用链与原实现保持一致：threadArchive/threadUnarchive → threadGet 拿到
   * 后端权威状态 → Toast 提示 → 仅当更新的是「当前打开的子区」时同步 vmState.thread
   * 与 onThreadSelect → refreshThreadChannelInfo 清 SDK 缓存 → loadThreads 刷新列表。
   * 动作由 thread.status 推导，非活跃 / 已归档（如已删除）直接忽略。
   */
  private archiveThreadById = async (thread: Thread): Promise<void> => {
    const { groupNo } = this.props;
    if (!groupNo) return;
    const action = deriveArchiveAction(thread);
    if (!action) return;
    const archiving = action === "archive";

    if (archiving) {
      await WKApp.dataSource.channelDataSource.threadArchive(
        groupNo,
        thread.short_id
      );
    } else {
      await WKApp.dataSource.channelDataSource.threadUnarchive(
        groupNo,
        thread.short_id
      );
    }

    const updatedThread = await WKApp.dataSource.channelDataSource.threadGet(
      groupNo,
      thread.short_id
    );
    Toast.success(
      archiving
        ? t("base.module.thread.archiveSuccess")
        : t("base.module.thread.unarchiveSuccess")
    );
    this.setState((prevState) =>
      prevState.vmState.thread?.short_id === updatedThread.short_id
        ? {
            vmState: {
              ...prevState.vmState,
              thread: updatedThread,
            },
          }
        : null
    );
    if (this.state.vmState.thread?.short_id === updatedThread.short_id) {
      this.props.onThreadSelect?.(updatedThread);
    }
    this.syncThreadArchiveToSidebar(updatedThread);
    await this.loadThreads();
  };

  private handleToggleArchiveThread = () => {
    const { vmState } = this.state;
    const { groupNo } = this.props;
    const thread = vmState.thread;
    if (!thread || !groupNo) return;

    const action = deriveArchiveAction(thread);
    if (!action) return;
    const archiving = action === "archive";

    this.setState({ showMoreMenu: false });

    setTimeout(() => {
      wkConfirm({
        title: archiving
          ? t("base.module.thread.archiveConfirmTitle", {
              values: { name: thread.name },
            })
          : t("base.module.thread.unarchiveConfirmTitle", {
              values: { name: thread.name },
            }),
        okText: archiving
          ? t("base.module.thread.archiveOk")
          : t("base.module.thread.unarchive"),
        cancelText: t("base.common.cancel"),
        content: archiving
          ? t("base.module.thread.archiveConfirmContent")
          : t("base.module.thread.unarchiveConfirmContent"),
        onOk: async () => {
          try {
            await this.archiveThreadById(thread);
          } catch {
            Toast.error(
              archiving
                ? t("base.module.thread.archiveFailedRetry")
                : t("base.module.thread.unarchiveFailedRetry")
            );
          }
        },
      });
    }, 100);
  };

  private handleThreadMessageSent = async () => {
    const { groupNo } = this.props;
    const thread = this.state.vmState.thread;
    if (!groupNo || !thread) return;

    if (thread.status !== ThreadStatus.Archived) return;

    void this.reconcileThreadAfterMessageSent(groupNo, thread);
  };

  private async reconcileThreadAfterMessageSent(
    groupNo: string,
    thread: Thread
  ) {
    try {
      const updatedThread = await this.fetchThreadAfterMessageSent(
        groupNo,
        thread
      );
      if (this.state.vmState.thread?.short_id !== thread.short_id) {
        return;
      }

      const currentThread = this.state.vmState.thread;
      if (!currentThread || updatedThread.status === currentThread.status) {
        return;
      }
      if (updatedThread.status === ThreadStatus.Archived) {
        return;
      }

      // 不做乐观更新：只有后端确认子区已恢复活跃后，才切换提示和菜单状态。
      this.applyThreadUpdate(updatedThread);
      this.refreshThreadChannelInfo(updatedThread);
    } catch {
      // Message sending already succeeded. Keep the archived UI until a
      // backend-backed refresh confirms the state change.
    }
  }

  private async fetchThreadAfterMessageSent(
    groupNo: string,
    thread: Thread
  ): Promise<Thread> {
    let lastThread = thread;

    for (const delay of THREAD_REACTIVATE_REFRESH_DELAYS_MS) {
      if (delay > 0) {
        await this.sleep(delay);
      }

      const updatedThread = await WKApp.dataSource.channelDataSource.threadGet(
        groupNo,
        thread.short_id
      );
      lastThread = updatedThread;
      if (
        thread.status !== ThreadStatus.Archived ||
        updatedThread.status !== ThreadStatus.Archived
      ) {
        break;
      }
    }

    return lastThread;
  }

  private applyThreadUpdate(thread: Thread) {
    this.setState((prevState) => ({
      threads: prevState.threads
        .map((item) => (item.short_id === thread.short_id ? thread : item))
        .sort((a, b) => this.threadSortTime(b) - this.threadSortTime(a)),
      vmState: {
        ...prevState.vmState,
        thread:
          prevState.vmState.thread?.short_id === thread.short_id
            ? thread
            : prevState.vmState.thread,
      },
    }));
    this.props.onThreadSelect?.(thread);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  }

  private refreshThreadChannelInfo(thread: Thread) {
    const channelID =
      thread.channel_id ||
      (this.props.groupNo
        ? buildThreadChannelId(this.props.groupNo, thread.short_id)
        : "");
    if (!channelID) return;
    const threadChannel = new Channel(channelID, ChannelTypeCommunityTopic);
    deleteImChannelInfo(WKSDK.shared(), threadChannel);
    void fetchImChannelInfo(WKSDK.shared(), threadChannel);
  }

  /**
   * 归档 / 取消归档成功后同步左侧 sidebar（issue #345）。收口到共享的
   * syncThreadArchiveState：用调用方传入的权威 thread.status 直接写回 channelInfo
   * 缓存并 notifyListeners，再 emit("sidebar-reload")。传权威 status 而非绕异步
   * fetchChannelInfo，避免被归档前在途的旧请求覆盖（B1 去重竞态）。
   * 各入口在调用前已把 thread.status 设为操作后的权威值。
   */
  private syncThreadArchiveToSidebar(thread: Thread) {
    const channelID =
      thread.channel_id ||
      (this.props.groupNo
        ? buildThreadChannelId(this.props.groupNo, thread.short_id)
        : "");
    if (!channelID) return;
    syncThreadArchiveState(channelID, thread.status);
  }

  private handleDeleteThread = () => {
    const { vmState } = this.state;
    const { groupNo } = this.props;
    const thread = vmState.thread;
    if (!thread || !groupNo) return;
    this.setState({ showMoreMenu: false });

    setTimeout(() => {
      wkConfirm({
        title: t("base.threadPanel.deleteConfirmTitle", {
          values: { name: thread.name },
        }),
        okText: t("base.threadPanel.delete"),
        okType: "danger",
        cancelText: t("base.common.cancel"),
        content: t("base.threadPanel.deleteConfirmContent"),
        onOk: async () => {
          try {
            await WKApp.dataSource.channelDataSource.threadDelete(
              groupNo,
              thread.short_id
            );
            Toast.success(t("base.threadPanel.deleteSuccess"));
            this.handleBackToList();
          } catch {
            Toast.error(t("base.threadPanel.deleteFailedRetry"));
          }
        },
      });
    }, 100);
  };

  private handleCreateThread = () => {
    const { groupNo, onCreateThread } = this.props;
    if (onCreateThread) {
      onCreateThread();
      return;
    }
    if (!groupNo) return;

    this.setState({ createDialogVisible: true, createError: null });
  };

  private handleSubmitCreateThread = async (threadName: string) => {
    const { groupNo } = this.props;
    if (!groupNo) return;

    this.setState({ createLoading: true, createError: null });
    try {
      await createThreadByNameAndNotify(groupNo, threadName);
      Toast.success(t("base.module.createThread.success"));
      this.setState({ createDialogVisible: false, createLoading: false });
      this.loadThreads();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : t("base.module.createThread.failed");
      Toast.error(msg);
      this.setState({ createLoading: false, createError: msg });
    }
  };

  private handleCreateThreadNameChange = () => {
    if (this.state.createError) {
      this.setState({ createError: null });
    }
  };

  /** 文件选择回调：切换预览的文件（从 ConversationFile 构造 FilePreviewInfo） */
  private handleFileSelect = (file: ConversationFile) => {
    const { filePreview, onFilePreviewChange } = this.props;
    if (!onFilePreviewChange) {
      console.warn(
        "[ThreadPanel] handleFileSelect: onFilePreviewChange not provided"
      );
      return;
    }
    // 根据文件类型生成回复摘要
    let digest = file.name;
    if (file.category === "image") {
      digest = t("base.threadPanel.digest.image");
    } else if (file.category === "video") {
      digest = t("base.threadPanel.digest.video");
    } else if (file.category) {
      digest = t("base.threadPanel.digest.file", {
        values: { name: file.name },
      });
    }

    // 构造 FilePreviewInfo 并调用回调
    const newPreview: FilePreviewInfo = {
      url: file.url,
      name: file.name,
      extension: file.extension,
      size: file.size,
      sourceChannelId: filePreview?.sourceChannelId,
      sourceChannelType: filePreview?.sourceChannelType,
      messageId: file.id, // ConversationFile.id 就是 message_id
      messageSeq: file.messageSeq,
      fromUID: file.senderUid,
      conversationDigest: digest,
      category: file.category,
    };
    onFilePreviewChange(newPreview);
  };

  private renderHeader() {
    const { onClose, filePreview, onFilePreviewClose } = this.props;
    const { view, vmState, showMoreMenu, fileViewMode, isTocOpen } = this.state;
    const thread = vmState.thread;
    const threadSearchChannel = this.getThreadSearchChannel(thread);
    const canOpenChannelSearch = isChannelSearchEnabled(threadSearchChannel);

    // 文件预览模式：使用 FilePreviewHeader 组件
    if (filePreview) {
      // 判断是否有子区可返回: 需要 groupNo (群聊上下文) 且调用方显式传
      // showBackButton=true (预览开始前确实有子区面板)。仅 groupNo 不够,
      // 否则任何群聊里的消息附件预览都会冒出 ← 把用户带到子区列表 — 没
      // 来过子区的人会被 ← 误导。
      const canReturnToThread =
        !!this.props.groupNo && this.props.showBackButton === true;

      // 判断是否需要显示视图切换（代码/HTML 等类型）
      const ext = getExtension(filePreview.extension, filePreview.name);
      const showViewToggle = [
        "html",
        "htm",
        "md",
        "markdown",
        "js",
        "jsx",
        "ts",
        "tsx",
        "css",
        "scss",
        "less",
        "json",
        "xml",
        "yaml",
        "yml",
      ].includes(ext);

      // 判断是否为 Markdown 文件
      const isMarkdown = ["md", "markdown"].includes(ext);

      // 判断是否为 HTML 文件（仅 HTML 文件显示"在新标签页打开"按钮）
      const isHtml = ["html", "htm"].includes(ext);

      // 判断是否显示 TOC 按钮（仅 Markdown 预览模式且 h2 ≥ 3）
      const showTocButton =
        isMarkdown && fileViewMode === "preview" && this.state.isTocAvailable;

      // 回复回调：仅当有必要字段和 onReplyFile 时才启用（conversationDigest 可为空）
      const handleReply =
        filePreview.messageId &&
        filePreview.messageSeq !== undefined &&
        filePreview.fromUID &&
        filePreview.sourceChannelId &&
        filePreview.sourceChannelType !== undefined &&
        this.props.onReplyFile
          ? () =>
              this.props.onReplyFile!({
                messageId: filePreview.messageId!,
                messageSeq: filePreview.messageSeq!,
                fromUID: filePreview.fromUID!,
                conversationDigest: filePreview.conversationDigest || "",
                channelId: filePreview.sourceChannelId!,
                channelType: filePreview.sourceChannelType!,
              })
          : undefined;

      // 视图模式变更：切换到源码模式时关闭 TOC
      const handleViewModeChange = (mode: "preview" | "source") => {
        this.setState({ fileViewMode: mode });
        if (mode === "source" && isTocOpen) {
          this.setState({ isTocOpen: false });
        }
      };

      return (
        <FilePreviewHeader
          file={filePreview}
          conversationFiles={this.state.conversationFiles}
          onFileSelect={this.handleFileSelect}
          isFilePanelOpen={this.state.isFilePanelOpen}
          onFilePanelToggle={() =>
            this.setState({ isFilePanelOpen: !this.state.isFilePanelOpen })
          }
          showBackButton={canReturnToThread}
          onBack={onFilePreviewClose}
          onClose={onClose}
          showViewToggle={showViewToggle}
          viewMode={fileViewMode}
          onViewModeChange={handleViewModeChange}
          onReply={handleReply}
          showTocButton={showTocButton}
          isTocOpen={isTocOpen}
          onTocToggle={() => this.setState({ isTocOpen: !isTocOpen })}
          showOpenExternal={isHtml}
          hasMoreFiles={this.state.conversationFilesHasMore}
          loadingMoreFiles={this.state.conversationFilesLoadingMore}
          onLoadMoreFiles={this.loadMoreConversationFiles}
          currentFilesPage={this.state.conversationFilesPage}
        />
      );
    }

    // 子区 Webhook 管理子视图的 header（#451）：← 回子区详情，× 关闭面板。
    // 与 filePreview 同样在 renderHeader 内分支（filePreview 已先 return，故此处必非预览态）。
    if (this.state.showWebhookPanel) {
      return (
        <div className="wk-thread-panel-header">
          <div
            className="wk-thread-panel-header-btn"
            onClick={this.handleCloseThreadWebhook}
            title={t("base.threadPanel.backToThread")}
          >
            <ArrowLeft size={16} />
          </div>
          <div className="wk-thread-panel-header-title">
            <ThreadIcon className="wk-thread-panel-header-icon" size={18} />
            <span>
              {t("base.threadPanel.webhookTitle", {
                values: {
                  name: thread?.name || t("base.module.thread.fallbackName"),
                },
              })}
            </span>
          </div>
          <div className="wk-thread-panel-header-actions">
            <div className="wk-thread-panel-header-btn" onClick={onClose}>
              <X size={18} />
            </div>
          </div>
        </div>
      );
    }

    // 子区模式的 header
    return (
      <div className="wk-thread-panel-header">
        {/* detail 视图：左侧返回按钮 */}
        {view === "detail" ? (
          <div
            className="wk-thread-panel-header-btn"
            onClick={this.handleBackToList}
            title={t("base.threadPanel.backToAll")}
          >
            <ArrowLeft size={16} />
          </div>
        ) : null}

        <div className="wk-thread-panel-header-title">
          {view === "list" ? (
            <>
              <ThreadIcon className="wk-thread-panel-header-icon" size={18} />
              <span>{t("base.threadPanel.title")}</span>
            </>
          ) : (
            <>
              <ThreadIcon className="wk-thread-panel-header-icon" size={18} />
              <span>
                {thread?.name || t("base.module.thread.fallbackName")}
              </span>
            </>
          )}
        </div>

        <div className="wk-thread-panel-header-actions">
          {/* detail 视图：右侧 ··· 菜单 */}
          {view === "detail" && (
            <Popover
              visible={showMoreMenu}
              onVisibleChange={(v) => this.setState({ showMoreMenu: v })}
              trigger="click"
              position="bottomRight"
              showArrow={false}
              content={
                <div className="wk-thread-more-menu">
                  {vmState.thread?.channel_id && (
                    <div
                      className="wk-thread-more-menu-item"
                      onClick={this.handleOpenFullView}
                    >
                      {t("base.threadPanel.openFullView")}
                    </div>
                  )}
                  {vmState.thread && this.canEditThread(vmState.thread) && (
                    <>
                      <div
                        className="wk-thread-more-menu-item"
                        onClick={this.handleEditThread}
                      >
                        {t("base.threadPanel.editNameTitle")}
                      </div>
                      {vmState.thread.status === ThreadStatus.Active && (
                        <div
                          className="wk-thread-more-menu-item"
                          onClick={this.handleToggleArchiveThread}
                        >
                          {t("base.module.thread.archive")}
                        </div>
                      )}
                      {vmState.thread.status === ThreadStatus.Archived && (
                        <div
                          className="wk-thread-more-menu-item"
                          onClick={this.handleToggleArchiveThread}
                        >
                          {t("base.module.thread.unarchive")}
                        </div>
                      )}
                    </>
                  )}
                  {vmState.thread && canOpenChannelSearch && (
                    <div
                      className="wk-thread-more-menu-item"
                      onClick={this.handleOpenChannelSearch}
                    >
                      {t("base.threadPanel.searchMessages")}
                    </div>
                  )}
                  {/* 子区 Webhook 管理入口（#451）：对全员可见（list 全员只读、成员可建自己的），
                      仅活跃子区可见 —— 归档子区创建会被后端拒，避免无效 CTA。
                      父群解散后也隐藏 —— webhook 写操作（create/update/regenerate/delete）
                      与 read-only 合约冲突，与 delete 同模式。 */}
                  {vmState.thread &&
                    vmState.thread.status === ThreadStatus.Active &&
                    !isChannelDisbanded(
                      new Channel(this.props.groupNo, ChannelTypeGroup)
                    ) && (
                      <div
                        className="wk-thread-more-menu-item"
                        onClick={this.handleOpenThreadWebhook}
                      >
                        {t("base.threadPanel.webhook")}
                      </div>
                    )}
                  {!isChannelDisbanded(
                    new Channel(this.props.groupNo, ChannelTypeGroup)
                  ) && (
                    <div
                      className="wk-thread-more-menu-item wk-thread-more-menu-item-danger"
                      onClick={this.handleDeleteThread}
                    >
                      {t("base.threadPanel.delete")}
                    </div>
                  )}
                </div>
              }
            >
              <div
                className="wk-thread-panel-header-btn"
                title={t("base.threadPanel.moreActions")}
              >
                <MoreHorizontal size={16} />
              </div>
            </Popover>
          )}
          <div className="wk-thread-panel-header-btn" onClick={onClose}>
            <X size={18} />
          </div>
        </div>
      </div>
    );
  }

  private renderListView() {
    const {
      threads,
      threadsLoading,
      activeExpanded,
      archivedExpanded,
      createDialogVisible,
      createLoading,
      createError,
    } = this.state;
    const createLabels: ThreadCreateLabels = {
      cancel: t("base.common.cancel"),
      create: t("base.module.createThread.ok"),
      creating: t("base.threadCreate.creating"),
      maxLength: t("base.threadCreate.nameMaxLength"),
      nameRequired: t("base.module.createThread.nameRequired"),
    };

    const activeThreads = threads.filter(
      (t) => t.status === ThreadStatus.Active
    );
    const archivedThreads = threads.filter(
      (t) => t.status === ThreadStatus.Archived
    );

    // 父群已解散：禁止新建子区（与后端 CreateThread 解散守卫对齐）。
    const disbanded = this.props.groupNo
      ? isChannelDisbanded(
          new Channel(this.props.groupNo, ChannelTypeGroup)
        )
      : false;

    const createBtn = (
      <div
        className={classNames("wk-thread-panel-create-btn", {
          "wk-thread-panel-create-btn--disabled": disbanded,
        })}
        onClick={disbanded ? undefined : this.handleCreateThread}
      >
        <Plus size={16} />
        <span>{t("base.threadPanel.newThread")}</span>
      </div>
    );

    return (
      <div className="wk-thread-panel-list-view">
        {/* 新建子区按钮 */}
        {disbanded ? (
          <Popover
            content={t("base.conversation.disband.threadCreateDisabled")}
            position="bottom"
          >
            {createBtn}
          </Popover>
        ) : (
          createBtn
        )}

        {threadsLoading ? (
          <div className="wk-thread-panel-loading">
            <Spin />
          </div>
        ) : (
          <>
            {/* 活跃中分组 */}
            <div className="wk-thread-panel-group">
              <div
                className="wk-thread-panel-group-header"
                onClick={() =>
                  this.setState({ activeExpanded: !activeExpanded })
                }
              >
                <ChevronDown
                  size={14}
                  className={classNames(
                    "wk-thread-panel-group-arrow",
                    !activeExpanded && "wk-thread-panel-group-arrow-collapsed"
                  )}
                />
                <span>{t("base.module.thread.status.active")}</span>
              </div>
              {activeExpanded && (
                <div className="wk-thread-panel-group-list">
                  {activeThreads.length === 0 ? (
                    <div className="wk-thread-panel-empty">
                      {t("base.threadPanel.noActiveThreads")}
                    </div>
                  ) : (
                    activeThreads.map((thread) => this.renderThreadItem(thread))
                  )}
                </div>
              )}
            </div>

            {/* 已归档分组 */}
            {archivedThreads.length > 0 && (
              <div className="wk-thread-panel-group">
                <div
                  className="wk-thread-panel-group-header"
                  onClick={() =>
                    this.setState({ archivedExpanded: !archivedExpanded })
                  }
                >
                  <ChevronDown
                    size={14}
                    className={classNames(
                      "wk-thread-panel-group-arrow",
                      !archivedExpanded &&
                        "wk-thread-panel-group-arrow-collapsed"
                    )}
                  />
                  <span>{t("base.module.thread.status.archived")}</span>
                </div>
                {archivedExpanded && (
                  <div className="wk-thread-panel-group-list">
                    {archivedThreads.map((thread) =>
                      this.renderThreadItem(thread)
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <ThreadCreateDialog
          visible={createDialogVisible && !disbanded}
          title={t("base.module.createThread.title")}
          label={t("base.module.createThread.nameLabel")}
          placeholder={t("base.module.createThread.namePlaceholder")}
          maxLength={THREAD_NAME_MAX_LENGTH}
          loading={createLoading}
          error={createError}
          labels={createLabels}
          showCounter
          formVariant="confirm"
          onSubmit={this.handleSubmitCreateThread}
          onChange={this.handleCreateThreadNameChange}
          onCancel={() =>
            this.setState({ createDialogVisible: false, createError: null })
          }
        />
      </div>
    );
  }

  private getCreatorName(thread: Thread): string {
    if (thread.creator_name) {
      return thread.creator_name;
    }
    if (thread.creator_uid) {
      const channelInfo = getImChannelInfo(
        WKSDK.shared(),
        new Channel(thread.creator_uid, ChannelTypePerson)
      );
      return channelInfo?.title || thread.creator_uid;
    }
    return t("base.common.unknown");
  }

  private handleFollow = async (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation();
    const threadChannelId = thread.channel_id;
    const wasFollowed = thread.is_followed;

    // 乐观更新
    this.setState((prev) => ({
      threads: prev.threads.map((t) =>
        t.short_id === thread.short_id ? { ...t, is_followed: !wasFollowed } : t
      ),
    }));

    try {
      if (wasFollowed) {
        await FollowService.unfollowThread(threadChannelId);
        Toast.success(t("base.threadList.unfollowed"));
      } else {
        await this.ensureParentGroupInFollowSet(thread.group_no);
        await FollowService.followThread({
          thread_channel_id: threadChannelId,
        });
        Toast.success(t("base.threadList.followed"));
      }
      WKApp.mittBus.emit("sidebar-reload" as any);
    } catch (err: any) {
      this.setState((prev) => ({
        threads: prev.threads.map((t) =>
          t.short_id === thread.short_id
            ? { ...t, is_followed: wasFollowed }
            : t
        ),
      }));
      Toast.error(
        err?.msg ||
          err?.message ||
          t(
            wasFollowed
              ? "base.threadList.unfollowFailed"
              : "base.threadList.followFailed"
          )
      );
    }
  };

  /** 撤销 Toast 自动关闭时间（秒），与 setTimeout 清理保持一致 */
  private static readonly ARCHIVE_UNDO_DURATION_S = 5;

  /** 乐观更新某子区的 status（活跃 ⇄ 已归档），自动在活跃组 / 已归档组间移动 */
  private setThreadStatusOptimistic(shortId: string, status: number) {
    this.setState((prev) => ({
      threads: prev.threads.map((item) =>
        item.short_id === shortId ? { ...item, status } : item
      ),
    }));
  }

  /**
   * 行内归档按钮入口（方案 B）。照搬 handleFollow 行内范式：
   * e.stopPropagation() 阻止冒泡到整行 handleThreadClick + 乐观更新。
   * 活跃 → 一键归档并弹「撤销」Toast；已归档 → 直接取消归档（无需撤销）。
   * archivingShortIds 防重复点击与撤销窗口竞态。
   */
  private handleInlineArchiveToggle = (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation();
    const { groupNo } = this.props;
    if (!groupNo) return;
    const action = deriveArchiveAction(thread);
    if (!action) return;
    if (this.archivingShortIds.has(thread.short_id)) return;

    if (action === "archive") {
      void this.inlineArchive(groupNo, thread);
    } else {
      void this.inlineUnarchive(groupNo, thread);
    }
  };

  private async inlineArchive(groupNo: string, thread: Thread) {
    this.archivingShortIds.add(thread.short_id);
    // 乐观：活跃 → 已归档（自动移到已归档组）
    this.setThreadStatusOptimistic(thread.short_id, ThreadStatus.Archived);
    try {
      await WKApp.dataSource.channelDataSource.threadArchive(
        groupNo,
        thread.short_id
      );
      // 卸载后短路：撤销 Toast 渲染在全局 portal，卸载后再创建会绕过 cleanup。
      if (this.isUnmounted) return;
      this.syncThreadArchiveToSidebar({
        ...thread,
        status: ThreadStatus.Archived,
      });
      this.showArchiveUndoToast(groupNo, thread);
    } catch {
      if (this.isUnmounted) return;
      // 失败回滚乐观状态
      this.setThreadStatusOptimistic(thread.short_id, ThreadStatus.Active);
      Toast.error(t("base.module.thread.archiveFailedRetry"));
    } finally {
      this.archivingShortIds.delete(thread.short_id);
    }
  }

  private async inlineUnarchive(groupNo: string, thread: Thread) {
    this.archivingShortIds.add(thread.short_id);
    // 乐观：已归档 → 活跃
    this.setThreadStatusOptimistic(thread.short_id, ThreadStatus.Active);
    try {
      await WKApp.dataSource.channelDataSource.threadUnarchive(
        groupNo,
        thread.short_id
      );
      // 卸载后短路：避免对已卸载组件 setState 并刷新列表。
      if (this.isUnmounted) return;
      Toast.success(t("base.module.thread.unarchiveSuccess"));
      this.syncThreadArchiveToSidebar({
        ...thread,
        status: ThreadStatus.Active,
      });
      await this.loadThreads();
    } catch {
      if (this.isUnmounted) return;
      this.setThreadStatusOptimistic(thread.short_id, ThreadStatus.Archived);
      Toast.error(t("base.module.thread.unarchiveFailedRetry"));
    } finally {
      this.archivingShortIds.delete(thread.short_id);
    }
  }

  /** 弹出带「撤销」按钮的自定义 Toast，约 5s 后自动消失 */
  private showArchiveUndoToast(groupNo: string, thread: Thread) {
    const duration = ThreadPanel.ARCHIVE_UNDO_DURATION_S;
    const toastId = Toast.info({
      duration,
      content: (
        <div className="wk-thread-archive-undo-toast">
          <span>{t("base.module.thread.archiveSuccess")}</span>
          <button
            type="button"
            className="wk-thread-archive-undo-btn"
            onClick={() => this.handleUndoArchive(groupNo, thread)}
          >
            {t("base.module.thread.archiveUndo")}
          </button>
        </div>
      ),
    });
    this.undoToastIds.set(thread.short_id, toastId);
    const timer = setTimeout(() => {
      this.undoToastTimers.delete(thread.short_id);
      this.undoToastIds.delete(thread.short_id);
      // 撤销窗口结束后做一次静默对账：行内归档成功路径只有前端拼的乐观对象，
      // 后端权威字段（archived_at/updated_at/排序时间等）未刷新。窗口内不立即
      // loadThreads 以免行抖动；到点后静默刷新与其它路径对齐。卸载后跳过。
      if (this.isUnmounted) return;
      void this.loadThreads(true);
    }, duration * 1000);
    this.undoToastTimers.set(thread.short_id, timer);
  }

  /** 点击撤销：关闭 Toast、清理计时器，并取消归档恢复活跃 */
  private handleUndoArchive = async (groupNo: string, thread: Thread) => {
    // 撤销 Toast 渲染在全局 portal，本组件卸载后仍可能被点击：短路避免对已卸载
    // 组件 setState 并发出无意义请求。卸载时已统一 Toast.close，这里兜底。
    if (this.isUnmounted) return;
    const toastId = this.undoToastIds.get(thread.short_id);
    if (toastId) Toast.close(toastId);
    const timer = this.undoToastTimers.get(thread.short_id);
    if (timer) clearTimeout(timer);
    this.undoToastTimers.delete(thread.short_id);
    this.undoToastIds.delete(thread.short_id);

    if (this.archivingShortIds.has(thread.short_id)) return;
    this.archivingShortIds.add(thread.short_id);
    // 乐观恢复活跃
    this.setThreadStatusOptimistic(thread.short_id, ThreadStatus.Active);
    try {
      await WKApp.dataSource.channelDataSource.threadUnarchive(
        groupNo,
        thread.short_id
      );
      // 卸载后短路：避免对已卸载组件 setState 并刷新列表。
      if (this.isUnmounted) return;
      this.syncThreadArchiveToSidebar({
        ...thread,
        status: ThreadStatus.Active,
      });
      await this.loadThreads();
    } catch {
      if (this.isUnmounted) return;
      this.setThreadStatusOptimistic(thread.short_id, ThreadStatus.Archived);
      Toast.error(t("base.module.thread.unarchiveFailedRetry"));
    } finally {
      this.archivingShortIds.delete(thread.short_id);
    }
  };

  /** 行内归档 / 取消归档按钮：无权限或状态不可操作时返回 null */
  private renderArchiveButton(thread: Thread) {
    if (!shouldShowArchiveButton(thread, this.canEditThread(thread))) {
      return null;
    }
    const action: ArchiveAction | null = deriveArchiveAction(thread);
    const archiving = action === "archive";
    const label = archiving
      ? t("base.module.thread.archive")
      : t("base.module.thread.unarchive");
    return (
      <button
        type="button"
        className="wk-thread-panel-item-archive-btn"
        data-action={action ?? ""}
        title={label}
        aria-label={label}
        onClick={(e) => this.handleInlineArchiveToggle(thread, e)}
      >
        {archiving ? <Archive size={13} /> : <ArchiveRestore size={13} />}
        <span className="wk-thread-panel-item-archive-btn-label">{label}</span>
      </button>
    );
  }
  /**
   * 确保父群已进入关注集合（有关联的 category）。
   * 子区关注依赖父群在 sidebar follow tab 的 follow set 里，
   * 否则 mergeThreadEntries 会将子区过滤掉。
   * 这里静默操作：父群已在某分组则跳过，否则移入默认分组。
   * 如果用户之前手动取消关注了父群，这里会将其重新关注 —— 这是子区关注的前提条件。
   */
  private async ensureParentGroupInFollowSet(parentGroupNo: string) {
    const spaceId = WKApp.shared.currentSpaceId;
    if (!spaceId) return;

    try {
      // 清除父群取消关注标记（幂等，已关注则无操作）
      await FollowService.refollowChannel({ group_no: parentGroupNo });
    } catch (err) {
      console.warn(
        "[ThreadPanel] refollowChannel failed for parent group",
        parentGroupNo,
        err
      );
    }

    try {
      const categories = await CategoryService.list(spaceId);
      const alreadyInCategory = categories.some((cat) =>
        cat.groups?.some((g) => g.group_no === parentGroupNo)
      );
      if (alreadyInCategory) return;

      const targetCategory =
        categories.find((cat) => cat.is_default && cat.category_id) ||
        categories.find((cat) => cat.category_id);
      if (targetCategory?.category_id) {
        await CategoryService.moveGroupToCategory(parentGroupNo, {
          category_id: targetCategory.category_id,
        });
      }
    } catch (err) {
      console.warn(
        "[ThreadPanel] ensureParentGroupInFollowSet category failed",
        parentGroupNo,
        err
      );
    }
  }

  private renderThreadItem(thread: Thread) {
    const hasUnread = (thread.unread_count ?? 0) > 0;
    const creatorName = this.getCreatorName(thread);

    return (
      <div
        key={thread.short_id}
        className="wk-thread-panel-item"
        onClick={() => this.handleThreadClick(thread)}
      >
        <div className="wk-thread-panel-item-header">
          <div className="wk-thread-panel-item-title">
            {hasUnread && <span className="wk-thread-panel-item-unread" />}
            <span className="wk-thread-panel-item-name">{thread.name}</span>
          </div>
          <div className="wk-thread-panel-item-header-right">
            {this.renderArchiveButton(thread)}
            <button
              type="button"
              className="wk-thread-panel-item-follow-btn"
              data-followed={thread.is_followed ? "true" : "false"}
              title={
                thread.is_followed
                  ? t("base.threadList.unfollow")
                  : t("base.threadList.follow")
              }
              aria-label={
                thread.is_followed
                  ? t("base.threadList.unfollow")
                  : t("base.threadList.follow")
              }
              onClick={(e) => this.handleFollow(thread, e)}
            >
              <Star
                size={15}
                fill={thread.is_followed ? "var(--semi-color-warning)" : "none"}
                color={
                  thread.is_followed
                    ? "var(--semi-color-warning)"
                    : "var(--semi-color-text-2)"
                }
              />
            </button>
            <span className="wk-thread-panel-item-time">
              {formatRelativeTime(thread.updated_at)}
            </span>
          </div>
        </div>
        <div className="wk-thread-panel-item-meta">
          {t("base.threadPanel.itemMeta", {
            values: {
              replies: thread.message_count || 0,
              members: thread.member_count || 0,
              creator: creatorName,
            },
          })}
        </div>
        {thread.last_message_content && (
          <div className="wk-thread-panel-item-preview">
            {thread.last_message_sender_name}: {thread.last_message_content}
          </div>
        )}
        {!thread.last_message_content && (
          <div className="wk-thread-panel-item-preview wk-thread-panel-item-preview-empty">
            {t("base.threadPanel.noMessages")}
          </div>
        )}
      </div>
    );
  }

  private renderDetailView() {
    const { vmState } = this.state;
    const { loading, thread } = vmState;

    if (loading) {
      return (
        <div className="wk-thread-panel-loading">
          <Spin />
        </div>
      );
    }

    if (!thread) {
      return (
        <div className="wk-thread-panel-empty">
          {t("base.threadPanel.notFound")}
        </div>
      );
    }

    // 使用 Thread 的 channel_id 创建 Channel 对象
    const threadChannel = new Channel(
      thread.channel_id,
      ChannelTypeCommunityTopic
    );

    return (
      <div className="wk-thread-panel-conversation">
        <ErrorBoundary moduleName={t("base.threadPanel.messagesModuleName")}>
          <Conversation
            key={thread.channel_id}
            channel={threadChannel}
            shouldShowHistorySplit={false}
            inputNotice={
              thread.status === ThreadStatus.Archived
                ? t("base.threadPanel.archivedInputNotice")
                : undefined
            }
            onMessageSent={this.handleThreadMessageSent}
          />
        </ErrorBoundary>
      </div>
    );
  }

  /** 处理 TOC 可用状态变化 */
  private handleTocAvailableChange = (available: boolean) => {
    if (this.state.isTocAvailable !== available) {
      this.setState({ isTocAvailable: available });
    }
  };

  private renderFilePreviewContent() {
    const { filePreview } = this.props;
    const { fileViewMode, isTocOpen } = this.state;
    if (!filePreview) return null;

    const ext = getExtension(filePreview.extension, filePreview.name);
    const isImage = filePreview.category === "image";
    const isVideo = filePreview.category === "video";
    const isMarkdown = ["md", "markdown"].includes(ext);
    const isHtml = ["html", "htm"].includes(ext);

    const handleError = (error: string) => {
      console.error("FilePreview error:", error);
    };

    // 图片类型（根据 category 判断，因为图片 URL 可能没有扩展名）
    if (isImage) {
      return (
        <div className="wk-thread-panel-file-preview">
          <ImageRenderer file={filePreview} onError={handleError} />
        </div>
      );
    }

    if (isVideo) {
      return (
        <div className="wk-thread-panel-file-preview">
          <VideoRenderer file={filePreview} onError={handleError} />
        </div>
      );
    }

    // Markdown 文件使用增强的 MarkdownRenderer
    if (isMarkdown) {
      return (
        <div className="wk-thread-panel-file-preview">
          <MarkdownRenderer
            file={filePreview}
            onError={handleError}
            viewMode={fileViewMode}
            onViewModeChange={(mode) => this.setState({ fileViewMode: mode })}
            isTocOpen={isTocOpen}
            onTocToggle={() => this.setState({ isTocOpen: !isTocOpen })}
            onTocAvailableChange={this.handleTocAvailableChange}
          />
        </div>
      );
    }

    // HTML 文件使用增强的 HtmlRenderer（支持预览/源码切换）
    if (isHtml) {
      return (
        <div className="wk-thread-panel-file-preview">
          <HtmlRenderer
            file={filePreview}
            onError={handleError}
            viewMode={fileViewMode}
            onViewModeChange={(mode) => this.setState({ fileViewMode: mode })}
          />
        </div>
      );
    }

    // 其他文件类型使用注册表中的渲染器
    const { renderer: Renderer } = fileRendererRegistry.getRenderer(ext);

    return (
      <div className="wk-thread-panel-file-preview">
        <Renderer file={filePreview} onError={handleError} />
      </div>
    );
  }

  // 父群 channel 按 groupNo 记忆化：renderWebhookContent 每次 render 都会被调用，若每次都
  // new Channel，传给 ChannelWebhookPanel 的 channel prop 引用就会变 → 其 load useCallback
  // （deps 含 channel）每次 render 重建 → useEffect 每次 render 重新拉取列表（#451 review）。
  private parentGroupChannel?: Channel;
  private parentGroupChannelKey?: string;
  private getParentGroupChannel(groupNo: string): Channel {
    if (this.parentGroupChannelKey !== groupNo || !this.parentGroupChannel) {
      this.parentGroupChannelKey = groupNo;
      this.parentGroupChannel = new Channel(groupNo, ChannelTypeGroup);
    }
    return this.parentGroupChannel;
  }

  // 子区 Webhook 管理子视图的内容区（#451）：仅渲染面板本体，头部由 renderHeader 的
  // showWebhookPanel 分支负责。channel 传【父群】（datasource 据此拼
  // groups/{group}/threads/{short}/...），isManager 锚父群角色。
  private renderWebhookContent() {
    const { groupNo } = this.props;
    const thread = this.state.vmState.thread;
    if (!groupNo || !thread) return null;
    return (
      <div className="wk-thread-panel-webhook-content">
        <ChannelWebhookPanel
          channel={this.getParentGroupChannel(groupNo)}
          isManager={isParentGroupManager(groupNo)}
          threadShortId={thread.short_id}
        />
      </div>
    );
  }

  render() {
    const { filePreview } = this.props;
    const {
      view,
      panelWidth,
      isDragging,
      isFilePanelOpen,
      conversationFiles,
      vmState,
      showWebhookPanel,
    } = this.state;
    const isSmallScreen = window.innerWidth <= SMALL_SCREEN_WIDTH;

    const panelStyle = isSmallScreen
      ? undefined
      : {
          width: `${panelWidth}px`,
        };

    return (
      <div className="wk-thread-panel" ref={this.panelRef} style={panelStyle}>
        {/* Left-edge splitter for resizing — hidden on small screens */}
        {!isSmallScreen && (
          <div
            className={classNames(
              "wk-thread-panel-splitter",
              isDragging && "wk-thread-panel-splitter-active"
            )}
            onMouseDown={this.onPanelDragStart}
            onDoubleClick={this.onPanelDoubleClick}
          >
            <div className="wk-thread-panel-splitter-line" />
          </div>
        )}
        <div className="wk-thread-panel-main">
          {this.renderHeader()}
          {/* 根据 filePreview 决定渲染文件预览还是子区内容 */}
          {filePreview ? (
            <div
              className={classNames(
                "wk-thread-panel-file-content",
                isFilePanelOpen && "wk-thread-panel-file-content--with-list"
              )}
            >
              {/* 侧边文件列表面板 */}
              {isFilePanelOpen && (
                <FileListPanel
                  files={conversationFiles}
                  currentFileUrl={filePreview.url}
                  onFileSelect={this.handleFileSelect}
                  onClose={() => this.setState({ isFilePanelOpen: false })}
                  hasMore={this.state.conversationFilesHasMore}
                  loadingMore={this.state.conversationFilesLoadingMore}
                  onLoadMore={this.loadMoreConversationFiles}
                  currentPage={this.state.conversationFilesPage}
                  initialLoading={this.state.conversationFilesLoading}
                />
              )}
              {/* 文件预览内容 */}
              {this.renderFilePreviewContent()}
            </div>
          ) : showWebhookPanel ? (
            this.renderWebhookContent()
          ) : view === "list" ? (
            this.renderListView()
          ) : (
            this.renderDetailView()
          )}
        </div>
        {isDragging && <div className="wk-thread-panel-drag-overlay" />}
      </div>
    );
  }
}
