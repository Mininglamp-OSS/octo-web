import { Channel, ChannelInfo, ChannelTypePerson, MessageContentType, MessageText, WKSDK } from "wukongimjssdk"
import { MessageCell } from '../MessageCell'
import { MessageWrap } from '../../Service/Model'
import WKApp from '../../App'
import React from 'react'
import "./index.css"
import { ChannelInfoListener } from "wukongimjssdk"
import { I18nContext, t } from "../../i18n"
import ConversationContext from "../../Components/Conversation/context"

/**
 * 从纲文 text + mention entities ({uid, offset, length}[]) 重建 @[uid:label] 草稿序列化格式。
 * restoreDraft → parseDraftToContent 仅能识别 @[uid:label] 模式，而发送消息里存的是
 * 纯显示文本（如 "hi @张三"）+ entities。此函数将二者合并为 draft 字符串。
 */
export function rebuildDraftText(
    text: string,
    entities: Array<{ uid: string; offset: number; length: number }>
): string {
    if (!entities || entities.length === 0) return text

    // 按 offset 排序，防止乱序
    const sorted = [...entities].sort((a, b) => a.offset - b.offset)
    let result = ''
    let cursor = 0
    for (const entity of sorted) {
        const { uid, offset, length } = entity
        if (offset < cursor || offset + length > text.length) continue
        // 追加 offset 前的纯文本
        result += text.slice(cursor, offset)
        // 追加 @[uid:label] 标记，label 从原文本中提取（跳过 offset 处的 '@' 字符）
        // entity 的 offset 指向 '@' 本身，length 包含 '@'；draft 序列化中 label 不含 '@'
        const label = text.slice(offset + 1, offset + length)
        result += `@[${uid}:${label}]`
        cursor = offset + length
    }
    result += text.slice(cursor)
    return result
}


export class RevokeCell extends MessageCell {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    channelInfoListener!:ChannelInfoListener

    componentDidMount() {
        super.componentDidMount()
        const { message } = this.props
        // 额外监听 revoker 的 channelInfo（撤回者可能与发送者不同）
        this.channelInfoListener = (channelInfo:ChannelInfo) => {
            if(channelInfo.channel.channelType === ChannelTypePerson && channelInfo.channel.channelID === message.revoker) {
                this.setState({})
            }
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)
    }

    componentWillUnmount() {
        super.componentWillUnmount()
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
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
                    WKSDK.shared().channelManager.fetchChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
                }
                return t("base.revoke.revokedMemberMessageByYou", {
                    values: { member: memberFromName },
                })
            }
            return t("base.revoke.revokedMessage", { values: { name } })

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
                return t("base.revoke.revokedMemberMessage", { values: { name } })
            }
            return t("base.revoke.revokedMessage", { values: { name } })
        }
    }

    /**
     * 判断是否展示「重新编辑」按钮：
     * - 必须是自己撤回的（revoker === 自己 uid）
     * - 且原始消息为文本类型
     */
    private canReEdit(): boolean {
        const { message } = this.props
        return (
            message.revoker === WKApp.loginInfo.uid &&
            message.fromUID === WKApp.loginInfo.uid &&
            message.contentType === MessageContentType.text
        )
    }

    /**
     * 点击「重新编辑」：将原文夹回输入框
     *
     * 注意：
     * 1. 如果消息被编辑过（remoteExtra.isEdit），展示的是编辑后的最终版本（contentEdit），与其他地方的逻辑一致
     * 2. 使用 restoreDraft，并将 content.mention.entities 重建为 @[uid:label] 草稿格式，
     *    确保 @mention 节点在恢复后仍可路由（而非退化为惰性文本）
     */
    private handleReEdit = () => {
        const { message } = this.props
        const conversationContext = this.props.context as ConversationContext
        if (!conversationContext?.restoreDraft) return

        // 与 Model.tsx parseMention 和 Messages/Text getRenderMessageText 一致：
        // 如果消息被编辑过，取 contentEdit；否则取原始 content
        const remoteExtra = (message.message as any)?.remoteExtra
        let textContent: MessageText
        if (remoteExtra?.isEdit && remoteExtra?.contentEdit) {
            textContent = remoteExtra.contentEdit as MessageText
        } else {
            textContent = message.content as MessageText
        }
        const rawText = textContent?.text ?? ''
        if (!rawText) return

        // 从 mention.entities ({uid, offset, length}[]) 重建 @[uid:label] 草稿序列化格式
        // 以便 restoreDraft → parseDraftToContent 能正确还原 mention 节点
        const entities: Array<{ uid: string; offset: number; length: number }> =
            (textContent as any)?.mention?.entities ?? []
        const draftText = rebuildDraftText(rawText, entities)
        conversationContext.restoreDraft(draftText)
    }

    render() {
        const { message } = this.props
        this.context.locale
        return (
            <div className="wk-revoke-row">
                <span className="wk-message-system">{RevokeCell.tip(message)}</span>
                {this.canReEdit() && (
                    <button
                        className="wk-revoke-reedit-btn"
                        onClick={this.handleReEdit}
                    >
                        {this.context.t("base.revoke.reEdit")}
                    </button>
                )}
            </div>
        )
    }
}
