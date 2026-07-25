import React, { Component } from "react";
import WKSDK, {
    Channel,
    ChannelInfo,
    ChannelInfoListener,
    ChannelTypeGroup,
    ChannelTypePerson,
} from "wukongimjssdk";
import ConversationContext from "../Components/Conversation/context";
import { MessageWrap } from "../Service/Model";
import {
    addImChannelInfoListener,
    addImSubscriberChangeListener,
    fetchImChannelInfo,
    getImChannelInfo,
} from "../im-runtime/channelRuntime";


export interface MessageBaseCellProps {
    message: MessageWrap
    context: ConversationContext
}

class MessageBaseCellPropsImp implements MessageBaseCellProps {
    message!: MessageWrap;
    context!: ConversationContext

}
export class MessageBaseCell<P extends MessageBaseCellProps = MessageBaseCellPropsImp, S = {}> extends Component<P, S> {


}

export class MessageCell<P extends MessageBaseCellProps = MessageBaseCellPropsImp, S = {}> extends MessageBaseCell<P, S> {
    private _channelInfoListener!: ChannelInfoListener
    private _subscriberChangeListener?: (channel: Channel) => void
    private _unsubscribeChannelInfoListener?: () => void
    private _unsubscribeSubscriberChangeListener?: () => void

    componentDidMount() {
        const { message } = this.props
        // 订阅 channelInfo 更新，发送者信息到达后触发重渲染（修复 uid 显示问题）
        //
        // 同时监听 conversation channel
        // （message.channel，1v1 时是对端 Person channel）的 channelInfo 到达。
        // class 渲染路径（ImageCell/VideoCell/FileCell/MergeforwardCell 等）走
        // getMessageRow() 纯函数，getMessageRow 的保守策略（18脸 Person 1v1 +
        // self-sent + conversationChannelInfo missing → 压制 self-fallback）需要
        // channelInfo 到达时 rerender 才能切回真实实名状态。不 listen 这个的话
        // class 路径的图片/视频/文件/合并转发在普通 1v1 会永远不显 self 徽章。
        this._channelInfoListener = (channelInfo: ChannelInfo) => {
            const ch = channelInfo?.channel
            if (!ch) return
            if (ch.channelID === message.fromUID) {
                this.setState({})
                return
            }
            const convChannel = message.channel
            if (
                convChannel &&
                ch.channelID === convChannel.channelID &&
                ch.channelType === convChannel.channelType
            ) {
                this.setState({})
            }
        }
        this._unsubscribeChannelInfoListener = addImChannelInfoListener(WKSDK.shared(), this._channelInfoListener)

        // 没有缓存时主动拉取 sender Person channelInfo
        if (message.fromUID) {
            const channel = new Channel(message.fromUID, ChannelTypePerson)
            if (!getImChannelInfo(WKSDK.shared(), channel)) {
                void fetchImChannelInfo(WKSDK.shared(), channel)
            }
        }

        // 没有缓存时主动拉取 conversation Person channelInfo
        //（1v1 场景，getMessageRow 的 self-fallback 保守策略需要它）。
        // 收窄到 Person 1v1：群消息不需 group channelInfo 来判 self fallback，
        // 不收窄会在群聊历史首屏引发重复 fetch。用 !isEqual dedupe避免和
        // 上面的 sender fetch 重复（1v1 中发送者和对端可能是同一个）。
        const convChannel = message.channel
        if (
            convChannel &&
            convChannel.channelType === ChannelTypePerson &&
            !(message.fromUID && convChannel.channelID === message.fromUID)
        ) {
            if (!getImChannelInfo(WKSDK.shared(), convChannel)) {
                void fetchImChannelInfo(WKSDK.shared(), convChannel)
            }
        }

        // class + MessageRow 渲染路径依赖 group subscribers 解析群昵称/实名标。
        // 群成员列表异步到达时需要主动刷新，对齐旧 MessageBase 行为。
        if (message.channel?.channelType === ChannelTypeGroup) {
            this._subscriberChangeListener = (channel: Channel) => {
                if (message.channel?.isEqual(channel)) {
                    this.setState({})
                }
            }
            this._unsubscribeSubscriberChangeListener = addImSubscriberChangeListener(WKSDK.shared(), this._subscriberChangeListener)
        }
    }

    componentWillUnmount() {
        this._unsubscribeChannelInfoListener?.()
        this._unsubscribeChannelInfoListener = undefined
        this._unsubscribeSubscriberChangeListener?.()
        this._unsubscribeSubscriberChangeListener = undefined
    }

    render() {
        return <div>MessageCell</div>
    }
}
