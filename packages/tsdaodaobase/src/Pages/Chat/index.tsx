import React, { Component, ReactNode } from "react";
import { Conversation } from "../../Components/Conversation";
import ConversationList from "../../Components/ConversationList";
import Provider from "../../Service/Provider";

import { Spin, Button, Popover } from '@douyinfe/semi-ui';
import { IconPlus } from '@douyinfe/semi-icons';
import { ChatVM } from "./vm";
import "./index.css"
import { ConversationWrap } from "../../Service/Model";
import WKApp, { ThemeMode } from "../../App";
import ChannelSetting from "../../Components/ChannelSetting";
import classNames from "classnames";
import { Channel, ChannelInfo, WKSDK } from "wukongimjssdk/lib/sdk";
import { ChannelInfoListener } from "wukongimjssdk/lib/channel_manager";
import { ChatMenus } from "../../App";
import ConversationContext from "../../Components/Conversation/context";


export interface ChatContentPageProps {
    channel: Channel
    initLocateMessageSeq?:number
}

export interface ChatContentPageState {
    showChannelSetting: boolean
}
export class ChatContentPage extends Component<ChatContentPageProps, ChatContentPageState> {
    channelInfoListener!: ChannelInfoListener
    conversationContext!:ConversationContext
    constructor(props: any) {
        super(props)
        this.state = {
            showChannelSetting: false,
        }
    }

    componentDidMount() {
        const { channel } = this.props
        this.channelInfoListener = (channelInfo: ChannelInfo) => {
            if (channelInfo.channel.isEqual(channel)) {
                this.setState({})
            }
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)

    }

    componentWillUnmount() {
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }

    render(): React.ReactNode {
        const { channel,initLocateMessageSeq } = this.props
        const { showChannelSetting } = this.state
        const channelInfo = WKSDK.shared().channelManager.getChannelInfo(channel)
        if (!channelInfo) {
            WKSDK.shared().channelManager.fetchChannelInfo(channel)
        }
        return <div className={classNames("wk-chat-content-right", showChannelSetting ? "wk-chat-channelsetting-open" : "")}>
            <div className="wk-chat-content-chat">
                <div className="wk-chat-conversation-header" onClick={() => {
                    this.setState({
                        showChannelSetting: !this.state.showChannelSetting
                    })
                }}>
                    <div className="wk-chat-conversation-header-content">
                        <div className="wk-chat-conversation-header-left">
                            <div className="wk-chat-conversation-header-back" onClick={(e) => {
                                e.stopPropagation()
                                WKApp.routeRight.pop()
                            }}>
                                <div className="wk-chat-conversation-header-back-icon"></div>
                            </div>
                            <div className="wk-chat-conversation-header-channel">
                                <div className="wk-chat-conversation-header-channel-avatar">
                                    <img src={WKApp.shared.avatarChannel(channel)}></img>
                                </div>
                                <div className="wk-chat-conversation-header-channel-info">
                                    <div className="wk-chat-conversation-header-channel-info-name">
                                        {
                                            channelInfo?.orgData?.displayName
                                        }
                                    </div>
                                    <div className="wk-chat-conversation-header-channel-info-tip">

                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="wk-chat-conversation-header-right">
                            <div className="wk-chat-conversation-header-setting">
                                <svg className="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2166" width="24" height="24"><path d="M512 298.6496a85.3504 85.3504 0 1 0 0-170.6496 85.3504 85.3504 0 0 0 0 170.6496z" p-id="2167"></path><path d="M512 512m-85.3504 0a85.3504 85.3504 0 1 0 170.7008 0 85.3504 85.3504 0 1 0-170.7008 0Z" p-id="2168"></path><path d="M512 896a85.3504 85.3504 0 1 0 0-170.7008 85.3504 85.3504 0 0 0 0 170.7008z" p-id="2169"></path></svg>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="wk-chat-conversation">
                    <Conversation initLocateMessageSeq={initLocateMessageSeq} shouldShowHistorySplit={true} onContext={(ctx)=>{
                        this.conversationContext = ctx
                        this.setState({})
                    }} key={channel.getChannelKey()} chatBg={WKApp.config.themeMode === ThemeMode.dark?undefined:require("./assets/chat_bg.svg").default} channel={channel}></Conversation>
                </div>
            </div>

            <div className={classNames("wk-chat-channelsetting")}>
                <ChannelSetting conversationContext={this.conversationContext} key={channel.getChannelKey()} channel={channel} onClose={() => {
                    this.setState({
                        showChannelSetting: false
                    })
                }}></ChannelSetting>
            </div>
        </div>
    }
}

export default class ChatPage extends Component<any> {
    vm!: ChatVM
    constructor(props: any) {
        super(props)
    }

    componentDidMount() {

        // WKApp.routeMain.replaceToRoot(<ChatContentPage vm={this.vm}></ChatContentPage>)
    }

    componentWillUnmount() {
    }

    render(): ReactNode {
        return <Provider create={() => {
            this.vm = new ChatVM()
            return this.vm
        }} render={(vm: ChatVM) => {
            return <div className="wk-chat">
                <div className={classNames("wk-chat-content", vm.selectedConversation ? "wk-conversation-open" : undefined)}>
                    <div className="wk-chat-content-left">
                        <div className="wk-chat-search">
                            <div className="wk-chat-title">
                                {vm.connectTitle}
                            </div>
                            <Popover onClickOutSide={()=>{
                                 vm.showAddPopover = false
                            }} className="wk-chat-popover" position="bottomRight"  visible={vm.showAddPopover} showArrow={false} trigger="custom" content={<ChatMenusPopover onItem={()=>{
                                 vm.showAddPopover = false
                            }}></ChatMenusPopover>}>
                                <div className="wk-chat-search-add" onClick={()=>{
                                    vm.showAddPopover = !vm.showAddPopover
                                }}>
                                <IconPlus size="large"></IconPlus>
                                </div>
                                {/* <Button icon={<IconPlus></IconPlus>} onClick={() => {
                                    vm.showAddPopover = true
                                }}></Button> */}
                            </Popover>
                        </div>
                        <div className="wk-chat-conversation-list">
                            {
                                vm.loading ? <div className="wk-chat-conversation-list-loading">
                                    <Spin style={{ marginTop: "20px" }} />
                                </div> :
                                    <ConversationList select={WKApp.shared.openChannel} conversations={vm.conversations} onClick={(conversation: ConversationWrap) => {
                                        vm.selectedConversation = conversation
                                        WKApp.endpoints.showConversation(conversation.channel)
                                        vm.notifyListener()
                                    }}></ConversationList>
                            }
                        </div>
                    </div>
                </div>
            </div>
        }} />
    }
}


interface ChatMenusPopoverState {
    chatMenus: ChatMenus[]
}

interface ChatMenusPopoverProps {
    onItem?:(menus:ChatMenus)=>void
}
class ChatMenusPopover extends Component<ChatMenusPopoverProps, ChatMenusPopoverState> {
    constructor(props: any) {
        super(props)
        this.state = {
            chatMenus: [],
        }
    }
    componentDidMount() {
        this.setState({
            chatMenus: WKApp.shared.chatMenus()
        })
    }

    render(): React.ReactNode {
        const { chatMenus } = this.state
        const { onItem } = this.props
        return <div className="wk-chatmenuspopover">
            <ul>
                {
                    chatMenus.map((c,i) => {
                        return <li key={i} onClick={()=>{
                            if(c.onClick) {
                                c.onClick()
                            }
                            if(onItem) {
                                onItem(c)
                            }
                        }}>
                            <div className="wk-chatmenuspopover-avatar">
                               <img src={c.icon}></img>
                            </div>
                            <div className="wk-chatmenuspopover-title">
                                {c.title}
                            </div>
                        </li>
                    })
                }
            </ul>
        </div>
    }
}
