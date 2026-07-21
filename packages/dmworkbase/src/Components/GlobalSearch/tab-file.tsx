import React, { Component } from "react";
import { ReactNode } from "react";
import ItemFile from "./item-file";
import WKApp from "../../App";
import "./tab-file.css"
import WKSDK, { Channel, ChannelInfo, ChannelInfoListener, ChannelTypePerson } from "wukongimjssdk";
import { debounce } from "../../Utils/rateLimit";
import VisibilityTrigger from "../VisibilityTrigger";
import { addImChannelInfoListener, fetchImChannelInfo, getImChannelInfo } from "../../im-runtime/channelRuntime";

interface TabFileProps {
    keyword?: string;
    files?: any[];
    loadMore?: () => void; // 添加加载更多的回调函数
    onClick?: (item: any) => void;
}

export default class TabFile extends Component<TabFileProps> {

    // 懒加载：仅视口内的文件才拉发送者 channelInfo。debounce 合批 forceUpdate，
    // fetchedUids 防止同 uid 重复请求。
    private _channelInfoListener!: ChannelInfoListener
    private unsubscribeChannelInfoListener?: () => void
    private _forceUpdateDebounced = debounce(() => this.forceUpdate(), 150)
    private fetchedUids = new Set<string>()

    componentDidMount() {
        this._channelInfoListener = (channelInfo: ChannelInfo) => {
            if (channelInfo?.channel?.channelType === ChannelTypePerson) {
                this._forceUpdateDebounced()
            }
        }
        this.unsubscribeChannelInfoListener = addImChannelInfoListener(WKSDK.shared(), this._channelInfoListener)
    }

    componentWillUnmount() {
        this.unsubscribeChannelInfoListener?.()
        this.unsubscribeChannelInfoListener = undefined
        this._forceUpdateDebounced.cancel()
    }

    private requestSenderChannelInfoIfNeeded = (fromUid: string) => {
        if (!fromUid || this.fetchedUids.has(fromUid)) return
        const senderChannel = new Channel(fromUid, ChannelTypePerson)
        if (getImChannelInfo(WKSDK.shared(), senderChannel)) return
        this.fetchedUids.add(fromUid)
        void fetchImChannelInfo(WKSDK.shared(), senderChannel)
    }

    // Sticky files：父层 tab 切换中途会把 files 置为 undefined，保留上次非空
    // 值继续渲染，避免列表 DOM 销毁-重建触发重复请求。
    private stickyFiles?: any[]

    handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
        if (scrollTop + clientHeight >= scrollHeight) {
            if (this.props.loadMore) {
                this.props.loadMore();
            }
        }
    };
    render(): ReactNode {
        const incoming = this.props.files
        if (incoming !== undefined) {
            this.stickyFiles = incoming
        }
        const files = this.stickyFiles
        return <div className="wk-tab-file" onScroll={this.handleScroll}>
            {
                files?.map((item: any) => {
                    let sender;
                    const senderChannel = new Channel(item.from_uid, ChannelTypePerson)
                    const channelInfo = getImChannelInfo(WKSDK.shared(), senderChannel)
                    if (channelInfo) {
                        sender = channelInfo.title
                    }
                    // 缺失时交由 VisibilityTrigger 按需拉取

                    // 永远用 VisibilityTrigger 包裹，避免 VisibilityTrigger ↔ Fragment
                    // 在同 key 下切换导致子树 unmount + remount
                    return <VisibilityTrigger
                        key={item.message_idstr}
                        onVisible={() => {
                            if (item.from_uid) {
                                this.requestSenderChannelInfoIfNeeded(item.from_uid)
                            }
                        }}
                    >
                        <ItemFile
                            sender={sender}
                            message={item}
                            onClick={()=>{
                                if(this.props.onClick) {
                                    this.props.onClick(item)
                                }
                            }}
                        />
                    </VisibilityTrigger>
                })
            }
        </div>
    }
}
