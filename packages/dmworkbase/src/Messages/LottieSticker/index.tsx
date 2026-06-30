import { MessageContent } from "wukongimjssdk"
import React from "react"
import WKApp from "../../App"
import { MessageContentTypeConst } from "../../Service/Const"
import MessageBase from "../Base"
import { MessageCell } from "../MessageCell"
import "@lottiefiles/lottie-player/dist/tgs-player";
import { t } from "../../i18n"



export class LottieSticker extends MessageContent {
    url!: string
    category!: string
    placeholder!: string
    format!: string
    decodeJSON(content: any) {
        this.url = content["url"] || ""
        this.category = content["category"] || ""
        this.placeholder = content["placeholder"] || ""
        this.format = content["format"] || ""
    }
    get conversationDigest() {

        return t("base.message.digest.sticker")
    }
    encodeJSON() {
        
        return {url:this.url||"",category:this.category||"",placeholder:this.placeholder||"",format:this.format||""}
    }
    get contentType() {
        return MessageContentTypeConst.lottieSticker
    }
    
}


declare global {
    namespace JSX {
        interface IntrinsicElements {
            "tgs-player": any;
        }
    }
}

// 已知位图贴纸格式 → 用 <img>；其余(含空/未知/tgs)一律走 <tgs-player>。历史贴纸
// 消息在 format 字段出现前发送，format 解码默认空串，本质是 Lottie，必须 fail-safe
// 到 tgs-player —— 否则会把 .tgs 喂进 <img>，历史聊天里的贴纸全裂(PR#496 review)。
const BITMAP_STICKER_FORMATS = new Set(["gif", "png", "jpg", "jpeg", "webp"])
export function isBitmapStickerFormat(format: string | undefined | null): boolean {
    return BITMAP_STICKER_FORMATS.has((format || "").toLowerCase())
}

export class LottieStickerCell extends MessageCell {


    render() {

        const { message, context } = this.props
        const content = message.content as LottieSticker
        const url = WKApp.dataSource.commonDataSource.getImageURL(content.url)
        const isBitmap = isBitmapStickerFormat(content.format)
        return <MessageBase hiddeBubble={true} message={message} context={context} >
            {
                isBitmap
                    ? <img src={url} style={{ height: "208px", maxWidth: "208px", objectFit: "contain" }} alt="" />
                    : <tgs-player style={{ width: "auto", height: "208px" }} autoplay loop mode="normal" src={url}></tgs-player>
            }
        </MessageBase>
    }
}
