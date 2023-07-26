import { WKSDK,Channel, ChannelInfo } from "wukongimjssdk";
import { Component } from "react";
import Checkbox from "../Checkbox";
import { animateScroll } from 'react-scroll';
import { ConversationWrap } from "../../Service/Model";
import WKApp from "../../App";
import  { IconSearchStroked } from '@douyinfe/semi-icons';
import "./index.css"
import React from "react";
import WKAvatar from "../WKAvatar";

interface ConversationSelectProps {
    onFinished?: (channels: Channel[]) => void
    title?:string
}

interface ConversationSelectState {
    conversationWraps: ConversationWrap[]
    friends: ChannelInfo[]
    selectChannels: Channel[] // 被选中的频道
    keyword?:string
}


export default class ConversationSelect extends Component<ConversationSelectProps, ConversationSelectState> {

    constructor(porps: any) {
        super(porps);
        this.state = {
            conversationWraps: [],
            selectChannels: [],
            friends: [],
        }
    }

    async requestConversation() {
        const conversations =  WKSDK.shared().conversationManager.conversations
        const conversationWraps = new Array<ConversationWrap>()
        if (conversations) {
            for (const conversation of conversations) {
                const channelInfo = WKSDK.shared().channelManager.getChannelInfo(conversation.channel)
                if (!channelInfo) {
                    WKSDK.shared().channelManager.fetchChannelInfo(conversation.channel)
                }
                conversationWraps.push(new ConversationWrap(conversation))
            }
        }
        this.setState({
            conversationWraps: conversationWraps,
        })
    }

    async requestContacts(keyword?:string) {
        const friends = await WKApp.dataSource.commonDataSource.searchFriends(keyword)
        this.setState({
            friends: friends!,
        })
    }
    // 排序最近会话列表
    sortConversations(conversations: Array<ConversationWrap>) {
        let newConversations = conversations;
        if (!newConversations || newConversations.length <= 0) {
            return [];
        }
        let sortAfter = newConversations.sort((a, b) => {
            let aScore = a.timestamp;
            let bScore = b.timestamp;
            if (a.channelInfo && a.channelInfo.top) {
                aScore += 1000000;
            }
            if (b.channelInfo && b.channelInfo.top) {
                bScore += 1000000;
            }
            return bScore - aScore;
        });
        return sortAfter
    }

    componentDidMount() {
        this.requestConversation()
        this.requestContacts()
    }

    select(channel: Channel) {
        const { selectChannels } = this.state
        let newChannels = new Array()
        var unselected: boolean = false
        if (selectChannels && selectChannels.length > 0) {
            for (const selectChannel of selectChannels) {
                if (channel.isEqual(selectChannel)) {
                    unselected = true
                    continue
                } else {
                    newChannels.push(selectChannel)
                }
            }
        }
        if (!unselected) {
            newChannels.push(channel)
        }

        this.setState({
            selectChannels: newChannels,
        }, () => {
            this.scrollToBottom()
        })
    }

    hasSelected(channel: Channel) {
        const { selectChannels } = this.state
        if (selectChannels && selectChannels.length > 0) {
            for (const selectChannel of selectChannels) {
                if (channel.isEqual(selectChannel)) {
                    return true
                }
            }
        }
        return false
    }
    scrollToBottom(): void {
        animateScroll.scrollToBottom({
            containerId: "conversationSelectSearchBox",
            "duration": 0,
        });
    }

    onSelect(value:any) {
        this.setState({
            keyword: value,
        })
    }
    render() {
        const { conversationWraps, selectChannels, friends,keyword } = this.state
        const { onFinished,title } = this.props
        let sortedConversations = this.sortConversations(conversationWraps);
        return <div className="wk-conversationselect">
            <div>
                <div className="wk-conversationselect-content-title">{title||"转发"}</div>
                <div id="conversationSelectSearchBox" className="wk-conversationselect-content-searchBox">
                    <div className="wk-conversationselect-content-selectedChannel">
                        {
                            selectChannels.map((channel: Channel) => {
                                return <div key={`${channel.channelID}-selected`} className="wk-conversationselect-content-selectedAvatar" onClick={() => {
                                    this.select(channel)
                                }}>
                                    <WKAvatar channel={channel} style={{ width: "48px", height: "48px", borderRadius: "48px" }}></WKAvatar>
                                </div>
                            })
                        }
                        <div className="wk-conversationselect-content-searchContent">
                            <div className="wk-conversationselect-content-searchIcon">
                                <IconSearchStroked style={{ color: '#bbbfc4', fontSize: '20px' }}/>
                            </div>
                            <div className="wk-conversationselect-content-searchInput">
                                <input placeholder="搜索" type="text" style={{ fontSize: '17px' }} onChange={(v)=>{
                                    this.onSelect(v.target.value)
                                }}/>
                            </div>
                        </div>
                    </div>

                </div>
                <div className="wk-conversationselect-content-box">
                    <div className="wk-conversationselect-content-header">
                        最近聊天
                    </div>
                    <div className="wk-conversationselect-content-list">
                        {
                            sortedConversations.filter((v)=>{
                                if(!keyword || keyword === "") {
                                    return true
                                }
                               return v.channelInfo?.title.indexOf(keyword)!=-1
                            }).map((conversationWrap: ConversationWrap) => {

                                return (
                                    <div key={`${conversationWrap.channel.channelID}-conversation`} className="wk-conversationselect-content" onClick={() => {
                                        this.select(conversationWrap.channel)
                                    }}>
                                        <div>
                                            <Checkbox checked={this.hasSelected(conversationWrap.channel)} onCheck={() => {
                                                this.select(conversationWrap.channel)
                                            }} />
                                        </div>
                                        <div className="wk-conversationselect-content-box-data">
                                            <div>
                                                <WKAvatar channel={conversationWrap.channel} style={{ width: "48px", height: "48px", borderRadius: "48px" }} />
                                            </div>
                                            <div className="wk-conversationselect-content-box-name">
                                                {
                                                    conversationWrap.channelInfo?.orgData.displayName
                                                }
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        }

                    </div>
                    <div className="wk-conversationselect-content-header">
                        好友
                    </div>
                    <div className="wk-conversationselect-content-list">
                        {
                            friends.filter((v)=>{
                                if(!keyword || keyword === "") {
                                    return true
                                }
                               return  v.orgData.displayName.indexOf(keyword) !==-1
                            }).map((channelInfo: ChannelInfo) => {

                                return (
                                    <div key={channelInfo.channel.channelID} className="wk-conversationselect-content" onClick={() => {
                                        this.select(channelInfo.channel)
                                    }}>
                                        <div >
                                            <Checkbox checked={this.hasSelected(channelInfo.channel)} onCheck={() => {
                                                this.select(channelInfo.channel)
                                            }} />
                                        </div>
                                        <div className="wk-conversationselect-content-box-data">
                                            <div >
                                                <WKAvatar channel={channelInfo.channel} style={{ width: "48px", height: "48px", borderRadius: "48px" }} />
                                            </div>
                                            <div className="wk-conversationselect-content-box-name">
                                                {
                                                    channelInfo?.orgData.displayName
                                                }
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        }

                    </div>
                </div>
            </div>
            <div className="wk-conversationselect-footer">
                <div className="wk-conversationselect-okBtn" onClick={() => {
                    if(onFinished) {
                        onFinished(selectChannels)
                    }
                }}>
                    确认{selectChannels.length > 0 ? `(${selectChannels.length})` : ""}
                </div>
            </div>
        </div>
    }
}