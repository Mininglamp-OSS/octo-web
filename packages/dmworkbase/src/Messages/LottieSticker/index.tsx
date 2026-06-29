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

export class LottieStickerCell extends MessageCell {


    render() {

        const { message, context } = this.props
        const content = message.content as LottieSticker
        const url = WKApp.dataSource.commonDataSource.getImageURL(content.url)
        // 按 format 分支渲染：tgs/lottie 用 tgs-player（内置动画贴纸），其余
        // 位图（gif/png/jpg/jpeg/webp，用户自定义贴纸）用 <img>。tgs-player 只能
        // 播放 Lottie，喂位图不显示，所以必须分流。
        const isLottie = (content.format || "").toLowerCase() === "tgs"
        return <MessageBase hiddeBubble={true} message={message} context={context} >
            {
                isLottie
                    ? <tgs-player style={{ width: "auto", height: "208px" }} autoplay loop mode="normal" src={url}></tgs-player>
                    : <img src={url} style={{ height: "208px", maxWidth: "208px", objectFit: "contain" }} alt="" />
            }
        </MessageBase>
    }
}
