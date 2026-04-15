import React, { Component } from "react";
import { ReactNode } from "react";
import Section from "./section";
import ItemMessage from "./item-message";
import WKApp from "../../App";
import "./tab-all.css"
import WKSDK, { Channel, ChannelTypePerson, MessageContentType } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { throttle } from "../../Utils/rateLimit";


interface TabAllProps {
    keyword?: string;
    searchResult?: any;
    loadMore?: () => void; // 添加加载更多的回调函数
    // item点击事件，传递item和type，type为contacts、group、message
    onClick?: (item: any, type: string) => void;
}

export default class TabAll extends Component<TabAllProps> {

    handleScroll = throttle((event: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
        if (scrollTop + clientHeight >= scrollHeight) {
            if (this.props.loadMore) {
                this.props.loadMore();
            }
        }
    }, 100);

    render(): ReactNode {

        let existMessages = this.props.searchResult?.messages.length > 0

        return <div className="wk-tab-all" onScroll={this.handleScroll}>

            {
                !this.props.searchResult && !this.props.keyword && (
                    <div style={{ textAlign: 'center', color: 'var(--wk-text-tertiary, #9498A8)', padding: '48px 0', fontSize: '13px' }}>
                        输入关键词开始搜索
                    </div>
                )
            }

            {
                existMessages ? (
                    <Section title="消息">
                        {
                            this.props.searchResult?.messages.map((item: any) => {
                                let digest = "[未知消息]"
                                if(item.content) {
                                    digest = item.content.conversationDigest
                                }else {
                                    if (item.payload.type === MessageContentType.text) {
                                        digest = item.payload.content
                                    } else if (item.payload.type === MessageContentTypeConst.file) {
                                        digest = `[${item.payload.name}]`
                                    }
                                }
                                

                                let sender;
                                if (item.channel?.channel_type !== ChannelTypePerson && item.from_uid && item.from_uid !== "") {
                                    const senderChannel = new Channel(item.from_uid, ChannelTypePerson)
                                    const channelInfo = WKSDK.shared().channelManager.getChannelInfo(senderChannel)
                                    if (channelInfo) {
                                        sender = channelInfo.title
                                    } else {
                                        WKSDK.shared().channelManager.fetchChannelInfo(senderChannel)
                                    }
                                }

                                return <ItemMessage 
                                key={item.message_idstr} 
                                sender={sender} 
                                digest={digest} 
                                name={item.channel?.channel_name} 
                                avatar={WKApp.shared.avatarChannel(new Channel(item.channel?.channel_id, item.channel?.channel_type))} 
                                onClick={() => {
                                    if (this.props.onClick) {
                                        this.props.onClick(item, "message")
                                    }
                                }}
                                />
                            })
                        }
                    </Section>
                ) : null
            }


        </div>
    }
}