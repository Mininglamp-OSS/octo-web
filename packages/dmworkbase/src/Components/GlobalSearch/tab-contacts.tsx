import React, { Component } from "react";
import { ReactNode } from "react";
import ItemContacts from "./item-contacts";
import WKApp from "../../App";
import { isBot } from "../WKAvatar";
import BotDetailModal from "../BotDetailModal";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import "./tab-contacts.css"

interface TabContactsProps {
    keyword?: string;
    friends?: any[];
    onClick?: (item: any) => void;
}

interface TabContactsState {
    botDetailUid: string;
    botDetailVisible: boolean;
}

export default class TabContacts extends Component<TabContactsProps, TabContactsState> {
    state: TabContactsState = {
        botDetailUid: "",
        botDetailVisible: false,
    };

    render(): ReactNode {
        return <div className="wk-tab-contacts">
            {
                this.props.friends?.map((item: any) => {
                    if (this.props.keyword && item.channel_name.indexOf(this.props.keyword) !== -1) {
                        item.channel_name = item.channel_name.replace(this.props.keyword, `<mark>${this.props.keyword}</mark>`)
                    }
                    return <ItemContacts
                    key={item.channel_id}
                    name={item.channel_name}
                    avatar={WKApp.shared.avatarUser(item.channel_id)}
                    isBot={isBot(item.channel_id)}
                    onClick={()=>{
                        // #106: Bot 搜索结果点击弹名片
                        if (isBot(item.channel_id)) {
                            this.setState({ botDetailUid: item.channel_id, botDetailVisible: true });
                            return;
                        }
                        if(this.props.onClick) {
                            this.props.onClick(item)
                        }
                    }}
                    />
                })
            }
            <BotDetailModal
                uid={this.state.botDetailUid}
                visible={this.state.botDetailVisible}
                onClose={() => this.setState({ botDetailVisible: false })}
                onChat={(channel) => {
                    WKApp.endpoints.showConversation(channel);
                    this.setState({ botDetailVisible: false });
                }}
            />
        </div>
    }
}
