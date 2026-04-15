import React, { Component, ReactNode } from "react";
import { Conversation } from "../../Components/Conversation";
import ConversationList, {
  ConvFilter,
} from "../../Components/ConversationList";
import ConversationListGrouped from "../../Components/ConversationListGrouped";
import ChatConversationList from "../../Components/ChatConversationList";
import Provider from "../../Service/Provider";
import { ErrorBoundary } from "../../Components/ErrorBoundary";

import { Spin, Popover, Modal, Toast } from "@douyinfe/semi-ui";
import WKButton from "../../Components/WKButton";
import WKModal from "../../Components/WKModal";
import { Search, Plus } from "lucide-react";
import ThreadIcon from "../../Components/Icons/ThreadIcon";
import { ChatVM, handleGlobalSearchClick } from "./vm";
import "./index.css";
import { ConversationWrap } from "../../Service/Model";
import WKApp, { ThemeMode } from "../../App";
import ChannelSetting from "../../Components/ChannelSetting";
import classNames from "classnames";
import { Channel, ChannelInfo, ChannelTypeGroup, WKSDK } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { ChannelInfoListener } from "wukongimjssdk";
import { ChatMenus } from "../../App";
import ConversationContext from "../../Components/Conversation/context";
import GlobalSearch from "../../Components/GlobalSearch";
import { ShowConversationOptions } from "../../EndpointCommon";
import SpaceList from "../../Components/SpaceList";
import SpaceCreate from "../../Components/SpaceCreate";
import { Space } from "../../Service/SpaceService";
import NavSignalBadge from "../../Components/NavRail/NavSignalBadge";
import ThreadPanel from "../../Components/ThreadPanel";
import {
  Thread,
  parseThreadChannelId,
  buildThreadStub,
} from "../../Service/Thread";
import FilePreviewPanel, {
  FilePreviewInfo,
} from "../../Components/FilePreviewPanel";

export interface ChatContentPageProps {
  channel: Channel;
  initLocateMessageSeq?: number; // 打开时定位到某条消息
}

export interface ChatContentPageState {
  showChannelSetting: boolean;
  selectionMode: boolean;
  selectedCount: number;
  showThreadPanel: boolean;
  activeThread: Thread | null;
  showThreadDropdown: boolean;
  previewFile: FilePreviewInfo | null;
}
export class ChatContentPage extends Component<
  ChatContentPageProps,
  ChatContentPageState
> {
  channelInfoListener!: ChannelInfoListener;
  conversationContext!: ConversationContext;
  private parentGroupChannel?: Channel;

  constructor(props: any) {
    super(props);
    this.state = {
      showChannelSetting: false,
      selectionMode: false,
      selectedCount: 0,
      showThreadPanel: false,
      activeThread: null,
      showThreadDropdown: false,
      previewFile: null,
    };
  }

  componentDidMount() {
    const { channel } = this.props;
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

    // 注册 pending-thread 事件监听（当前频道已打开时直接导航到子区）
    this._onPendingThread = (detail: {
      groupNo: string;
      thread: Thread | null;
    }) => {
      if (detail?.groupNo === this.props.channel.channelID) {
        this.setState({
          showThreadPanel: true,
          showChannelSetting: false,
          activeThread: detail.thread || null,
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

    // 注册文件预览事件监听
    this._onFilePreview = (file: FilePreviewInfo | null) => {
      this.setState({
        previewFile: file,
        showChannelSetting: false,
        showThreadPanel: false,
      });
    };
    WKApp.mittBus.on("wk:file-preview", this._onFilePreview);

    // 检查是否需要自动打开子区面板（查看全部子区）
    if (WKApp.shared.pendingThreadPanel === channel.channelID) {
      this.setState({ showThreadPanel: true, activeThread: null });
      WKApp.shared.pendingThreadPanel = undefined;
    }

    // 检查是否需要打开具体某个子区
    const pt = WKApp.shared.pendingThread;
    if (pt && pt.groupNo === channel.channelID) {
      WKApp.shared.pendingThread = undefined;
      this.setState({
        showThreadPanel: true,
        showChannelSetting: false,
        activeThread: buildThreadStub(
          pt.shortId,
          pt.groupNo,
          pt.channelId,
          pt.name
        ),
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

    // 切换频道时消费 pendingThread / pendingThreadPanel
    if (channel.channelID !== prevProps.channel.channelID) {
      // 导航到特定子区
      const pt = WKApp.shared.pendingThread;
      if (pt && pt.groupNo === channel.channelID) {
        WKApp.shared.pendingThread = undefined;
        this.setState({
          showThreadPanel: true,
          showChannelSetting: false,
          activeThread: buildThreadStub(
            pt.shortId,
            pt.groupNo,
            pt.channelId,
            pt.name
          ),
        });
        return;
      }
      // 打开全部子区列表
      if (WKApp.shared.pendingThreadPanel === channel.channelID) {
        WKApp.shared.pendingThreadPanel = undefined;
        this.setState({
          showThreadPanel: true,
          activeThread: null,
          showChannelSetting: false,
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
  private _onFilePreview?: (file: FilePreviewInfo | null) => void;

  componentWillUnmount() {
    if (this._onPendingThread) {
      WKApp.mittBus.off("wk:pending-thread", this._onPendingThread);
    }
    if (this._onCloseThreadPanel) {
      WKApp.mittBus.off("wk:close-thread-panel", this._onCloseThreadPanel);
    }
    if (this._onFilePreview) {
      WKApp.mittBus.off("wk:file-preview", this._onFilePreview);
    }
    WKSDK.shared().channelManager.removeListener(this.channelInfoListener);
  }

  render(): React.ReactNode {
    const { channel, initLocateMessageSeq } = this.props;
    const {
      showChannelSetting,
      selectionMode,
      selectedCount,
      showThreadPanel,
      activeThread,
      showThreadDropdown,
      previewFile,
    } = this.state;
    // 子区页面不显示讨论串按钮
    const isThreadChannel = channel.channelType === ChannelTypeCommunityTopic;
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
    if (!channelInfo) {
      WKSDK.shared().channelManager.fetchChannelInfo(channel);
    }
    return (
      <div
        className={classNames(
          "wk-chat-content-right",
          showChannelSetting ? "wk-chat-channelsetting-open" : "",
          showThreadPanel ? "wk-chat-threadpanel-open" : "",
          previewFile ? "wk-chat-filepreview-open" : ""
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
            onClick={() => {
              if (selectionMode) {
                return;
              }
              this.setState({
                showChannelSetting: !this.state.showChannelSetting,
              });
            }}
          >
            <div className="wk-chat-conversation-header-content">
              <div className="wk-chat-conversation-header-left">
                {selectionMode ? (
                  <div className="wk-chat-conversation-selection-header">
                    <div className="wk-chat-conversation-selection-title">
                      已选择 {selectedCount} 条消息
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
                        <img
                          alt=""
                          src={WKApp.shared.avatarChannel(channel)}
                        ></img>
                      </div>
                      <div className="wk-chat-conversation-header-channel-info">
                        <div className="wk-chat-conversation-header-channel-info-name">
                          {channel.channelType === ChannelTypeCommunityTopic &&
                          channelInfo?.orgData?.parentGroupNo ? (
                            <>
                              <span className="wk-chat-conversation-header-parent-group">
                                {WKSDK.shared().channelManager.getChannelInfo(
                                  new Channel(
                                    channelInfo.orgData.parentGroupNo,
                                    ChannelTypeGroup
                                  )
                                )?.title || channelInfo.orgData.parentGroupNo}
                              </span>
                              <span className="wk-chat-conversation-header-separator">
                                &gt;
                              </span>
                              <span>{channelInfo?.orgData?.displayName}</span>
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
                    取消
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
                          >
                            {item}
                          </div>
                        );
                      })}
                    {/* 子区按钮 - 下拉菜单（新建子区 / 查看全部子区） */}
                    {!isThreadChannel &&
                      channel.channelType === ChannelTypeGroup &&
                      WKApp.remoteConfig.threadOn && (
                        <Popover
                          visible={showThreadDropdown}
                          onVisibleChange={(v) =>
                            this.setState({ showThreadDropdown: v })
                          }
                          trigger="click"
                          position="bottomRight"
                          showArrow={false}
                          content={
                            <div className="wk-thread-dropdown">
                              <div
                                className="wk-thread-dropdown-item"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  this.setState({ showThreadDropdown: false });
                                  const groupNo = channel.channelID;
                                  let threadName = "";
                                  Modal.confirm({
                                    title: "新建子区",
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
                                            border:
                                              "1px solid var(--wk-border-default)",
                                            borderRadius: "6px",
                                            fontSize: "14px",
                                            color: "var(--wk-text-primary)",
                                            outline: "none",
                                            boxSizing: "border-box" as const,
                                          }}
                                          onChange={(ev) => {
                                            threadName = ev.target.value;
                                          }}
                                          autoFocus
                                        />
                                      </div>
                                    ),
                                    onOk: async () => {
                                      if (
                                        !threadName ||
                                        threadName.trim() === ""
                                      ) {
                                        Toast.error("话题名称不能为空");
                                        return;
                                      }
                                      try {
                                        await WKApp.dataSource.channelDataSource.threadCreate(
                                          groupNo,
                                          threadName.trim()
                                        );
                                        Toast.success("子区创建成功");
                                      } catch (err) {
                                        const msg =
                                          err instanceof Error
                                            ? err.message
                                            : "创建失败";
                                        Toast.error(msg);
                                      }
                                    },
                                  });
                                }}
                              >
                                新建子区
                              </div>
                              <div
                                className="wk-thread-dropdown-item"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  this.setState({
                                    showThreadDropdown: false,
                                    showThreadPanel: true,
                                    activeThread: null,
                                    showChannelSetting: false,
                                  });
                                }}
                              >
                                查看全部子区
                              </div>
                            </div>
                          }
                        >
                          <div
                            className="wk-chat-conversation-header-right-item"
                            onClick={(e) => e.stopPropagation()}
                            title="子区"
                          >
                            <ThreadIcon
                              size={20}
                              color={WKApp.config.themeColor}
                            />
                          </div>
                        </Popover>
                      )}
                    <div className="wk-chat-conversation-header-right-item">
                      <svg
                        fill={WKApp.config.themeColor}
                        height="28px"
                        role="presentation"
                        viewBox="0 0 36 36"
                        width="28px"
                      >
                        <path
                          clipRule="evenodd"
                          d="M18 29C24.0751 29 29 24.0751 29 18C29 11.9249 24.0751 7 18 7C11.9249 7 7 11.9249 7 18C7 24.0751 11.9249 29 18 29ZM19.5 18C19.5 18.8284 18.8284 19.5 18 19.5C17.1716 19.5 16.5 18.8284 16.5 18C16.5 17.1716 17.1716 16.5 18 16.5C18.8284 16.5 19.5 17.1716 19.5 18ZM23 19.5C23.8284 19.5 24.5 18.8284 24.5 18C24.5 17.1716 23.8284 16.5 23 16.5C22.1716 16.5 21.5 17.1716 21.5 18C21.5 18.8284 22.1716 19.5 23 19.5ZM14.5 18C14.5 18.8284 13.8284 19.5 13 19.5C12.1716 19.5 11.5 18.8284 11.5 18C11.5 17.1716 12.1716 16.5 13 16.5C13.8284 16.5 14.5 17.1716 14.5 18Z"
                          fillRule="evenodd"
                        ></path>
                      </svg>
                      <div className="wk-conversation-header-mask"></div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="wk-chat-conversation">
            <ErrorBoundary moduleName="聊天">
              <Conversation
                initLocateMessageSeq={initLocateMessageSeq}
                shouldShowHistorySplit={true}
                onContext={(ctx) => {
                  this.conversationContext = ctx;
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
                      showChannelSetting: false,
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
              ></Conversation>
            </ErrorBoundary>
          </div>
        </div>

        <div className={classNames("wk-chat-channelsetting")}>
          <ErrorBoundary moduleName="频道设置">
            <ChannelSetting
              conversationContext={this.conversationContext}
              key={channel.getChannelKey()}
              channel={channel}
              onClose={() => {
                this.setState({
                  showChannelSetting: false,
                });
              }}
            ></ChannelSetting>
          </ErrorBoundary>
        </div>

        {/* 子区面板 - 仅群组且开启子区功能且打开时渲染 */}
        {!isThreadChannel &&
          channel.channelType === ChannelTypeGroup &&
          WKApp.remoteConfig.threadOn &&
          showThreadPanel && (
            <ThreadPanel
              groupNo={channel.channelID}
              thread={activeThread}
              onClose={() => {
                this.setState({ showThreadPanel: false, activeThread: null });
              }}
              onThreadSelect={(thread) => {
                this.setState({ activeThread: thread });
              }}
            />
          )}

        {/* 文件预览面板 */}
        {previewFile && (
          <FilePreviewPanel
            key={previewFile.url}
            file={previewFile}
            onClose={() => {
              this.setState({ previewFile: null });
            }}
          />
        )}
      </div>
    );
  }
}

interface ChatPageState {
  filter: ConvFilter;
  dropdownOpen: boolean;
  pendingConfirm: null | { onOk: () => void }; // 附件切换确认弹窗
}

const FILTER_OPTIONS: { key: ConvFilter; label: string; icon: ReactNode }[] = [
  {
    key: "all",
    label: "全部会话",
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    key: "group",
    label: "群聊",
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: "ai",
    label: "AI",
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    key: "human",
    label: "人类",
    icon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export default class ChatPage extends Component<any, ChatPageState> {
  vm!: ChatVM;
  spaceListRef: SpaceList | null = null;
  constructor(props: any) {
    super(props);
    this.state = { filter: "all", dropdownOpen: false, pendingConfirm: null };
  }

  componentDidMount() {
    document.addEventListener("click", this._handleDocClick);
  }

  componentWillUnmount() {
    document.removeEventListener("click", this._handleDocClick);
  }

  _handleDocClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".wk-chat-title-dropdown")) {
      this.setState({ dropdownOpen: false });
    }
  };

  render(): ReactNode {
    return (
      <Provider
        create={() => {
          this.vm = new ChatVM();
          return this.vm;
        }}
        render={(vm: ChatVM) => {
          const { filter, dropdownOpen } = this.state;
          const activeOption = FILTER_OPTIONS.find((o) => o.key === filter)!;
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
                    {/* 标题下拉菜单 */}
                    <div className="wk-chat-title-dropdown">
                      <button
                        className={classNames(
                          "wk-chat-title-btn",
                          dropdownOpen ? "wk-chat-title-btn-open" : undefined
                        )}
                        onClick={() =>
                          this.setState((s) => ({
                            dropdownOpen: !s.dropdownOpen,
                          }))
                        }
                      >
                        {activeOption.label}
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {dropdownOpen && (
                        <div className="wk-chat-title-menu">
                          {FILTER_OPTIONS.map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              tabIndex={0}
                              className={classNames(
                                "wk-chat-title-option",
                                filter === opt.key
                                  ? "wk-chat-title-option-active"
                                  : undefined
                              )}
                              onClick={() =>
                                this.setState({
                                  filter: opt.key,
                                  dropdownOpen: false,
                                })
                              }
                            >
                              <span className="wk-chat-title-option-icon">
                                {opt.icon}
                              </span>
                              <span>{opt.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="wk-chat-header-actions">
                      <NavSignalBadge showText />
                      <div
                        className="wk-chat-header-btn"
                        onClick={() => {
                          vm.showGlobalSearch = true;
                        }}
                      >
                        <Search size={16} />
                      </div>
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
                          <ChatMenusPopover
                            onItem={() => {
                              vm.showAddPopover = false;
                            }}
                          />
                        }
                      >
                        <div
                          className="wk-chat-header-btn"
                          onClick={() => {
                            vm.showAddPopover = !vm.showAddPopover;
                          }}
                        >
                          <Plus size={16} />
                        </div>
                      </Popover>
                    </div>
                  </div>
                  {/* SpaceList 已移至侧边栏 */}
                  <div className="wk-chat-conversation-list">
                    {vm.loading ? (
                      <div className="wk-chat-conversation-list-loading">
                        <Spin style={{ marginTop: "20px" }} />
                      </div>
                    ) : vm.filteredConversations.length === 0 ? (
                      <div className="wk-chat-empty-guide">
                        <div style={{ fontSize: 28, marginBottom: 12 }}>💬</div>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 600,
                            marginBottom: 6,
                          }}
                        >
                          还没有会话
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: "#999",
                            marginBottom: 24,
                          }}
                        >
                          从通讯录选择联系人开始聊天
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
                                "找人聊天"
                              );
                            }}
                          >
                            找人聊天
                          </button>
                          <button
                            className="wk-chat-empty-guide-btn"
                            onClick={() => {
                              const menus = WKApp.shared.chatMenus();
                              const groupMenu = menus.find(
                                (m) => m.title === "发起群聊"
                              );
                              if (groupMenu?.onClick) groupMenu.onClick();
                            }}
                          >
                            创建群聊
                          </button>
                        </div>
                      </div>
                    ) : (
                      <ErrorBoundary moduleName="会话列表">
                        <ChatConversationList
                          conversations={vm.filteredConversations}
                          filter={filter}
                          select={WKApp.shared.openChannel}
                          onConversationClick={(
                            conversation: ConversationWrap
                          ) => {
                            const doSwitch = () => {
                              // 子区：跳转到父群聊 + 打开 ThreadPanel 定位到该子区
                              if (
                                conversation.channel.channelType ===
                                ChannelTypeCommunityTopic
                              ) {
                                const parsed = parseThreadChannelId(
                                  conversation.channel.channelID
                                );
                                const parentGroupNo =
                                  conversation.channelInfo?.orgData
                                    ?.parentGroupNo || parsed?.groupNo;
                                if (parentGroupNo) {
                                  const thread = buildThreadStub(
                                    parsed?.shortId || "",
                                    parentGroupNo,
                                    conversation.channel.channelID,
                                    conversation.channelInfo?.orgData
                                      ?.displayName ||
                                      parsed?.shortId ||
                                      ""
                                  );
                                  // 通过 mittBus 通知当前已打开的 ChatContentPage 导航到子区
                                  WKApp.mittBus.emit("wk:pending-thread", {
                                    groupNo: parentGroupNo,
                                    thread,
                                  });
                                  // 若当前不是父群聊，切换频道
                                  if (
                                    this.props.channel?.channelID !==
                                    parentGroupNo
                                  ) {
                                    const parentChannel = new Channel(
                                      parentGroupNo,
                                      ChannelTypeGroup
                                    );
                                    WKApp.shared.pendingThread = {
                                      groupNo: parentGroupNo,
                                      channelId: conversation.channel.channelID,
                                      name:
                                        conversation.channelInfo?.orgData
                                          ?.displayName ||
                                        parsed?.shortId ||
                                        "",
                                      shortId: parsed?.shortId || "",
                                    };
                                    const parentConv =
                                      vm.filteredConversations.find(
                                        (c) =>
                                          c.channel.channelType ===
                                            ChannelTypeGroup &&
                                          c.channel.channelID === parentGroupNo
                                      );
                                    if (parentConv) {
                                      vm.selectedConversation = parentConv;
                                      vm.notifyListener();
                                    }
                                    WKApp.endpoints.showConversation(
                                      parentChannel
                                    );
                                  }
                                  return;
                                }
                              }
                              // 普通会话：关闭子区面板
                              WKApp.mittBus.emit(
                                "wk:close-thread-panel",
                                undefined
                              );
                              vm.selectedConversation = conversation;
                              WKApp.endpoints.showConversation(
                                conversation.channel
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
                          onClearMessages={this.vm.clearMessages.bind(this.vm)}
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
                                  c.channel.channelType === ChannelTypeGroup &&
                                  c.channel.channelID === groupNo
                              );
                              if (groupConv) {
                                vm.selectedConversation = groupConv;
                                vm.notifyListener();
                              }
                              WKApp.endpoints.showConversation(
                                new Channel(groupNo, ChannelTypeGroup)
                              );
                            }
                          }}
                        />
                      </ErrorBoundary>
                    )}
                  </div>
                </div>
              </div>
              <SpaceCreate
                visible={vm.showSpaceCreate}
                onClose={() => {
                  vm.showSpaceCreate = false;
                }}
                onSuccess={() => {
                  this.spaceListRef?.loadSpaces();
                }}
              />
              <WKModal
                size="full"
                visible={vm.showGlobalSearch}
                onCancel={() => {
                  vm.showGlobalSearch = false;
                }}
              >
                <div style={{ marginTop: "30px" }}>
                  <ErrorBoundary moduleName="搜索">
                    <GlobalSearch
                      onClick={(item, type: string) => {
                        void handleGlobalSearchClick(item, type, () => {
                          vm.showGlobalSearch = false;
                        });
                      }}
                    />
                  </ErrorBoundary>
                </div>
              </WKModal>

              {/* 附件未发送切换会话确认弹窗 */}
              <WKModal
                visible={!!this.state.pendingConfirm}
                title="有未发送的附件"
                footer={
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "var(--wk-sp-2)",
                    }}
                  >
                    <WKButton
                      variant="secondary"
                      onClick={() => this.setState({ pendingConfirm: null })}
                    >
                      取消
                    </WKButton>
                    <WKButton
                      variant="primary"
                      onClick={() => {
                        this.state.pendingConfirm?.onOk();
                        this.setState({ pendingConfirm: null });
                      }}
                    >
                      继续切换
                    </WKButton>
                  </div>
                }
                onCancel={() => this.setState({ pendingConfirm: null })}
                options={{ closable: false }}
              >
                <p
                  style={{
                    margin: 0,
                    color: "var(--wk-text-secondary)",
                    fontSize: "var(--wk-text-size-md)",
                  }}
                >
                  切换会话后，未发送的附件将被丢弃，是否继续？
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
