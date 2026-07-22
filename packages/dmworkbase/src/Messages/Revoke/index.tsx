import { Channel, ChannelInfo, ChannelTypePerson, WKSDK } from "wukongimjssdk"
import { MessageCell } from '../MessageCell'
import { MessageWrap } from '../../Service/Model'
import WKApp from '../../App'
import React from 'react'
import "./index.css"
import { ChannelInfoListener } from "wukongimjssdk"
import { I18nContext, t } from "../../i18n"
import {
    addImChannelInfoListener,
    fetchImChannelInfo,
    getImChannelInfo,
} from "../../im-runtime/channelRuntime"
import { canReeditRevokedMessage } from "./reeditableMessage"


export class RevokeCell extends MessageCell {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    channelInfoListener!:ChannelInfoListener
    private unsubscribeChannelInfoListener?: () => void

    componentDidMount() {
        super.componentDidMount()
        const { message } = this.props
        // 额外监听 revoker 的 channelInfo（撤回者可能与发送者不同）
        this.channelInfoListener = (channelInfo:ChannelInfo) => {
            if(channelInfo.channel.channelType === ChannelTypePerson && channelInfo.channel.channelID === message.revoker) {
                this.setState({})
            }
        }
        this.unsubscribeChannelInfoListener = addImChannelInfoListener(WKSDK.shared(), this.channelInfoListener)
    }

    componentWillUnmount() {
        super.componentWillUnmount()
        this.unsubscribeChannelInfoListener?.()
        this.unsubscribeChannelInfoListener = undefined
    }

    static tip(message: MessageWrap) {
        let name = t("base.revoke.you")
        let revoker = message.revoker
        if (revoker === WKApp.loginInfo.uid) {
            if (revoker !== message.fromUID) {
                let memberFromName = "--"
                if (message.from) {
                    memberFromName = message.from.title;
                } else {
                    void fetchImChannelInfo(WKSDK.shared(), new Channel(message.fromUID, ChannelTypePerson))
                }
                return t("base.revoke.revokedMemberMessageByYou", {
                    values: { member: memberFromName },
                })
            }
            return t("base.revoke.revokedMessage", { values: { name } })

        } else {
            const channel = new Channel(revoker ?? "", ChannelTypePerson)
            let channelInfo = getImChannelInfo(WKSDK.shared(), channel)
            if (channelInfo) {
                name = channelInfo.title
            } else {
                void fetchImChannelInfo(WKSDK.shared(), channel)
                name = "--"
            }
            if (revoker !== message.fromUID) {
                return t("base.revoke.revokedMemberMessage", { values: { name } })
            }
            return t("base.revoke.revokedMessage", { values: { name } })
        }
    }

    render() {
        const { message, context } = this.props
        this.context.locale
        const canReedit = canReeditRevokedMessage(message, WKApp.loginInfo.uid)
        return <div className="wk-message-system wk-message-revoke">
            <span>{RevokeCell.tip(message)}</span>
            {canReedit ? <button
                type="button"
                className="wk-message-revoke-reedit"
                onClick={(event) => {
                    event.stopPropagation()
                    void context.reeditRevokedMessage(message)
                }}
            >
                {t("base.revoke.reedit")}
            </button> : null}
        </div>
    }
}
