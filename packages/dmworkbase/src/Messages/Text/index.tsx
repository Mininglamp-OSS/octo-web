import classNames from "classnames";
import React from "react";
import WKApp from "../../App";
import { Part, PartType } from "../../Service/Model";
import { isSafeUrl } from "../../Utils/security";
import MessageBase from "../Base";
import MessageHead from "../Base/head";
import MessageTrail from "../Base/tail";
import { MessageCell } from "../MessageCell";
import MarkdownContent, { type MentionInfo, type EmojiInfo } from "./MarkdownContent";
import MessageRow from "../../ui/message/MessageRow"
import ReplyBlock from "../../ui/message/ReplyBlock";
import TextContent from "../../ui/message/TextContent";
import { getTextMessageUI } from "../../bridge/message/useTextMessageUI";
import { isMessageSelectable } from "../../Service/messageSelection";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import "./index.css"

/**
 * 根据当前查看 Space 解析被引用消息发送者的「外部来源 Space 名」。
 *
 * 被引用消息 (`message.content.reply`) 的 msg-level 来源字段由
 * `Convert.toMessage` / `MergeforwardContent.mapToMessage` /
 * `patchSdkDecodeForExternalFields()`（SDK 内部 Reply.prototype.decode）
 * 以 snake_case 透传到 `Reply` 实例上。此处直接按 snake_case 读取，
 * 与消息头 `MessageBase` 的 resolve 调用保持一致。
 *
 * 返回空串表示：不展示 `@SpaceName` 后缀。
 */
function resolveReplySourceSpaceName(reply: any): string {
    if (!reply) return ""
    const { isExternal, sourceSpaceName } = resolveExternalForViewer({
        homeSpaceId: reply.from_home_space_id as string | undefined,
        homeSpaceName: reply.from_home_space_name as string | undefined,
        isExternalLegacy:
            reply.from_is_external === 1 || reply.from_is_external === true
                ? 1
                : 0,
        sourceSpaceNameLegacy: reply.from_source_space_name as
            | string
            | undefined,
        viewerSpaceId: WKApp.shared.currentSpaceId,
    })
    return isExternal && sourceSpaceName ? sourceSpaceName : ""
}


// 文本消息
// channelInfo 订阅逻辑已上移至 MessageCell base class，此处无需重复处理
export class TextCell extends MessageCell {

    constructor(props: any) {
        super(props)
    }

    getCommonText(k: number, part: Part) {
        const texts = part.text.split("\n")
        const { message } = this.props
        return <span key={`${message.clientMsgNo}-text-${k}`} className="wk-message-text-commontext">
            {
                texts.map((text, i) => {
                    return <span key={`${message.clientMsgNo}-common-${i}`} className="wk-message-text-richtext">{text}{i !== texts.length - 1 ? <br /> : undefined}</span>
                })
            }
        </span>
    }

    getMentionText(k: number, part: Part) {
        const { message,context } = this.props
        return <span onClick={()=>{
            if(part.data?.uid) {
                context.showUser(part.data?.uid)
            }
        }} key={`${message.clientMsgNo}-mention-${k}`} className={classNames("wk-message-text-richmention", message.send ? "wk-message-text-send" : "wk-message-text-recv")}>{part.text}</span>
    }

    getEmojiText(k: number, part: Part) {
        const { message } = this.props
        const emojiURL = WKApp.emojiService.getImage(part.text)
        return <span key={`${message.clientMsgNo}-emoji-${k}`} className="wk-message-text-richemoji">{emojiURL !== ""?<img alt="" src={emojiURL} />:part.text}</span>
    }

    getLinkText(k: number, part: Part) {
        const { message } = this.props
        let link = part.text
        if(link.indexOf("http") !== 0) {
            link = "http://" + link
        }
        if (!isSafeUrl(link)) {
            return <span key={`${message.clientMsgNo}-link-${k}`}>{part.text}</span>
        }
        return <a  key={`${message.clientMsgNo}-link-${k}`} href={link} target="__blank">{part.text}</a>
    }

    isLargeCustomEmoji(): boolean {
        const parts = this.props.message.parts
        const emojiParts = parts?.filter((p: Part) => p.type === PartType.emoji) ?? []
        const nonEmojiParts = parts?.filter((p: Part) => p.type !== PartType.emoji) ?? []
        if (emojiParts.length === 1 && nonEmojiParts.length === 0) {
            const token = emojiParts[0].text
            // 自定义表情（[xxx]）单发时放大显示。优先用服务端清单驱动的 isCustomEmoji；
            // 旧 mock/实现未提供时回退到历史的本地 custom_ 图路径判断。
            const emojiUrl = WKApp.emojiService.getImage(token)
            return WKApp.emojiService.isCustomEmoji?.(token) ?? !!(emojiUrl && emojiUrl.includes("/emoji/custom_"))
        }
        return false
    }

    getRenderMessageText() {
        const { message, context } = this.props

        // 流式消息：Markdown 渲染流式内容（带光标）
        if (message.streamOn) {
            return (
                <MarkdownContent
                    content={message.fullStreamContent}
                    isSend={message.send}
                    isStreaming={message.isStreaming}
                />
            )
        }

        // 从 parts 提取 mention 列表（name→uid）
        const parts = message.parts
        const mentions: MentionInfo[] = parts
            ?.filter((p: Part) => p.type === PartType.mention && p.data?.uid)
            .map((p: Part) => ({ name: p.text, uid: p.data.uid })) ?? []

        // 从 parts 提取 emoji 列表，过滤掉 emojiService 返回空 URL 的（未知 emoji）
        const emojis: EmojiInfo[] = parts
            ?.filter((p: Part) => p.type === PartType.emoji)
            .reduce((acc: EmojiInfo[], p: Part) => {
                const url = WKApp.emojiService.getImage(p.text)
                if (url && !acc.find((e) => e.key === p.text)) {
                    acc.push({ key: p.text, url })
                }
                return acc
            }, []) ?? []

        // content.text 是 SDK MessageText 实例的 text 属性（decodeJSON 里赋值）
        // fallback 到 parts 拼接（发送方消息 text 已由构造函数设置，一般不走这里）
        const rawContent = (message.message?.remoteExtra?.isEdit && message.message?.remoteExtra?.contentEdit)
            ? message.message.remoteExtra.contentEdit as any
            : message.content as any
        const plainText = rawContent?.text
            || parts?.map((p: Part) => p.text).join("")
            || ""

        // 判断是否「只有一个自定义表情」：仅有一个 emoji part，无其他内容，且是 custom_ 图片
        const emojiParts = parts?.filter((p: Part) => p.type === PartType.emoji) ?? []
        const nonEmojiParts = parts?.filter((p: Part) => p.type !== PartType.emoji) ?? []
        if (emojiParts.length === 1 && nonEmojiParts.length === 0) {
            const token = emojiParts[0].text
            const emojiUrl = WKApp.emojiService.getImage(token)
            // 自定义表情按清单判定(对服务端 CDN/绝对 url 同样生效),回退到旧的本地路径子串。
            const isCustom = WKApp.emojiService.isCustomEmoji?.(token) ?? !!(emojiUrl && emojiUrl.includes("/emoji/custom_"))
            if (isCustom && emojiUrl) {
                return (
                    <span className="wk-message-text-richemoji wk-message-text-richemoji--large">
                        <img alt={token} src={emojiUrl} width={120} height={120} />
                    </span>
                )
            }
        }

        return (
            <MarkdownContent
                content={plainText}
                isSend={message.send}
                mentions={mentions}
                onMentionClick={(uid) => context.showUser(uid)}
                emojis={emojis}
            />
        )
    }

    render() {
        const { message, context } = this.props

        // TODO: 后续改成 feature flag
        const useNewUI = true

        // 新 UI 实现
        if (useNewUI) {
            const selectionMode = context.editOn()
            const selectable = isMessageSelectable(message)
            const uiProps = getTextMessageUI(message, {
                selectionMode,
                showCheckbox: selectionMode && selectable,
                isSelected: selectable && !!message.checked,
                onSelect: selectable ? (selected) => context.checkeMessage(message.message, selected) : undefined,
            })

            return (
                <MessageRow 
                    {...uiProps.row}
                    onContextMenu={(event) => context.showContextMenus(message, event)}
                    isActive={context.isContextMenuOpen(message.message)}
                    onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
                    onSenderNameClick={() => context.showUser(message.fromUID)}
                >
                    <div>
                        {message?.content?.reply && (
                            <ReplyBlock
                                fromName={message.content.reply.fromName || ''}
                                digest={message.content.reply.content?.conversationDigest || ''}
                                sourceSpaceName={resolveReplySourceSpaceName(message.content.reply)}
                                onClick={() => context.locateMessage(message.content.reply.messageSeq)}
                            />
                        )}
                        <TextContent
                            {...uiProps.content}
                            onMentionClick={(uid) => context.showUser(uid)}
                        />
                    </div>
                </MessageRow>
            )
        }

        // 旧 UI 实现（保持向后兼容）
        const largeEmoji = this.isLargeCustomEmoji()
        const bubbleStyle = largeEmoji ? { background: "transparent", boxShadow: "none", padding: 0 } : undefined
        return <MessageBase message={message} context={context} bubbleStyle={bubbleStyle} onBubble={() => {
        }}>

            {
                message?.content.reply ? <div className={classNames("wk-message-text-reply",message.send?undefined:"wk-message-text-reply-recv")} onClick={()=>{
                    context.locateMessage( message?.content.reply.messageSeq)
                }}>
                    <div className="wk-message-text-reply-author">
                        <div className="wk-message-text-reply-authoravatar">
                            <img alt="" src={WKApp.shared.avatarUser(message.content.reply.fromUID)} style={{ width: "12px", height: "12px",borderRadius:"var(--wk-avatar-radius, 50%)" }} />
                        </div>
                        <div className="wk-message-text-reply-authorname">
                            {message.content.reply.fromName}
                            {/* dmwork-web#1069：外部成员的引用预览显示「@SpaceName」后缀，
                                与新 UI 的 ReplyBlock 保持一致（按当前查看 Space 相对渲染）。 */}
                            {(() => {
                                const src = resolveReplySourceSpaceName(message.content.reply)
                                return src ? <span className="wk-message-text-reply-space" title={`@${src}`}>@{src}</span> : null
                            })()}
                        </div>
                    </div>
                    <div className="wk-message-text-reply-content">
                        {message.content.reply.content?.conversationDigest}
                    </div>
                </div> : undefined
            }

            <div className="wk-message-text-content">
                {this.getRenderMessageText()}
                <MessageTrail message={message} />
            </div>
        </MessageBase>
    }
}
