import React from "react"
import MessageBase from "../Base"
import MessageTrail from "../Base/tail"
import { MessageCell } from "../MessageCell"
import MarkdownContent, { MarkdownImage } from "../Text/MarkdownContent"
import { RichTextBlock, RichTextBlockType, RichTextContent } from "./RichTextContent"
import "./index.css"

export { RichTextContent } from "./RichTextContent"

/**
 * RichText(=14) 图文混排消息（Phase 1：仅接收渲染）。
 *
 * 按 content blocks 数组顺序穿插渲染：
 *   - text  block：复用 MarkdownContent 管线，但 MVP 锁纯文本（enableMarkdown=false），
 *     避免 web 渲 markdown 而移动端不渲的跨端不一致；
 *   - image block：复用 MarkdownImage（Lightbox 大图预览 + url 安全校验）。
 *
 * 老端 fallback：未注册 type=14 的旧端落 UnknownCell（已有），本端注册后正常渲染。
 */
export class RichTextCell extends MessageCell {
    render() {
        const { message, context } = this.props
        const content = message.content as RichTextContent
        const blocks: RichTextBlock[] = content.content || []

        return (
            <MessageBase message={message} context={context}>
                <div className="wk-message-richtext">
                    {blocks.map((blk, i) => {
                        if (blk.type === RichTextBlockType.image) {
                            return (
                                <div
                                    key={`${message.clientMsgNo}-rt-img-${i}`}
                                    className="wk-message-richtext-image"
                                >
                                    <MarkdownImage src={blk.url} alt={blk.name} />
                                </div>
                            )
                        }
                        // text block（含未知 type 的前向兼容：有 text 则按文本渲染）
                        const text = blk.text || ""
                        if (text === "") {
                            return null
                        }
                        return (
                            <div
                                key={`${message.clientMsgNo}-rt-text-${i}`}
                                className="wk-message-richtext-text"
                            >
                                <MarkdownContent
                                    content={text}
                                    isSend={message.send}
                                    enableMarkdown={false}
                                />
                            </div>
                        )
                    })}
                    <MessageTrail message={message} />
                </div>
            </MessageBase>
        )
    }
}

export default RichTextCell
