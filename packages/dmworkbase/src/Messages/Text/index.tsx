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
import "./index.css"


// 文本消息
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
            const emojiUrl = WKApp.emojiService.getImage(emojiParts[0].text)
            return !!(emojiUrl && emojiUrl.includes("/emoji/custom_"))
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
        const rawContent = message.content as any
        const plainText = rawContent?.text
            || parts?.map((p: Part) => p.text).join("")
            || ""

        // 判断是否「只有一个自定义表情」：仅有一个 emoji part，无其他内容，且是 custom_ 图片
        const emojiParts = parts?.filter((p: Part) => p.type === PartType.emoji) ?? []
        const nonEmojiParts = parts?.filter((p: Part) => p.type !== PartType.emoji) ?? []
        if (emojiParts.length === 1 && nonEmojiParts.length === 0) {
            const emojiUrl = WKApp.emojiService.getImage(emojiParts[0].text)
            if (emojiUrl && emojiUrl.includes("/emoji/custom_")) {
                return (
                    <span className="wk-message-text-richemoji wk-message-text-richemoji--large">
                        <img alt={emojiParts[0].text} src={emojiUrl} width={120} height={120} />
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
                            <img alt="" src={WKApp.shared.avatarUser(message.content.reply.fromUID)} style={{ width: "12px", height: "12px",borderRadius:"50%" }} />
                        </div>
                        <div className="wk-message-text-reply-authorname">
                            {message.content.reply.fromName} 
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
