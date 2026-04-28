import React, { Component, ReactNode } from "react";
import { Conversation } from "../../Components/Conversation";
import ConversationList, {
  ConvFilter,
} from "../../Components/ConversationList";
import SidebarTabBar, { SidebarTab } from "../../Components/SidebarTabBar";
import ConversationListGrouped from "../../Components/ConversationListGrouped";
import ChatConversationList from "../../Components/ChatConversationList";
import Provider from "../../Service/Provider";
import { ErrorBoundary } from "../../Components/ErrorBoundary";

import { Spin, Popover } from "@douyinfe/semi-ui";
import WKButton from "../../Components/WKButton";
import WKModal from "../../Components/WKModal";
import { Columns2 } from "lucide-react";
import ThreadIcon from "../../Components/Icons/ThreadIcon";
import { ChatVM, handleGlobalSearchClick } from "./vm";
import "./index.css";
import { ConversationWrap } from "../../Service/Model";
import WKApp, { ThemeMode } from "../../App";
import ChannelSetting from "../../Components/ChannelSetting";
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
  /** 子区面板是否显示 */
  showThreadPanel: boolean;
  /** 当前选中的子区 */
  activeThread: Thread | null;
  /** 文件预览信息（非空时显示文件预览面板） */
  previewFile: FilePreviewInfo | null;
  /** 当前正在预览的文件消息 ID（用于卡片激活态） */
  activePreviewMessageId: string | null;
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
      previewFile: null,
      activePreviewMessageId: null,
    };
  }

  private _onFilePreview = (file: FilePreviewInfo) => {
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
      };
      // 关闭子区面板
      this.setState({
        showThreadPanel: false,
        activeThread: null,
        previewFile: null,
        activePreviewMessageId: null,
      });
      // 切换到子区完整视图
      const threadChannel = new Channel(
        activeThread.channel_id,
        ChannelTypeCommunityTopic
      );
      WKApp.endpoints.showConversation(threadChannel);
      return;
    }

    // 正常处理：打开文件预览，确保侧边面板打开（子区和文件预览共用一个壳子）
    this.setState({
      previewFile: file,
      showThreadPanel: true, // 确保面板打开
      activePreviewMessageId: file.messageId || null, // 保存激活的消息 ID
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
          previewFile: null, // 关闭文件预览
          activePreviewMessageId: null,
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

    // 检查是否需要自动打开子区面板（查看全部子区）
    if (WKApp.shared.pendingThreadPanel === channel.channelID) {
      this.setState({
        showThreadPanel: true,
        activeThread: null,
        previewFile: null,
        activePreviewMessageId: null,
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
        },
        activePreviewMessageId: pending.messageId || null,
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

    // 切换频道时消费 pendingThreadPanel 和 pendingFilePreview
    if (channel.channelID !== prevProps.channel.channelID) {
      // 打开全部子区列表
      if (WKApp.shared.pendingThreadPanel === channel.channelID) {
        WKApp.shared.pendingThreadPanel = undefined;
        this.setState({
          showThreadPanel: true,
          activeThread: null,
          showChannelSetting: false,
          previewFile: null, // 关闭文件预览（互斥）
          activePreviewMessageId: null,
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
          },
          activePreviewMessageId: pending.messageId || null,
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

  componentWillUnmount() {
    WKApp.mittBus.off("wk:file-preview", this._onFilePreview);
    if (this._onPendingThread) {
      WKApp.mittBus.off("wk:pending-thread", this._onPendingThread);
    }
    if (this._onCloseThreadPanel) {
      WKApp.mittBus.off("wk:close-thread-panel", this._onCloseThreadPanel);
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
          showThreadPanel || previewFile ? "wk-chat-threadpanel-open" : ""
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
              // 群聊：点击 header 切换子区面板
              if (
                !isThreadChannel &&
                channel.channelType === ChannelTypeGroup &&
                WKApp.remoteConfig.threadOn
              ) {
                this.setState({
                  showThreadPanel: !this.state.showThreadPanel,
                  activeThread: null,
                  showChannelSetting: false,
                  previewFile: null, // 关闭文件预览
                  activePreviewMessageId: null,
                });
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
                          // 群聊：真实头像
                          <WKAvatar
                            key={WKApp.shared.getChannelAvatarTag(channel)}
                            channel={channel}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
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
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item}
                          </div>
                        );
                      })}
                    {/* 子区按钮 - 直接打开子区列表 */}
                    {!isThreadChannel &&
                      channel.channelType === ChannelTypeGroup &&
                      WKApp.remoteConfig.threadOn && (
                        <div
                          className="wk-chat-conversation-header-right-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            this.setState({
                              showThreadPanel: true,
                              activeThread: null,
                              showChannelSetting: false,
                              previewFile: null, // 关闭文件预览（互斥）
                              activePreviewMessageId: null,
                            });
                          }}
                          title="子区"
                        >
                          <ThreadIcon size={20} color="currentColor" />
                        </div>
                      )}
                    <div
                      className="wk-chat-conversation-header-right-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        this.setState({
                          showChannelSetting: !this.state.showChannelSetting,
                          showThreadPanel: false,
                          previewFile: null, // 关闭文件预览（互斥）
                          activePreviewMessageId: null,
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
            <ErrorBoundary moduleName="聊天">
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
                      showChannelSetting: false,
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

        {/* 统一侧边面板：子区 + 文件预览共用一个壳子（仅群聊） */}
        {!isThreadChannel &&
          channel.channelType === ChannelTypeGroup &&
          WKApp.remoteConfig.threadOn &&
          (showThreadPanel || previewFile) && (
            <ThreadPanel
              groupNo={channel.channelID}
              thread={activeThread}
              onClose={() => {
                this.setState({
                  showThreadPanel: false,
                  activeThread: null,
                  previewFile: null,
                  activePreviewMessageId: null,
                });
              }}
              onThreadSelect={(thread) => {
                this.setState({ activeThread: thread });
              }}
              filePreview={previewFile}
              onFilePreviewClose={() => {
                this.setState({
                  previewFile: null,
                  activePreviewMessageId: null,
                });
              }}
              onReplyFile={(messageId) => {
                // 触发回复功能，保持文件预览面板打开
                this.conversationContext?.replyToMessageId?.(messageId);
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

        {/* 子区频道的文件预览（使用 ThreadPanel 壳子，获得拖拽功能） */}
        {isThreadChannel && previewFile && (
          <ThreadPanel
            onClose={() =>
              this.setState({ previewFile: null, activePreviewMessageId: null })
            }
            filePreview={previewFile}
            onFilePreviewClose={() =>
              this.setState({ previewFile: null, activePreviewMessageId: null })
            }
            onReplyFile={(messageId) => {
              // 触发回复功能，保持文件预览面板打开
              this.conversationContext?.replyToMessageId?.(messageId);
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
      </div>
    );
  }
}

const SIDEBAR_TAB_KEY = "wk_sidebar_active_tab";

function getSavedTab(): SidebarTab {
  try {
    const v = localStorage.getItem(SIDEBAR_TAB_KEY);
    if (v === "group" || v === "dm") return v;
  } catch {}
  return "group";
}

interface ChatPageState {
  activeTab: SidebarTab;
  currentSpaceName: string;
  pendingConfirm: null | { onOk: () => void }; // 附件切换确认弹窗
}

export default class ChatPage extends Component<any, ChatPageState> {
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
    };
  }

  _handleTabChange = (tab: SidebarTab) => {
    try {
      localStorage.setItem(SIDEBAR_TAB_KEY, tab);
    } catch {}
    this.setState({ activeTab: tab });
  };

  private _onSpaceChanged?: (space: any) => void;

  componentDidMount() {
    // 监听 space-changed，同步 spacename 到 state
    this._onSpaceChanged = (space: any) => {
      this.setState({
        currentSpaceName:
          (space as Space | undefined)?.name ?? WKApp.config.appName,
      });
    };
    WKApp.mittBus.on("space-changed", this._onSpaceChanged);

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
  }

  render(): ReactNode {
    return (
      <Provider
        create={() => {
          this.vm = new ChatVM();
          return this.vm;
        }}
        render={(vm: ChatVM) => {
          const { activeTab } = this.state;
          // 计算各 Tab 未读总数
          // 预构建子区 Map，避免 O(n²)
          const threadsByParentForTab = new Map<string, ConversationWrap[]>();
          for (const c of vm.conversations) {
            if (c.channel.channelType !== ChannelTypeCommunityTopic) continue;
            if (c.channelInfo?.mute) continue;
            const parentGroupNo =
              (c.channelInfo?.orgData?.parentGroupNo as string | undefined) ||
              parseThreadChannelId(c.channel.channelID)?.groupNo;
            if (!parentGroupNo) continue;
            const list = threadsByParentForTab.get(parentGroupNo) || [];
            list.push(c);
            threadsByParentForTab.set(parentGroupNo, list);
          }
          const groupUnread = vm.conversations.reduce(
            (sum: number, c: ConversationWrap) => {
              // 只计群组，子区未读已通过父群组 totalUnread 汇总，不重复计入
              if (c.channel.channelType !== ChannelTypeGroup) return sum;
              if (c.channelInfo?.mute) return sum;
              const threads =
                threadsByParentForTab.get(c.channel.channelID) ?? [];
              const threadUnread = threads.reduce(
                (s, t) => s + (t.unread || 0),
                0
              );
              return sum + (c.unread || 0) + threadUnread;
            },
            0
          );
          const dmUnread = vm.conversations.reduce(
            (sum: number, c: ConversationWrap) => {
              if (c.channel.channelType === ChannelTypePerson) {
                return sum + (c.unread || 0);
              }
              return sum;
            },
            0
          );
          // filter 用于 ConversationList
          const filter: ConvFilter = activeTab === "group" ? "group" : "dm";
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
                            {/* 群聊 Tab 下在顶部插入「创建分组」，对齐 ChatMenusPopover li 样式 */}
                            {activeTab === "group" && (
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
                                  创建分组
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
                                (m) => m.key === "start-group"
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
                                WKApp.endpoints.showConversation(
                                  conversation.channel
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
