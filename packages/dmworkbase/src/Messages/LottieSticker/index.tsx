import { MessageContent } from "wukongimjssdk"
import React from "react"
import { MessageContentTypeConst } from "../../Service/Const"
import { MessageCell } from "../MessageCell"
import "@lottiefiles/lottie-player/dist/tgs-player"
import { t } from "../../i18n"
import MessageRow from "../../ui/message/MessageRow"
import { getStickerMessageUI } from "../../bridge/message/useStickerMessageUI"
import { isMessageSelectable } from "../../Service/messageSelection"
import { isBitmapStickerFormat } from "./format"
import "./index.css"

// 权威定义在 ./format.ts，此处 re-export 保持外部 import 兼容
// （EmojiToolbar 等消费方从 "../../Messages/LottieSticker" 引入）。
export { isBitmapStickerFormat }


export class LottieSticker extends MessageContent {
    url!: string
    category!: string
    placeholder!: string
    format!: string
    decodeJSON(content: any) {
        // 与 GifContent 对齐：防上游 double-stringify。空对象 fallback 保留默认空串。
        if (typeof content === "string") {
            try {
                content = JSON.parse(content)
            } catch {
                content = {}
            }
        }
        this.url = content?.["url"] || ""
        this.category = content?.["category"] || ""
        this.placeholder = content?.["placeholder"] || ""
        this.format = content?.["format"] || ""
    }
    get conversationDigest() {
        return t("base.message.digest.sticker")
    }
    encodeJSON() {
        return { url: this.url || "", category: this.category || "", placeholder: this.placeholder || "", format: this.format || "" }
    }
    get contentType() {
        return MessageContentTypeConst.lottieSticker
    }
}


declare global {
    namespace JSX {
        interface IntrinsicElements {
            "tgs-player": any
        }
    }
}


// 贴图消息不走 MessageBase 的气泡路径，而是与 image/file/video 一致地走
// MessageRow（bridge），保证发送人名字/头像/时间/实名徽章样式与普通消息统一。
// body 按 isBitmap 分流：png/gif/jpg/jpeg/webp 走 <img>，其余走 tgs-player。
export class LottieStickerCell extends MessageCell {

    render() {
        const { message, context } = this.props
        const ui = getStickerMessageUI(message)
        const selectionMode = context.editOn()
        const selectable = isMessageSelectable(message)
        return (
            <MessageRow
                {...ui.row}
                onContextMenu={(event) => context.showContextMenus(message.message, event)}
                isActive={context.isContextMenuOpen(message.message)}
                selectionMode={selectionMode}
                showCheckbox={selectionMode && selectable}
                isSelected={selectable && !!message.checked}
                onSelect={selectable ? (checked) => context.checkeMessage(message.message, checked) : undefined}
                onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
                onSenderNameClick={() => context.showUser(message.fromUID)}
            >
                <div className="wk-sticker-body">
                    {ui.isBitmap
                        ? <img className="wk-sticker-media" src={ui.url} alt="" />
                        : <tgs-player class="wk-sticker-media" autoplay loop mode="normal" src={ui.url}></tgs-player>
                    }
                </div>
            </MessageRow>
        )
    }
}
