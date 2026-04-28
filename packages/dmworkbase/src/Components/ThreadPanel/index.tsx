import React, { Component } from "react";
import {
  Channel,
  ChannelTypePerson,
  ChannelTypeGroup,
  WKSDK,
} from "wukongimjssdk";
import { Modal, Toast, Spin, Popover } from "@douyinfe/semi-ui";
import {
  Thread,
  ThreadStatus,
  buildThreadChannelId,
} from "../../Service/Thread";
import { ThreadPanelVM, ThreadPanelState } from "./vm";
import { X, Plus, ChevronDown, ArrowLeft, MoreHorizontal } from "lucide-react";
import ThreadIcon from "../Icons/ThreadIcon";
import classNames from "classnames";
import { Conversation } from "../Conversation";
import { ChannelTypeCommunityTopic, GroupRole } from "../../Service/Const";
import { ErrorBoundary } from "../ErrorBoundary";
import WKApp from "../../App";
import { formatRelativeTime } from "../../Utils/time";
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
import {
  SMALL_SCREEN_WIDTH,
  THREAD_DEFAULT_WIDTH,
  SPLITTER_DEFAULT_WIDTH,
  clampThreadWidth,
  restoreThreadWidth,
  persistThreadWidth,
} from "../WKLayout/layoutWidth";
import "./index.css";

/** API 返回的文件数据结构 */
interface ChannelFileResponse {
  message_id: string | number;
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
  onThreadSelect?: (thread: Thread) => void;
  onCreateThread?: () => void;
  /** 文件预览信息，传入时渲染文件预览内容而非子区内容 */
  filePreview?: FilePreviewInfo | null;
  /** 关闭文件预览的回调 */
  onFilePreviewClose?: () => void;
  /** 回复文件消息的回调，传入消息 ID */
  onReplyFile?: (messageId: string) => void;
  /** 切换预览文件的回调（从文件列表选择其他文件时触发） */
  onFilePreviewChange?: (file: FilePreviewInfo) => void;
}

interface ThreadPanelComponentState {
  view: "detail" | "list";
  activeExpanded: boolean;
  archivedExpanded: boolean;
  vmState: ThreadPanelState;
  threads: Thread[];
  threadsLoading: boolean;
  showMoreMenu: boolean;
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
  /** 文件列表是否加载中 */
  conversationFilesLoading: boolean;
  /** 文件列表当前页码 */
  conversationFilesPage: number;
  /** 文件列表是否还有更多 */
  conversationFilesHasMore: boolean;
}

export default class ThreadPanel extends Component<
  ThreadPanelProps,
  ThreadPanelComponentState
> {
  private vm: ThreadPanelVM | null = null;
  private panelRef = React.createRef<HTMLDivElement>();
  private dragStartX = 0;
  private dragStartWidth = 0;
  private lastPanelWidth = THREAD_DEFAULT_WIDTH;
  private cachedWindowWidth = 1920; // cached on drag start
  private cachedLeftPanelWidth = 300; // cached on drag start

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
      panelWidth: savedWidth,
      isDragging: false,
      fileViewMode: "preview",
      isTocOpen: false,
      isTocAvailable: false,
      conversationFiles: [],
      isFilePanelOpen: false,
      conversationFilesLoading: false,
      conversationFilesPage: 1,
      conversationFilesHasMore: false,
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
  }

  componentWillUnmount() {
    document.removeEventListener("mousemove", this.onPanelDragMove);
    document.removeEventListener("mouseup", this.onPanelDragEnd);
    if (this.state.isDragging) {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
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
      if (this.props.thread !== prevProps.thread) {
        if (this.props.thread) {
          this.setState({ view: "detail" });
          this.initVM(this.props.thread.short_id);
        } else {
          this.setState({ view: "list" });
        }
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
    const channelId = filePreview.sourceChannelId || groupNo || "";
    const channelType =
      filePreview.sourceChannelType ??
      (groupNo ? ChannelTypeGroup : ChannelTypePerson);

    if (!channelId) {
      console.warn("[ThreadPanel] getFileChannelInfo: no channelId available");
      return null;
    }

    return { channelId, channelType };
  }

  /** 将 API 返回的文件数据转换为 ConversationFile */
  private mapFileToConversationFile(f: ChannelFileResponse): ConversationFile {
    return {
      id: String(f.message_id),
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
    const {
      conversationFilesLoading,
      conversationFilesHasMore,
      conversationFilesPage,
    } = this.state;

    // 如果正在加载或没有更多数据，直接返回
    if (conversationFilesLoading || !conversationFilesHasMore) return;

    const channelInfo = this.getFileChannelInfo();
    if (!channelInfo) return;

    this.setState({ conversationFilesLoading: true });
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
        conversationFilesLoading: false,
        conversationFilesPage: resp.page,
        conversationFilesHasMore: resp.has_more,
      }));
    } catch (err) {
      console.error("[ThreadPanel] loadMoreConversationFiles failed:", err);
      this.setState({ conversationFilesLoading: false });
    }
  };

  private async loadThreads() {
    const { groupNo } = this.props;
    // 纯文件预览模式时跳过
    if (!groupNo) return;

    this.setState({ threadsLoading: true });
    try {
      const threads = await WKApp.dataSource.channelDataSource.threadList(
        groupNo,
        {
          page_index: 1,
          page_size: 100,
        }
      );
      // 按活跃时间倒序排序
      threads.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      this.setState({ threads, threadsLoading: false });
    } catch {
      this.setState({ threadsLoading: false });
    }
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
    this.setState({ view: "list" });
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
      Toast.error("打开失败，请重试");
    }
  };

  private canEditThread(thread: Thread): boolean {
    const isCreator = thread.creator_uid === WKApp.loginInfo.uid;
    const groupChannel = new Channel(this.props.groupNo, ChannelTypeGroup);
    const subscribers =
      WKSDK.shared().channelManager.getSubscribes(groupChannel);
    const me = subscribers?.find((s) => s.uid === WKApp.loginInfo.uid);
    const isManagerOrOwner =
      me?.role === GroupRole.owner || me?.role === GroupRole.manager;
    return isCreator || isManagerOrOwner;
  }

  private handleEditThread = () => {
    const { vmState } = this.state;
    const thread = vmState.thread;
    if (!thread) return;
    this.setState({ showMoreMenu: false });

    // 延迟弹窗，等 Popover 完全关闭后再触发，避免 Modal 被 Popover 关闭事件误关
    setTimeout(() => {
      let newName = thread.name;
      Modal.confirm({
        title: "编辑子区名称",
        icon: null,
        okText: "保存",
        cancelText: "取消",
        content: (
          <div>
            <input
              type="text"
              defaultValue={thread.name}
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "var(--wk-bg-base)",
                border: "1px solid var(--wk-border-default)",
                borderRadius: "6px",
                fontSize: "14px",
                color: "var(--wk-text-primary)",
                outline: "none",
                boxSizing: "border-box",
              }}
              onChange={(e) => {
                newName = e.target.value;
              }}
              autoFocus
            />
          </div>
        ),
        onOk: async () => {
          if (!newName || newName.trim() === "") {
            Toast.error("子区名称不能为空");
            return;
          }
          try {
            await WKApp.dataSource.channelDataSource.threadUpdate(
              this.props.groupNo,
              thread.short_id,
              { name: newName.trim() }
            );
            Toast.success("修改成功");
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
            const threadChannel = new Channel(
              buildThreadChannelId(this.props.groupNo, thread.short_id),
              ChannelTypeCommunityTopic
            );
            WKSDK.shared().channelManager.deleteChannelInfo(threadChannel);
            WKSDK.shared().channelManager.fetchChannelInfo(threadChannel);
          } catch {
            Toast.error("保存失败，请重试");
          }
        },
      });
    }, 100);
  };

  private handleDeleteThread = () => {
    const { vmState } = this.state;
    const thread = vmState.thread;
    if (!thread) return;
    this.setState({ showMoreMenu: false });

    setTimeout(() => {
      Modal.confirm({
        title: `删除子区「${thread.name}」？`,
        icon: null,
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        content: "删除后子区内所有消息将不可见，此操作不可恢复。",
        onOk: async () => {
          try {
            await WKApp.dataSource.channelDataSource.threadDelete(
              this.props.groupNo,
              thread.short_id
            );
            Toast.success("子区已删除");
            this.handleBackToList();
            this.loadThreads();
          } catch {
            Toast.error("删除失败，请重试");
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

    let threadName = "";
    Modal.confirm({
      title: "创建子区",
      icon: null,
      okText: "创建",
      cancelText: "取消",
      content: (
        <div>
          <div
            style={{
              marginBottom: "8px",
              fontSize: "14px",
              color: "var(--wk-text-secondary)",
            }}
          >
            话题名称
          </div>
          <input
            type="text"
            placeholder="输入讨论话题..."
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--wk-bg-base)",
              border: "1px solid var(--wk-border-default)",
              borderRadius: "6px",
              fontSize: "14px",
              color: "var(--wk-text-primary)",
              outline: "none",
              boxSizing: "border-box",
            }}
            onChange={(e) => {
              threadName = e.target.value;
            }}
            autoFocus
          />
        </div>
      ),
      onOk: async () => {
        if (!threadName || threadName.trim() === "") {
          Toast.error("话题名称不能为空");
          return;
        }
        try {
          await WKApp.dataSource.channelDataSource.threadCreate(
            groupNo,
            threadName.trim()
          );
          Toast.success("子区创建成功");
          this.loadThreads();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "创建失败";
          Toast.error(msg);
        }
      },
    });
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
    // 构造 FilePreviewInfo 并调用回调
    const newPreview: FilePreviewInfo = {
      url: file.url,
      name: file.name,
      extension: file.extension,
      size: file.size,
      sourceChannelId: filePreview?.sourceChannelId,
      sourceChannelType: filePreview?.sourceChannelType,
      messageId: file.id, // ConversationFile.id 就是 message_id
      category: file.category,
    };
    onFilePreviewChange(newPreview);
  };

  private renderHeader() {
    const { onClose, filePreview, onFilePreviewClose } = this.props;
    const { view, vmState, showMoreMenu, fileViewMode, isTocOpen } = this.state;
    const thread = vmState.thread;

    // 文件预览模式：使用 FilePreviewHeader 组件
    if (filePreview) {
      // 判断是否有子区可返回（groupNo 存在表示是从群聊的子区面板进入的）
      const canReturnToThread = !!this.props.groupNo;

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

      // 回复回调：仅当有 messageId 和 onReplyFile 时才启用
      const handleReply =
        filePreview.messageId && this.props.onReplyFile
          ? () => this.props.onReplyFile!(filePreview.messageId!)
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
          loadingMoreFiles={this.state.conversationFilesLoading}
          onLoadMoreFiles={this.loadMoreConversationFiles}
        />
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
            title="返回全部子区"
          >
            <ArrowLeft size={16} />
          </div>
        ) : null}

        <div className="wk-thread-panel-header-title">
          {view === "list" ? (
            <>
              <ThreadIcon className="wk-thread-panel-header-icon" size={18} />
              <span>子区</span>
            </>
          ) : (
            <>
              <ThreadIcon className="wk-thread-panel-header-icon" size={18} />
              <span>{thread?.name || "子区"}</span>
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
                      在完整视图打开
                    </div>
                  )}
                  {vmState.thread && this.canEditThread(vmState.thread) && (
                    <div
                      className="wk-thread-more-menu-item"
                      onClick={this.handleEditThread}
                    >
                      编辑子区名称
                    </div>
                  )}
                  <div
                    className="wk-thread-more-menu-item wk-thread-more-menu-item-danger"
                    onClick={this.handleDeleteThread}
                  >
                    删除子区
                  </div>
                </div>
              }
            >
              <div className="wk-thread-panel-header-btn" title="更多操作">
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
    const { threads, threadsLoading, activeExpanded, archivedExpanded } =
      this.state;

    const activeThreads = threads.filter(
      (t) => t.status === ThreadStatus.Active
    );
    const archivedThreads = threads.filter(
      (t) => t.status === ThreadStatus.Archived
    );

    return (
      <div className="wk-thread-panel-list-view">
        {/* 新建子区按钮 */}
        <div
          className="wk-thread-panel-create-btn"
          onClick={this.handleCreateThread}
        >
          <Plus size={16} />
          <span>新建子区</span>
        </div>

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
                <span>活跃中</span>
              </div>
              {activeExpanded && (
                <div className="wk-thread-panel-group-list">
                  {activeThreads.length === 0 ? (
                    <div className="wk-thread-panel-empty">暂无活跃子区</div>
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
                  <span>已归档</span>
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
      </div>
    );
  }

  private getCreatorName(thread: Thread): string {
    if (thread.creator_name) {
      return thread.creator_name;
    }
    if (thread.creator_uid) {
      const channelInfo = WKSDK.shared().channelManager.getChannelInfo(
        new Channel(thread.creator_uid, ChannelTypePerson)
      );
      return channelInfo?.title || thread.creator_uid;
    }
    return "未知";
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
          <span className="wk-thread-panel-item-time">
            {formatRelativeTime(thread.updated_at)}
          </span>
        </div>
        <div className="wk-thread-panel-item-meta">
          {thread.message_count || 0} 条回复 · 参与 {thread.member_count || 0}{" "}
          人 · {creatorName} 发起
        </div>
        {thread.last_message_content && (
          <div className="wk-thread-panel-item-preview">
            {thread.last_message_sender_name}: {thread.last_message_content}
          </div>
        )}
        {!thread.last_message_content && (
          <div className="wk-thread-panel-item-preview wk-thread-panel-item-preview-empty">
            暂无消息
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
      return <div className="wk-thread-panel-empty">未找到子区</div>;
    }

    // 使用 Thread 的 channel_id 创建 Channel 对象
    const threadChannel = new Channel(
      thread.channel_id,
      ChannelTypeCommunityTopic
    );

    return (
      <div className="wk-thread-panel-conversation">
        <ErrorBoundary moduleName="子区消息">
          <Conversation
            key={thread.channel_id}
            channel={threadChannel}
            shouldShowHistorySplit={false}
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

  render() {
    const { filePreview } = this.props;
    const { view, panelWidth, isDragging, isFilePanelOpen, conversationFiles } =
      this.state;
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
                loadingMore={this.state.conversationFilesLoading}
                onLoadMore={this.loadMoreConversationFiles}
              />
            )}
            {/* 文件预览内容 */}
            {this.renderFilePreviewContent()}
          </div>
        ) : view === "list" ? (
          this.renderListView()
        ) : (
          this.renderDetailView()
        )}
        {isDragging && <div className="wk-thread-panel-drag-overlay" />}
      </div>
    );
  }
}
