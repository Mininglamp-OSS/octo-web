import { Channel, ChannelInfo, ChannelTypePerson, WKSDK } from "wukongimjssdk"
import { MessageCell } from '../MessageCell'
import { MessageWrap } from '../../Service/Model'
import WKApp from '../../App'
import React from 'react'
import "./index.css"
import { ChannelInfoListener } from "wukongimjssdk"


export class RevokeCell extends MessageCell {
    channelInfoListener!:ChannelInfoListener

    componentDidMount() {
        const { message } = this.props
        this.channelInfoListener = (channelInfo:ChannelInfo) => {
            if(channelInfo.channel.channelType === ChannelTypePerson && channelInfo.channel.channelID === message.revoker) {
                this.setState({})
            }
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)
    }

    componentWillUnmount() {
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }

    static tip(message: MessageWrap) {
        let name = "你"
        let revoker = message.revoker
        if (revoker === WKApp.loginInfo.uid) {
            if (revoker !== message.fromUID) {
                let memberFromName = "--"
                if (message.from) {
                    memberFromName = message.from.title;
                } else {
                    WKSDK.shared().channelManager.fetchChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
                }
                return `${name}撤回了成员“${memberFromName}”的一条消息`
            }
            return `${name}撤回了一条消息`

        } else {
            const channel = new Channel(revoker ?? "", ChannelTypePerson)
            let channelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(revoker ?? "", ChannelTypePerson))
            if (channelInfo) {
                name = channelInfo.title
            } else {
                WKSDK.shared().channelManager.fetchChannelInfo(channel)
                name = "--"
            }
            if (revoker !== message.fromUID) {
                return `${name}撤回了一条成员消息`
            }
            return `${name}撤回了一条消息`
        }
    }

    render() {
        const { message } = this.props
        return <div className="wk-message-system">{RevokeCell.tip(message)}</div>
    }
}