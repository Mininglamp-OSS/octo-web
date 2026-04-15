import React, { Component, ReactNode } from "react";
import { Conversation } from "../../Components/Conversation";
import ConversationList, { ConvFilter } from "../../Components/ConversationList";
import SidebarTabBar, { SidebarTab } from "../../Components/SidebarTabBar";
import ConversationListGrouped from "../../Components/ConversationListGrouped";
import ChatConversationList from "../../Components/ChatConversationList";
import Provider from "../../Service/Provider";
import { ErrorBoundary } from "../../Components/ErrorBoundary";

import { Spin, Popover, Modal, Toast } from "@douyinfe/semi-ui";
import WKButton from "../../Components/WKButton";
import WKModal from "../../Components/WKModal";
import { Search, Plus, Columns2 } from "lucide-react";
import ThreadIcon from "../../Components/Icons/ThreadIcon";
import HashIcon from "../../Components/Icons/HashIcon";
import { ChatVM, handleGlobalSearchClick } from "./vm";
import "./index.css";
import { ConversationWrap } from "../../Service/Model";
import WKApp, { ThemeMode } from "../../App";
import ChannelSetting from "../../Components/ChannelSetting";
import classNames from "classnames";
import { Channel, ChannelInfo, ChannelTypeGroup, ChannelTypePerson, WKSDK } from "wukongimjssdk";
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
import { Thread, parseThreadChannelId, buildThreadStub } from "../../Service/Thread";

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
    };
  }

  componentDidMount() {
    const { channel } = this.props;
    this.channelInfoListener = (channelInfo: ChannelInfo) => {
      // 监听当前频道或父群组的变化
      if (
        channelInfo.channel.isEqual(channel) ||
        (this.parentGroupChannel && channelInfo.channel.isEqual(this.parentGroupChannel))
      ) {
        this.setState({});
      }
    };
    WKSDK.shared().channelManager.addListener(this.channelInfoListener);

    // 注册 pending-thread 事件监听（当前频道已打开时直接导航到子区）
    this._onPendingThread = (detail: { groupNo: string; thread: Thread | null }) => {
      if (detail?.groupNo === this.props.channel.channelID) {
        this.setState({
          showThreadPanel: true,
          showChannelSetting: false,
          activeThread: detail.thread || null,
        })
      }
    }
    WKApp.mittBus.on('wk:pending-thread', this._onPendingThread)

    // 注册关闭子区面板事件监听
    this._onCloseThreadPanel = () => {
      if (this.state.showThreadPanel) {
        this.setState({ showThreadPanel: false, activeThread: null })
      }
    }
    WKApp.mittBus.on('wk:close-thread-panel', this._onCloseThreadPanel)

    // 检查是否需要自动打开子区面板（查看全部子区）
    if (WKApp.shared.pendingThreadPanel === channel.channelID) {
      this.setState({ showThreadPanel: true, activeThread: null });
      WKApp.shared.pendingThreadPanel = undefined;
    }

    // 子区：预先获取父群组信息
    if (channel.channelType === ChannelTypeCommunityTopic) {
      const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
      const parentGroupNo = channelInfo?.orgData?.parentGroupNo;
      if (parentGroupNo) {
        this.parentGroupChannel = new Channel(parentGroupNo, ChannelTypeGroup);
        if (!WKSDK.shared().channelManager.getChannelInfo(this.parentGroupChannel)) {
          WKSDK.shared().channelManager.fetchChannelInfo(this.parentGroupChannel);
        }
      }
    }
  }

  componentDidUpdate(prevProps: ChatContentPageProps) {
    const { channel } = this.props;

    // 切换频道时消费 pendingThreadPanel
    if (channel.channelID !== prevProps.channel.channelID) {
      // 打开全部子区列表
      if (WKApp.shared.pendingThreadPanel === channel.channelID) {
        WKApp.shared.pendingThreadPanel = undefined
        this.setState({ showThreadPanel: true, activeThread: null, showChannelSetting: false })
        return
      }
    }

    // 子区 channelInfo 加载后，检查是否需要获取父群组信息
    if (channel.channelType === ChannelTypeCommunityTopic && !this.parentGroupChannel) {
      const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
      const parentGroupNo = channelInfo?.orgData?.parentGroupNo;
      if (parentGroupNo) {
        this.parentGroupChannel = new Channel(parentGroupNo, ChannelTypeGroup);
        if (!WKSDK.shared().channelManager.getChannelInfo(this.parentGroupChannel)) {
          WKSDK.shared().channelManager.fetchChannelInfo(this.parentGroupChannel);
        }
      }
    }
  }

  private _onPendingThread?: (detail: { groupNo: string; thread: Thread | null }) => void
  private _onCloseThreadPanel?: () => void

  componentWillUnmount() {
    if (this._onPendingThread) {
      WKApp.mittBus.off('wk:pending-thread', this._onPendingThread)
    }
    if (this._onCloseThreadPanel) {
      WKApp.mittBus.off('wk:close-thread-panel', this._onCloseThreadPanel)
    }
    WKSDK.shared().channelManager.removeListener(this.channelInfoListener);
  }



  render(): React.ReactNode {
    const { channel, initLocateMessageSeq } = this.props;
    const { showChannelSetting, selectionMode, selectedCount, showThreadPanel, activeThread, showThreadDropdown } = this.state;
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
          showThreadPanel ? "wk-chat-threadpanel-open" : ""
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
                        {channel.channelType === ChannelTypeGroup ? (
                          // 群聊：# icon
                          <div className="wk-chat-conversation-header-channel-hash-icon">
                            <HashIcon size={18} />
                          </div>
                        ) : channel.channelType === ChannelTypeCommunityTopic ? (
                          // 子区：🧵 icon，圆角背景（对齐群聊 hash-icon 样式）
                          <div className="wk-chat-conversation-header-channel-thread-icon">
                            <ThreadIcon size={18} color="var(--wk-text-secondary, #5C6070)" />
                          </div>
                        ) : (
                          // 私聊：头像
                          <img alt="" src={WKApp.shared.avatarChannel(channel)}></img>
                        )}
                      </div>
                      <div className="wk-chat-conversation-header-channel-info">
                        <div className="wk-chat-conversation-header-channel-info-name">
                          {channel.channelType === ChannelTypeCommunityTopic && channelInfo?.orgData?.parentGroupNo ? (
                            <>
                              {/* 面包屑：# 父群组 › 🧵 子区名 */}
                              <span
                                className="wk-chat-conversation-header-parent-group"
                                style={{ cursor: "pointer" }}
                                onClick={() => {
                                  if (this.parentGroupChannel) {
                                    WKApp.endpoints.showConversation(this.parentGroupChannel)
                                  } else {
                                    WKApp.endpoints.showConversation(new Channel(channelInfo.orgData.parentGroupNo, ChannelTypeGroup))
                                  }
                                }}
                              >
                                {WKSDK.shared().channelManager.getChannelInfo(new Channel(channelInfo.orgData.parentGroupNo, ChannelTypeGroup))?.title || channelInfo.orgData.parentGroupNo}
                              </span>
                              <span className="wk-chat-conversation-header-separator">›</span>
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
                    {!isThreadChannel && channel.channelType === ChannelTypeGroup && WKApp.remoteConfig.threadOn && (
                      <Popover
                        visible={showThreadDropdown}
                        onVisibleChange={(v) => this.setState({ showThreadDropdown: v })}
                        trigger="click"
                        position="bottomRight"
                        showArrow={false}
                        content={
                          <div className="wk-thread-dropdown">
                            <div
                              className="wk-thread-dropdown-item"
                              onClick={(e) => {
                                e.stopPropagation()
                                this.setState({ showThreadDropdown: false })
                                const groupNo = channel.channelID
                                let threadName = ""
                                Modal.confirm({
                                  title: "新建子区",
                                  icon: null,
                                  okText: "创建",
                                  cancelText: "取消",
                                  content: (
                                    <div>
                                      <div style={{ marginBottom: "8px", fontSize: "14px", color: "var(--wk-text-secondary)" }}>
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
                                          boxSizing: "border-box" as const,
                                        }}
                                        onChange={(ev) => { threadName = ev.target.value }}
                                        autoFocus
                                      />
                                    </div>
                                  ),
                                  onOk: async () => {
                                    if (!threadName || threadName.trim() === "") {
                                      Toast.error("话题名称不能为空")
                                      return
                                    }
                                    try {
                                      await WKApp.dataSource.channelDataSource.threadCreate(groupNo, threadName.trim())
                                      Toast.success("子区创建成功")
                                    } catch (err) {
                                      const msg = err instanceof Error ? err.message : "创建失败"
                                      Toast.error(msg)
                                    }
                                  },
                                })
                              }}
                            >
                              新建子区
                            </div>
                            <div
                              className="wk-thread-dropdown-item"
                              onClick={(e) => {
                                e.stopPropagation()
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
                          <ThreadIcon size={20} color={WKApp.config.themeColor} />
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
        {!isThreadChannel && channel.channelType === ChannelTypeGroup && WKApp.remoteConfig.threadOn && showThreadPanel && (
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
      </div>
    );
  }
}

const SIDEBAR_TAB_KEY = 'wk_sidebar_active_tab'

function getSavedTab(): SidebarTab {
  try {
    const v = localStorage.getItem(SIDEBAR_TAB_KEY)
    if (v === 'group' || v === 'dm') return v
  } catch {}
  return 'group'
}

interface ChatPageState {
  activeTab: SidebarTab
  currentSpaceName: string
  pendingConfirm: null | { onOk: () => void }  // 附件切换确认弹窗
}

export default class ChatPage extends Component<any, ChatPageState> {
  vm!: ChatVM;
  spaceListRef: SpaceList | null = null;
  openCreateCategoryRef: React.MutableRefObject<(() => void) | null> = { current: null };
  constructor(props: any) {
    super(props);
    this.state = { activeTab: getSavedTab(), currentSpaceName: WKApp.config.appName, pendingConfirm: null }
  }

  _handleTabChange = (tab: SidebarTab) => {
    try { localStorage.setItem(SIDEBAR_TAB_KEY, tab) } catch {}
    this.setState({ activeTab: tab })
  }

  private _onSpaceChanged?: (space: any) => void

  componentDidMount() {
    // 监听 space-changed，同步 spacename 到 state
    this._onSpaceChanged = (space: any) => {
      this.setState({ currentSpaceName: (space as Space | undefined)?.name ?? WKApp.config.appName })
    }
    WKApp.mittBus.on('space-changed', this._onSpaceChanged)

    // 初始化：主动拉当前 Space 名称（首次渲染时 space-changed 还没触发）
    const currentSpaceId = WKApp.shared.currentSpaceId
    if (currentSpaceId) {
      SpaceService.shared.getMySpaces().then(spaces => {
        const space = spaces.find(s => s.space_id === currentSpaceId)
        if (space) {
          this.setState({ currentSpaceName: space.name })
        }
      }).catch(() => {})
    }
  }

  componentWillUnmount() {
    if (this._onSpaceChanged) {
      WKApp.mittBus.off('space-changed', this._onSpaceChanged)
    }
  }

  render(): ReactNode {
    return (
      <Provider
        create={() => {
          this.vm = new ChatVM();
          return this.vm;
        }}
        render={(vm: ChatVM) => {
          const { activeTab } = this.state
          // 计算各 Tab 未读总数
          const groupUnread = vm.conversations.reduce((sum: number, c: ConversationWrap) => {
            if (c.channel.channelType === ChannelTypeGroup || c.channel.channelType === ChannelTypeCommunityTopic) {
              return sum + (c.unread || 0)
            }
            return sum
          }, 0)
          const dmUnread = vm.conversations.reduce((sum: number, c: ConversationWrap) => {
            if (c.channel.channelType === ChannelTypePerson) {
              return sum + (c.unread || 0)
            }
            return sum
          }, 0)
          // filter 用于 ConversationList
          const filter: ConvFilter = activeTab === 'group' ? 'group' : 'dm'
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
                    <div className="wk-chat-space-name">{this.state.currentSpaceName}</div>
                    <div className="wk-chat-header-actions">
                      <NavSignalBadge showText />
                      <div
                        className="wk-chat-header-btn"
                        onClick={() => { vm.showGlobalSearch = true; }}
                      >
                        <Search size={16} />
                      </div>
                      {/* + 按钮：群聊 Tab 额外显示「创建分组」，其余菜单项保持不变 */}
                      <Popover
                        onClickOutSide={() => { vm.showAddPopover = false; }}
                        className="wk-chat-popover"
                        position="bottomRight"
                        visible={vm.showAddPopover}
                        showArrow={false}
                        trigger="custom"
                        content={
                          <div>
                            {/* 群聊 Tab 下在顶部插入「创建分组」，对齐 ChatMenusPopover li 样式 */}
                            {activeTab === 'group' && (
                              <div
                                className="wk-chat-menu-item"
                                onClick={() => {
                                  vm.showAddPopover = false
                                  this.openCreateCategoryRef.current?.()
                                }}
                              >
                                <div className="wk-chatmenuspopover-avatar">
                                  <Columns2 size={16} strokeWidth={1.5} />
                                </div>
                                <div className="wk-chatmenuspopover-title">创建分组</div>
                              </div>
                            )}
                            <ChatMenusPopover onItem={() => { vm.showAddPopover = false; }} />
                          </div>
                        }
                      >
                        <div
                          className="wk-chat-header-btn"
                          onClick={() => { vm.showAddPopover = !vm.showAddPopover; }}
                        >
                          <Plus size={16} />
                        </div>
                      </Popover>
                    </div>
                  </div>
                  {/* 群聊/私聊 Tab Bar */}
                  <SidebarTabBar
                    activeTab={activeTab}
                    groupUnread={groupUnread}
                    dmUnread={dmUnread}
                    onTabChange={this._handleTabChange}
                  />
                  <div className="wk-chat-conversation-list">
                    {vm.loading ? (
                      <div className="wk-chat-conversation-list-loading">
                        <Spin style={{ marginTop: "20px" }} />
                      </div>
                    ) : vm.filteredConversations.length === 0 ? (
                      <div className="wk-chat-empty-guide">
                        <div style={{ fontSize: 28, marginBottom: 12 }}>💬</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>还没有会话</div>
                        <div style={{ fontSize: 13, color: '#999', marginBottom: 24 }}>从通讯录选择联系人开始聊天</div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <button className="wk-chat-empty-guide-btn" onClick={() => {
                            WKApp.endpoints.showConversationSelect?.((channels) => {
                              if (channels?.length > 0) {
                                WKApp.endpoints.showConversation(channels[0]);
                              }
                            }, "找人聊天");
                          }}>找人聊天</button>
                          <button className="wk-chat-empty-guide-btn" onClick={() => {
                            const menus = WKApp.shared.chatMenus();
                            const groupMenu = menus.find(m => m.key === 'start-group');
                            if (groupMenu?.onClick) groupMenu.onClick();
                          }}>创建群聊</button>
                        </div>
                      </div>
                    ) : (
                      <ErrorBoundary moduleName="会话列表">
                        <ChatConversationList
                          conversations={vm.filteredConversations}
                          filter={filter}
                          select={WKApp.shared.openChannel}
                          onOpenCreateCategoryRef={this.openCreateCategoryRef}
                          onConversationClick={(conversation: ConversationWrap) => {
                            const doSwitch = () => {
                              // 子区：直接进入完整视图（参考 Discord 逻辑）
                              if (conversation.channel.channelType === ChannelTypeCommunityTopic) {
                                WKApp.mittBus.emit('wk:close-thread-panel', undefined)
                                vm.selectedConversation = conversation;
                                WKApp.endpoints.showConversation(conversation.channel);
                                vm.notifyListener();
                                return
                              }
                              // 普通会话：关闭子区面板
                              WKApp.mittBus.emit('wk:close-thread-panel', undefined)
                              vm.selectedConversation = conversation;
                              WKApp.endpoints.showConversation(conversation.channel);
                              vm.notifyListener();
                            }
                            const guard = WKApp.shared.pendingAttachmentGuard
                            if (guard && !guard()) {
                              this.setState({ pendingConfirm: { onOk: doSwitch } })
                              return
                            }
                            doSwitch()
                          }}
                          onClearMessages={this.vm.clearMessages.bind(this.vm)}
                          onThreadOverflowClick={(groupNo: string) => {
                            // 通过 mittBus 通知导航到父群聊子区列表
                            WKApp.mittBus.emit('wk:pending-thread', { groupNo, thread: null })
                            // 若当前不是目标群聊，切换频道
                            if (this.props.channel?.channelID !== groupNo) {
                              WKApp.shared.pendingThreadPanel = groupNo
                              const groupConv = vm.filteredConversations.find(
                                c => c.channel.channelType === ChannelTypeGroup && c.channel.channelID === groupNo
                              )
                              if (groupConv) {
                                vm.selectedConversation = groupConv
                                vm.notifyListener()
                              }
                              WKApp.endpoints.showConversation(new Channel(groupNo, ChannelTypeGroup))
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
                  vm.showGlobalSearch = false
                }}
                >
                <div style={{ marginTop: '30px' }}>
                  <ErrorBoundary moduleName="搜索">
                    <GlobalSearch onClick={(item,type:string)=>{
                        void handleGlobalSearchClick(item,type,()=>{
                          vm.showGlobalSearch = false
                        })
                    }}/>
                  </ErrorBoundary>
                </div>
              </WKModal>

              {/* 附件未发送切换会话确认弹窗 */}
              <WKModal
                visible={!!this.state.pendingConfirm}
                title="有未发送的附件"
                footer={
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--wk-sp-2)' }}>
                    <WKButton
                      variant="secondary"
                      onClick={() => this.setState({ pendingConfirm: null })}
                    >
                      取消
                    </WKButton>
                    <WKButton
                      variant="primary"
                      onClick={() => {
                        this.state.pendingConfirm?.onOk()
                        this.setState({ pendingConfirm: null })
                      }}
                    >
                      继续切换
                    </WKButton>
                  </div>
                }
                onCancel={() => this.setState({ pendingConfirm: null })}
                options={{ closable: false }}
              >
                <p style={{ margin: 0, color: 'var(--wk-text-secondary)', fontSize: 'var(--wk-text-size-md)' }}>
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
