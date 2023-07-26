import { MessageContent } from "wukongimjssdk"
import React from "react"
import WKApp from "../../App"
import MessageBase from "../Base"
import { MessageCell } from "../MessageCell"



export class GifContent extends MessageContent {
    width!: number
    height!: number
    url!: string
    decodeJSON(content: any) {
        this.width = content["width"] || 0
        this.height = content["height"] || 0
        this.url = content["url"] 
    }

    get conversationDigest() {
        return "[动图]"
    }
}


export class GifCell extends MessageCell {

    imageScale(orgWidth: number, orgHeight: number, maxWidth = 200, maxHeight = 200) {
        let actSize = { width: orgWidth, height: orgHeight };
        if (orgWidth > orgHeight) {//横图
            if (orgWidth > maxWidth) { // 横图超过最大宽度
                let rate = maxWidth / orgWidth; // 缩放比例
                actSize.width = maxWidth;
                actSize.height = orgHeight * rate;
            }
        } else if (orgWidth < orgHeight) { //竖图
            if (orgHeight > maxHeight) {
                let rate = maxHeight / orgHeight; // 缩放比例
                actSize.width = orgWidth * rate;
                actSize.height = maxHeight;
            }
        } else if (orgWidth === orgHeight) {
            if (orgWidth > maxWidth) {
                let rate = maxWidth / orgWidth; // 缩放比例
                actSize.width = maxWidth;
                actSize.height = orgHeight * rate;
            }
        }
        return actSize;
    }

    render() {
        const { message,context } = this.props
        const content = message.content as GifContent
        let scaleSize = this.imageScale(content.width, content.height, 150, 150);
        return <MessageBase message={message} context={context} hiddeBubble={true}>
            <div style={{ width: scaleSize.width, height: scaleSize.height }}>
                <img alt="" src={WKApp.dataSource.commonDataSource.getImageURL(content.url, { width: content.width, height: content.height })} style={{ borderRadius:'5px',width: scaleSize.width, height: scaleSize.height }} />
            </div>
        </MessageBase>
    }
}