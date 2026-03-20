import { MediaMessageContent, WKSDK, Task, TaskStatus } from "wukongimjssdk"
import React from "react"
import WKApp from "../../App"
import { MessageContentTypeConst } from "../../Service/Const"
import MessageBase from "../Base"
import { MessageCell } from "../MessageCell"
import Viewer from 'react-viewer';


export class ImageContent extends MediaMessageContent {
    width!: number
    height!: number
    url!: string
    imgData?: string
    caption?: string
    mentionUids?: string[]
    constructor(file?: File, imgData?: string, width?: number, height?: number, caption?: string, mentionUids?: string[]) {
        super()
        this.file = file
        this.imgData = imgData
        this.width = width || 0
        this.height = height || 0
        this.caption = caption
        this.mentionUids = mentionUids
    }
    decodeJSON(content: any) {
        this.width = content["width"] || 0
        this.height = content["height"] || 0
        this.url = content["url"] || ''
        this.caption = content["caption"] || ''
        this.mentionUids = content["mention_uids"] || []
        this.remoteUrl = this.url
    }
    encodeJSON() {
        const json: Record<string, unknown> = { "width": this.width || 0, "height": this.height || 0, "url": this.remoteUrl || "" }
        if (this.caption) {
            json["caption"] = this.caption
        }
        if (this.mentionUids && this.mentionUids.length > 0) {
            json["mention_uids"] = this.mentionUids
        }
        return json
    }
    get contentType() {
        return MessageContentTypeConst.image
    }
    get conversationDigest() {
        return "[图片]"
    }
}


interface ImageCellState {
    showPreview: boolean
    uploadProgress: number
    uploadStatus: TaskStatus | null
}

export class ImageCell extends MessageCell<any, ImageCellState> {
    private _taskListener = (task: Task) => {
        const { message } = this.props
        if (task.id !== message.clientMsgNo) return
        this.setState({ uploadProgress: task.progress(), uploadStatus: task.status })
    }

    constructor(props: any) {
        super(props)
        this.state = {
            showPreview: false,
            uploadProgress: 0,
            uploadStatus: null,
        }
    }

    componentDidMount() {
        const { message } = this.props
        const taskMgr = WKSDK.shared().taskManager as any
        const task: Task | undefined = taskMgr.taskMap?.get(message.clientMsgNo)
        if (task) {
            this.setState({ uploadProgress: task.progress(), uploadStatus: task.status })
        }
        WKSDK.shared().taskManager.addListener(this._taskListener)
    }

    componentWillUnmount() {
        WKSDK.shared().taskManager.removeListener(this._taskListener)
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

    getImageSrc(content: ImageContent) {
        if (content.url && content.url !== "") { // 等待发送的消息
            let downloadURL = WKApp.dataSource.commonDataSource.getImageURL(content.url, { width: content.width, height: content.height })
            if (downloadURL.indexOf("?") !== -1) {
                downloadURL += "&filename=image.png"
            } else {
                downloadURL += "?filename=image.png"
            }
            return downloadURL
        }
        return content.imgData
    }

    getImageElement() {
        const { message } = this.props
        const content = message.content as ImageContent
        let scaleSize = this.imageScale(content.width, content.height);
        return <img alt="" src={this.getImageSrc(content)} style={{ borderRadius: '5px', width: scaleSize.width, height: scaleSize.height }} />
    }

    render() {
        const { message, context } = this.props
        const { showPreview, uploadProgress, uploadStatus } = this.state
        const content = message.content as ImageContent
        let scaleSize = this.imageScale(content.width, content.height);
        const imageURL = this.getImageSrc(content) || ""

        const isUploading =
            uploadStatus !== null &&
            uploadStatus !== TaskStatus.success &&
            uploadStatus !== TaskStatus.fail &&
            uploadStatus !== TaskStatus.cancel

        const pct = Math.round(uploadProgress)

        return <MessageBase context={context} message={message}>
            <div style={{ cursor: isUploading ? "default" : "pointer" }}>
                <div style={{ position: "relative", width: scaleSize.width, height: scaleSize.height }}
                    onClick={() => { if (!isUploading) this.setState({ showPreview: !showPreview }) }}>
                    {this.getImageElement()}
                    {/* 上传进度覆盖层 */}
                    {isUploading && (
                        <div style={{
                            position: "absolute", inset: 0,
                            background: "rgba(0,0,0,0.45)",
                            borderRadius: 5,
                            display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            gap: 8,
                        }}>
                            <div style={{ width: "70%", height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${pct}%`, background: "#fff", borderRadius: 2, transition: "width 0.2s ease" }} />
                            </div>
                            <span style={{ color: "#fff", fontSize: 12 }}>{pct}%</span>
                        </div>
                    )}
                    {/* 上传失败覆盖层 */}
                    {uploadStatus === TaskStatus.fail && (
                        <div style={{
                            position: "absolute", inset: 0,
                            background: "rgba(0,0,0,0.5)",
                            borderRadius: 5,
                            display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            gap: 6,
                            cursor: "pointer",
                        }} onClick={(e) => {
                            e.stopPropagation()
                            const taskMgr = WKSDK.shared().taskManager as any
                            const task: Task | undefined = taskMgr.taskMap?.get(message.clientMsgNo)
                            task?.start()
                        }}>
                            <span style={{ color: "#fff", fontSize: 22 }}>⚠️</span>
                            <span style={{ color: "#fff", fontSize: 11 }}>上传失败，点击重试</span>
                        </div>
                    )}
                </div>
                {content.caption && (
                    <div className="wk-image-caption" style={{ maxWidth: scaleSize.width, marginTop: '4px', fontSize: '14px', color: 'var(--wk-text-item)', wordBreak: 'break-word' }}>
                        {content.caption}
                    </div>
                )}
            </div>
            <Viewer
                visible={showPreview}
                noImgDetails={true}
                downloadable={true}
                rotatable={false}
                changeable={false}
                showTotal={false}
                onMaskClick={() => { this.setState({ showPreview: false }); }}
                onClose={() => { this.setState({ showPreview: false }); }}
                images={[{ src: imageURL, alt: '', downloadUrl: imageURL }]}
            />
        </MessageBase>
    }
}