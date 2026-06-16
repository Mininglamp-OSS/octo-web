import { MessageContent, WKSDK, Task, TaskStatus } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import React from "react";
import WKApp from "../../App";
import MessageBase from "../Base";
import { MessageCell } from "../MessageCell";
import MessageRow from "../../ui/message/MessageRow";
import VideoContentUI from "../../ui/message/VideoContent"
import { getMessageRow } from "../../bridge/message/useMessageRow"
import { isMessageSelectable } from "../../Service/messageSelection"
import { I18nContext, t } from "../../i18n"
import "./index.css"

const SMALL_FILE_THRESHOLD = 1024 * 1024 // 1MB 以下不显示进度覆盖层

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
        return t("base.video.digest")
    }

}

/** task 自身支持的重试接口（MediaMessageUploadTask 实现） */
interface RestartableTask extends Task {
    restart(): Promise<void>;
}

interface VideoCellState {
    playProgress: number    // 播放进度（秒）
    uploadProgress: number  // 上传进度 0~100 整数百分比
    uploadStatus: TaskStatus | null
}

export class VideoCell extends MessageCell<any, VideoCellState> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    private _task?: RestartableTask

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
        super.componentDidMount()
        const { message } = this.props
        // 小文件（<1MB）不显示进度，跳过订阅
        const fileSize = (message.content as any).file?.size ?? 0
        if (fileSize < SMALL_FILE_THRESHOLD) return
        WKSDK.shared().taskManager.addListener(this._taskListener)
        const found = ((WKSDK.shared().taskManager as any).taskMap as Map<string, Task> | undefined)
            ?.get(message.clientMsgNo) as RestartableTask | undefined
        if (found) {
            this._task = found
            this.setState({ uploadProgress: found.progress(), uploadStatus: found.status })
        }
    }

    componentWillUnmount() {
        super.componentWillUnmount()
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

    videoScale(orgWidth: number, orgHeight: number, maxWidth = 660, maxHeight = 224) {
        let actSize = { width: orgWidth, height: orgHeight };
        // 视频优先限制高度 (设计稿要求 max-height: 224px)
        if (orgHeight > maxHeight) {
            let rate = maxHeight / orgHeight;
            actSize.height = maxHeight;
            actSize.width = orgWidth * rate;
        }
        // 宽度也不能超过 maxWidth
        if (actSize.width > maxWidth) {
            let rate = maxWidth / actSize.width;
            actSize.width = maxWidth;
            actSize.height = actSize.height * rate;
        }
        return actSize;
    }
    render() {
        const { message, context } = this.props
        const { playProgress, uploadProgress, uploadStatus } = this.state
        const content = message.content as VideoContent
        const actSize = this.videoScale(content.width, content.height)

        // 新 UI 实现
        const useNewUI = true
        if (useNewUI) {
            const rowProps = getMessageRow(message)
            const selectionMode = context.editOn()
            const selectable = isMessageSelectable(message)
            const src = WKApp.dataSource.commonDataSource.getFileURL(content.url)
            const coverSrc = WKApp.dataSource.commonDataSource.getImageURL(content.cover)
            const isUploading =
                uploadStatus !== null &&
                uploadStatus !== TaskStatus.success &&
                uploadStatus !== TaskStatus.fail &&
                uploadStatus !== TaskStatus.cancel
            const pct = Math.round(uploadProgress)

            return (
                <MessageRow
                    {...rowProps}
                    onContextMenu={(event) => context.showContextMenus(message, event)}
                    isActive={context.isContextMenuOpen(message.message)}
                    selectionMode={selectionMode}
                    showCheckbox={selectionMode && selectable}
                    isSelected={selectable && !!message.checked}
                    onSelect={selectable ? (selected) => context.checkeMessage(message.message, selected) : undefined}
                    onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
                    onSenderNameClick={() => context.showUser(message.fromUID)}
                >
                    <div style={{ position: 'relative' }}>
                        <VideoContentUI
                            src={src}
                            coverSrc={coverSrc}
                            width={content.width}
                            height={content.height}
                            duration={content.second}
                        />
                        {/* 上传进度覆盖层（保持原有逻辑） */}
                        {isUploading && (
                            <div style={{
                                position: "absolute", inset: 0,
                                background: "rgba(0,0,0,0.5)",
                                display: "flex", flexDirection: "column",
                                alignItems: "center", justifyContent: "center",
                                gap: 8, borderRadius: 'var(--wk-r-lg)',
                            }}>
                                <div style={{ width: "70%", height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${pct}%`, background: "#fff", borderRadius: 2, transition: "width 0.2s ease" }} />
                                </div>
                                <span style={{ color: "#fff", fontSize: 12 }}>{pct}%</span>
                            </div>
                        )}
                        {uploadStatus === TaskStatus.fail && (
                            <div style={{
                                position: "absolute", inset: 0,
                                background: "rgba(0,0,0,0.55)",
                                display: "flex", flexDirection: "column",
                                alignItems: "center", justifyContent: "center",
                                gap: 6, cursor: "pointer",
                                borderRadius: 'var(--wk-r-lg)',
                            }} onClick={(e) => {
                                e.stopPropagation()
                                if (!this._task) {
                                    Toast.warning(this.context.t("base.messageFile.uploadTaskExpired"))
                                    return
                                }
                                this._task.restart()
                            }}>
                                <span style={{ color: "#fff", fontSize: 22 }}>⚠️</span>
                                <span style={{ color: "#fff", fontSize: 11 }}>{this.context.t("base.video.uploadFailedRetry")}</span>
                            </div>
                        )}
                    </div>
                </MessageRow>
            )
        }

        // 旧 UI 实现（保持向后兼容）
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
                    }} onClick={(e) => {
                        e.stopPropagation()
                        if (!this._task) {
                            Toast.warning(this.context.t("base.messageFile.uploadTaskExpired"))
                            return
                        }
                        this._task.restart()
                    }}>
                        <span style={{ color: "#fff", fontSize: 22 }}>⚠️</span>
                        <span style={{ color: "#fff", fontSize: 11 }}>{this.context.t("base.video.uploadFailedRetry")}</span>
                    </div>
                )}
            </div>
        </MessageBase>
    }
}
