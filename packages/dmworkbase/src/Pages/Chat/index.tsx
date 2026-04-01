import React, { Component, ReactNode } from "react";
import { Conversation } from "../../Components/Conversation";
import ConversationList, { ConvFilter } from "../../Components/ConversationList";
import Provider from "../../Service/Provider";
import { ErrorBoundary } from "../../Components/ErrorBoundary";

import { Spin, Modal, Popover } from "@douyinfe/semi-ui";
import { Search, Plus } from "lucide-react";
import { ChatVM, handleGlobalSearchClick } from "./vm";
import "./index.css";
import { ConversationWrap } from "../../Service/Model";
import WKApp, { ThemeMode } from "../../App";
import ChannelSetting from "../../Components/ChannelSetting";
import classNames from "classnames";
import { Channel, ChannelInfo, WKSDK } from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
import { ChatMenus } from "../../App";
import ConversationContext from "../../Components/Conversation/context";
import GlobalSearch from "../../Components/GlobalSearch";
import { ShowConversationOptions } from "../../EndpointCommon";
import SpaceList from "../../Components/SpaceList";
import SpaceCreate from "../../Components/SpaceCreate";
import { Space } from "../../Service/SpaceService";
import NavSignalBadge from "../../Components/NavRail/NavSignalBadge";

export interface ChatContentPageProps {
  channel: Channel;
  initLocateMessageSeq?: number; // 打开时定位到某条消息
}

export interface ChatContentPageState {
  showChannelSetting: boolean;
}
export class ChatContentPage extends Component<
  ChatContentPageProps,
  ChatContentPageState
> {
  channelInfoListener!: ChannelInfoListener;
  conversationContext!: ConversationContext;
  constructor(props: any) {
    super(props);
    this.state = {
      showChannelSetting: false,
    };
  }

  componentDidMount() {
    const { channel } = this.props;
    this.channelInfoListener = (channelInfo: ChannelInfo) => {
      if (channelInfo.channel.isEqual(channel)) {
        this.setState({});
      }
    };
    WKSDK.shared().channelManager.addListener(this.channelInfoListener);
  }

  componentWillUnmount() {
    WKSDK.shared().channelManager.removeListener(this.channelInfoListener);
  }



  render(): React.ReactNode {
    const { channel, initLocateMessageSeq } = this.props;
    const { showChannelSetting } = this.state;
    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel);
    if (!channelInfo) {
      WKSDK.shared().channelManager.fetchChannelInfo(channel);
    }
    return (
      <div
        className={classNames(
          "wk-chat-content-right",
          showChannelSetting ? "wk-chat-channelsetting-open" : ""
        )}
      >
        <div className="wk-chat-content-chat">
          <div
            className="wk-chat-conversation-header"
            onClick={() => {
              this.setState({
                showChannelSetting: !this.state.showChannelSetting,
              });
            }}
          >
            <div className="wk-chat-conversation-header-content">
              <div className="wk-chat-conversation-header-left">
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
                    <img alt="" src={WKApp.shared.avatarChannel(channel)}></img>
                  </div>
                  <div className="wk-chat-conversation-header-channel-info">
                    <div className="wk-chat-conversation-header-channel-info-name">
                      {channelInfo?.orgData?.displayName}
                    </div>
                    <div className="wk-chat-conversation-header-channel-info-tip"></div>
                  </div>
                </div>
              </div>
              <div className="wk-chat-conversation-header-right">
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
                  this.setState({});
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
      </div>
    );
  }
}

interface ChatPageState {
  filter: ConvFilter
  dropdownOpen: boolean
}

const FILTER_OPTIONS: { key: ConvFilter; label: string; icon: ReactNode }[] = [
  {
    key: 'all', label: '全部会话',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  },
  {
    key: 'group', label: '群聊',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  },
  {
    key: 'ai', label: 'AI',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
  },
  {
    key: 'human', label: '人类',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  },
]

export default class ChatPage extends Component<any, ChatPageState> {
  vm!: ChatVM;
  spaceListRef: SpaceList | null = null;
  constructor(props: any) {
    super(props);
    this.state = { filter: 'all', dropdownOpen: false }
  }

  componentDidMount() {
    document.addEventListener('click', this._handleDocClick)
  }

  componentWillUnmount() {
    document.removeEventListener('click', this._handleDocClick)
  }

  _handleDocClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('.wk-chat-title-dropdown')) {
      this.setState({ dropdownOpen: false })
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
          const { filter, dropdownOpen } = this.state
          const activeOption = FILTER_OPTIONS.find(o => o.key === filter)!
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
                        className={classNames('wk-chat-title-btn', dropdownOpen ? 'wk-chat-title-btn-open' : undefined)}
                        onClick={() => this.setState(s => ({ dropdownOpen: !s.dropdownOpen }))}
                      >
                        {activeOption.label}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </button>
                      {dropdownOpen && (
                        <div className="wk-chat-title-menu">
                          {FILTER_OPTIONS.map(opt => (
                            <button
                              key={opt.key}
                              type="button"
                              tabIndex={0}
                              className={classNames('wk-chat-title-option', filter === opt.key ? 'wk-chat-title-option-active' : undefined)}
                              onClick={() => this.setState({ filter: opt.key, dropdownOpen: false })}
                            >
                              <span className="wk-chat-title-option-icon">{opt.icon}</span>
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
                        onClick={() => { vm.showGlobalSearch = true; }}
                      >
                        <Search size={16} />
                      </div>
                      <Popover
                        onClickOutSide={() => { vm.showAddPopover = false; }}
                        className="wk-chat-popover"
                        position="bottomRight"
                        visible={vm.showAddPopover}
                        showArrow={false}
                        trigger="custom"
                        content={
                          <ChatMenusPopover onItem={() => { vm.showAddPopover = false; }} />
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
                  {/* SpaceList 已移至侧边栏 */}
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
                            const groupMenu = menus.find(m => m.title === "发起群聊");
                            if (groupMenu?.onClick) groupMenu.onClick();
                          }}>创建群聊</button>
                        </div>
                      </div>
                    ) : (
                      <ErrorBoundary moduleName="会话列表">
                        <ConversationList
                          select={WKApp.shared.openChannel}
                          conversations={vm.filteredConversations}
                          filter={filter}
                          onClearMessages={this.vm.clearMessages.bind(this.vm)}
                          onClick={(conversation: ConversationWrap) => {
                            vm.selectedConversation = conversation;
                            WKApp.endpoints.showConversation(
                              conversation.channel
                            );
                            vm.notifyListener();
                          }}
                        ></ConversationList>
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
              <Modal
                visible={vm.showGlobalSearch}
                closeOnEsc={true}
                onCancel={() => {
                  vm.showGlobalSearch = false
                }}
                footer={null}
                width="80%"
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
              </Modal>
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
