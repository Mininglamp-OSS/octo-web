import { Channel, ChannelTypeGroup, ChannelTypePerson, WKSDK, Message, MessageContentType, MessageText } from "wukongimjssdk";
import React from "react";
import { Component, ReactNode } from "react";
import { ImageContent } from "../../Messages/Image";
import { FileContent } from "../../Messages/File/FileContent";
import { MessageContentTypeConst } from "../../Service/Const";
import MergeforwardContent from "../../Messages/Mergeforward";
import { dateFormat, getTimeStringAutoShort2 } from "../../Utils/time";
import WKAvatar, { isBot } from "../WKAvatar";
import AiBadge from "../AiBadge";
import WKViewQueueHeader from "../WKViewQueueHeader";
import WKApp from "../../App";
import { downloadFile } from "../../Utils/download";
import MarkdownContent from "../../Messages/Text/MarkdownContent";
import Lightbox from "yet-another-react-lightbox";
import Download from "yet-another-react-lightbox/plugins/download";
import "yet-another-react-lightbox/styles.css";

import "./index.css"


export interface MergeforwardMessageListProps {
    mergeforwardContent: MergeforwardContent
}

interface MergeforwardMessageListState {
    previewImgSrc: string | null
    previewImageContent: ImageContent | null
}

export default class MergeforwardMessageList extends Component<MergeforwardMessageListProps, MergeforwardMessageListState> {
    constructor(props: MergeforwardMessageListProps) {
        super(props)
        this.state = {
            previewImgSrc: null,
            previewImageContent: null,
        }
    }

    getTitle(content: MergeforwardContent) {
        if (content.channelType === ChannelTypeGroup) {
            return "群的聊天记录"
        }

        const names = content.users.map((v) => {
            return v.name
        })

        return `${names.join("、")}的聊天记录`

    }

    getTimeline(content: MergeforwardContent) {
        if (!content.msgs || content.msgs.length === 0) {
            return ""
        }
        if (content.msgs.length === 1) {
            const msg = content.msgs[0]
            return dateFormat(new Date(msg.timestamp * 1000), "yyyy-MM-dd")
        }
        const firstMsg = content.msgs[0]
        const lastMsg = content.msgs[content.msgs.length - 1]

        return `${dateFormat(new Date(firstMsg.timestamp * 1000), "yyyy-MM-dd")} ~ ${dateFormat(new Date(lastMsg.timestamp * 1000), "yyyy-MM-dd")}`
    }

    imageScale(orgWidth: number, orgHeight: number, maxWidth = 250, maxHeight = 250) {
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
    getImageSrc(content:ImageContent) {
        if (content.url && content.url !== "") { // 等待发送的消息
            return WKApp.dataSource.commonDataSource.getImageURL(content.url, { width: content.width, height: content.height })
        }
        return content.imgData
    }

    getFileURL(content: FileContent): string {
        if (content.url && content.url !== "") {
            const fileUrl = WKApp.dataSource.commonDataSource.getFileURL(content.url)
            if (fileUrl && !fileUrl.startsWith("http")) {
                return window.location.origin + "/" + fileUrl.replace(/^\//, "")
            }
            return fileUrl
        }
        return ""
    }

    private cachedRootStyle?: CSSStyleDeclaration

    private getRootStyle(): CSSStyleDeclaration {
        if (!this.cachedRootStyle) {
            this.cachedRootStyle = getComputedStyle(document.documentElement)
        }
        return this.cachedRootStyle
    }

    getFileExtColor(extension: string): string {
        const ext = (extension || "").toLowerCase()
        const style = this.getRootStyle()
        switch (ext) {
            case "pdf": return style.getPropertyValue("--wk-color-danger").trim() || "#EF4444"
            case "doc": case "docx": return style.getPropertyValue("--wk-color-info").trim() || "#3B82F6"
            case "xls": case "xlsx": return style.getPropertyValue("--wk-color-success").trim() || "#22C55E"
            case "ppt": case "pptx": return style.getPropertyValue("--wk-color-warning").trim() || "#F97316"
            case "zip": case "rar": case "7z": return style.getPropertyValue("--wk-color-caution").trim() || "#EAB308"
            default: return style.getPropertyValue("--wk-text-tertiary").trim() || "#9CA3AF"
        }
    }

    formatFileSize(bytes: number): string {
        if (bytes <= 0) return "0 B"
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    }

    getMsgContent(msg:Message) {
        if (msg.contentType === MessageContentType.text) {
            const text = (msg.content as MessageText).text ?? ""
            return <MarkdownContent content={text} isSend={false} />
        }
        if(msg.contentType === MessageContentType.image) {
           const imageContent = msg.content as ImageContent
           const size = this.imageScale(imageContent.width,imageContent.height)
           const src = this.getImageSrc(imageContent) || ""

           return <img
               style={{"width":`${size.width}px`,"height":`${size.height}px`,borderRadius:"var(--wk-r-xs, 4px)",cursor:"pointer"}}
               src={src}
               onClick={() => this.setState({ previewImgSrc: src, previewImageContent: imageContent })}
           />
        }
        if (msg.contentType === MessageContentTypeConst.file) {
            const fileContent = msg.content as FileContent
            const url = this.getFileURL(fileContent)
            const ext = (fileContent.extension || "").toUpperCase()
            const iconBg = this.getFileExtColor(fileContent.extension)
            return (
                <div
                    className={`wk-mergeforward-file${url ? " wk-mergeforward-file--clickable" : ""}`}
                    onClick={async () => {
                        if (!url) return
                        await downloadFile(url, fileContent.name || "file")
                    }}
                >
                    <div className="wk-mergeforward-file__icon" style={{ backgroundColor: iconBg }}>
                        <span className="wk-mergeforward-file__icon-label">{ext || "FILE"}</span>
                    </div>
                    <div className="wk-mergeforward-file__info">
                        <div className="wk-mergeforward-file__name" title={fileContent.name}>
                            {fileContent.name || "unknown file"}
                        </div>
                        <div className="wk-mergeforward-file__size">
                            {this.formatFileSize(fileContent.size)}
                        </div>
                    </div>
                </div>
            )
        }
        return msg.content.conversationDigest
    }

    render(): ReactNode {
        const { mergeforwardContent } = this.props
        const { previewImgSrc, previewImageContent } = this.state
        return <><div className="wk-mergeforwardmessagelist">
            <div className="wk-mergeforwardmessagelist-header">
                <WKViewQueueHeader hideBack={true} title={this.getTitle(mergeforwardContent)}></WKViewQueueHeader>
            </div>
            <div className="wk-mergeforwardmessagelist-content">
                <div className="wk-mergeforwardmessagelist-content-timeline">
                    {this.getTimeline(mergeforwardContent)}
                </div>
                <div className="wk-mergeforwardmessagelist-content-msgs">
                    {
                        mergeforwardContent.msgs.map((m,i) => {
                            const fromChannel = new Channel(m.fromUID, ChannelTypePerson)
                            let fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(fromChannel)
                            if(!fromChannelInfo) {
                                WKSDK.shared().channelManager.fetchChannelInfo(fromChannel)
                            }
                            let showAvatar = true
                            if(i > 0) {
                                showAvatar = mergeforwardContent.msgs[i-1].fromUID !== m.fromUID
                            }
                            return <div className="wk-mergeforwardmessagelist-content-msg" key={m.messageID}>
                                <div className="wk-mergeforwardmessagelist-content-msg-avatar">
                                    {
                                        showAvatar?<WKAvatar channel={new Channel(m.fromUID, ChannelTypePerson)}></WKAvatar>:undefined
                                    }
                                </div>
                                <div className="wk-mergeforwardmessagelist-content-msg-info">
                                    <div className="wk-mergeforwardmessagelist-content-msg-info-first">
                                        <div className="wk-mergeforwardmessagelist-content-msg-info-first-name">
                                            {fromChannelInfo?.title}
                                            {isBot(m.fromUID) && <AiBadge size="small" />}
                                        </div>
                                        <div className="wk-mergeforwardmessagelist-content-msg-info-first-time">
                                                {getTimeStringAutoShort2(m.timestamp*1000,true)}
                                        </div>
                                    </div>
                                    <div className="wk-mergeforwardmessagelist-content-msg-info-second">
                                           <div className="wk-mergeforwardmessagelist-content-msg-info-second-msgcontent">
                                           {
                                               this.getMsgContent(m)
                                            }
                                           </div>
                                    </div>
                                </div>
                            </div>
                        })
                    }

                </div>
            </div>
        </div>
        <Lightbox
            open={!!previewImgSrc}
            close={() => this.setState({ previewImgSrc: null, previewImageContent: null })}
            slides={previewImgSrc ? [{ src: previewImgSrc, alt: "" }] : []}
            plugins={[Download]}
            download={{ download: ({ slide }) => {
                if (slide?.src) {
                    const name = previewImageContent?.name || "image.png"
                    downloadFile(slide.src, name)
                }
            }}}
            carousel={{ finite: true }}
            controller={{ closeOnBackdropClick: true }}
            render={{
                buttonPrev: () => null,
                buttonNext: () => null,
            }}
        />
        </>
    }
}