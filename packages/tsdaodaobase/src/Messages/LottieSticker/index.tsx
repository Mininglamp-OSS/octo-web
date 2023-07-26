import { MessageContent } from "wukongimjssdk"
import React from "react"
import WKApp from "../../App"
import { MessageContentTypeConst } from "../../Service/Const"
import MessageBase from "../Base"
import { MessageCell } from "../MessageCell"
import "@lottiefiles/lottie-player/dist/tgs-player";



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

        return "[贴图]"
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
        return <MessageBase hiddeBubble={true} message={message} context={context} >
            <tgs-player style={{ width: "auto", height: "208px" }} autoplay loop mode="normal" src={url}></tgs-player>
        </MessageBase>
    }
}