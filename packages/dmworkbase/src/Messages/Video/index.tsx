import { MessageContent, WKSDK, Task, TaskStatus } from "wukongimjssdk";
import React from "react";
import WKApp from "../../App";
import MessageBase from "../Base";
import { MessageCell } from "../MessageCell";
import "./index.css"

export class VideoContent extends MessageContent {
    url!: string  // 小视频下载地址
    cover!: string // 小视频封面图片下载地址
    size: number = 0 // 小视频大小 单位byte
    width!: number // 小视频宽度
    height!: number // 小视频高度
    second!: number // 小视频秒长

    decodeJSON(content: any) {
        this.url = content["url"] || ""
        this.cover = content["cover"] || ""
        this.size = content["size"] || 0
        this.width = content["width"] || 0
        this.height = content["height"] || 0
        this.second = content["second"] || 0
    }

    encodeJSON() {
        return { "url": this.url || "", "cover": this.cover || "", "size": this.size || 0,"width":this.width||0,"height":this.height||0,"second":this.second||0 }
    }


    get conversationDigest() {
        return "[小视频]"
    }

}

interface VideoCellState {
    playProgress: number    // 播放进度（秒）
    uploadProgress: number  // 上传进度 0~1
    uploadStatus: TaskStatus | null
}

export class VideoCell extends MessageCell<any, VideoCellState> {
    private _taskListener = (task: Task) => {
        const { message } = this.props
        if (task.id !== message.clientMsgNo) return
        this.setState({ uploadProgress: task.progress(), uploadStatus: task.status })
    }

    constructor(props: any) {
        super(props)
        this.state = {
            playProgress: 0,
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

    secondFormat(second: number): string {

        const minute = parseInt(`${( second / 60)}`)
        const realSecond = parseInt(`${second % 60}`)

        let minuteFormat = ""
        if (minute > 9) {
            minuteFormat = `${minute}`
        } else {
            minuteFormat = `0${minute}`
        }

        let secondFormat = ""
        if (realSecond > 9) {
            secondFormat = `${realSecond}`
        } else {
            secondFormat = `0${realSecond}`
        }

        return `${minuteFormat}:${secondFormat}`
    }

    videoScale(orgWidth: number, orgHeight: number, maxWidth = 380, maxHeight = 380) {
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
        const { message, context } = this.props
        const { playProgress, uploadProgress, uploadStatus } = this.state
        const content = message.content as VideoContent
        const actSize = this.videoScale(content.width, content.height)

        const isUploading =
            uploadStatus !== null &&
            uploadStatus !== TaskStatus.success &&
            uploadStatus !== TaskStatus.fail &&
            uploadStatus !== TaskStatus.cancel

        const pct = Math.round(uploadProgress)

        return <MessageBase hiddeBubble={true} message={message} context={context}>
            <div className="wk-message-video" style={{ width: actSize.width, height: '100%', position: "relative" }}>
                <div className="wk-message-video-content">
                    <span className="wk-message-video-content-time">{this.secondFormat(content.second - playProgress)}</span>
                    <div className="wk-message-video-content-video">
                        <video poster={WKApp.dataSource.commonDataSource.getImageURL(content.cover)} width={actSize.width} height={actSize.height} controls onTimeUpdate={(evet) => {
                            const video = evet.target as HTMLVideoElement
                            this.setState({ playProgress: video.currentTime })
                        }} onEnded={() => {
                            this.setState({ playProgress: 0 })
                        }}>
                            <source src={WKApp.dataSource.commonDataSource.getFileURL(content.url)} type="video/mp4" />
                        </video>
                    </div>
                </div>

                {/* 上传进度覆盖层 */}
                {isUploading && (
                    <div style={{
                        position: "absolute", inset: 0,
                        background: "rgba(0,0,0,0.5)",
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
                        background: "rgba(0,0,0,0.55)",
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        gap: 6,
                        cursor: "pointer",
                    }} onClick={() => {
                        const taskMgr = WKSDK.shared().taskManager as any
                        const task: Task | undefined = taskMgr.taskMap?.get(message.clientMsgNo)
                        task?.start()
                    }}>
                        <span style={{ color: "#fff", fontSize: 22 }}>⚠️</span>
                        <span style={{ color: "#fff", fontSize: 11 }}>上传失败，点击重试</span>
                    </div>
                )}
            </div>
        </MessageBase>
    }
}