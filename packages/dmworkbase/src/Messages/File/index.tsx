import React from "react"
import "./index.css"
import { MessageCell } from "../MessageCell"
import MessageBase from "../Base"
import WKApp from "../../App"
import { FileContent } from "./FileContent"
import { WKSDK, Task, TaskStatus } from "wukongimjssdk"

export { FileContent } from "./FileContent"

function formatFileSize(bytes: number): string {
    if (bytes <= 0) return "0 B"
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getFileIconInfo(extension: string): { color: string; label: string } {
    const ext = (extension || "").toLowerCase()
    switch (ext) {
        case "pdf":
            return { color: "#EF4444", label: "PDF" }
        case "doc":
        case "docx":
            return { color: "#3B82F6", label: "DOC" }
        case "xls":
        case "xlsx":
            return { color: "#22C55E", label: "XLS" }
        case "ppt":
        case "pptx":
            return { color: "#F97316", label: "PPT" }
        case "zip":
        case "rar":
        case "7z":
        case "tar":
        case "gz":
            return { color: "#EAB308", label: "ZIP" }
        case "mp3":
        case "wav":
        case "flac":
        case "aac":
            return { color: "#A855F7", label: "MP3" }
        case "mp4":
        case "avi":
        case "mov":
        case "mkv":
            return { color: "#EC4899", label: "MP4" }
        case "png":
        case "jpg":
        case "jpeg":
        case "gif":
        case "bmp":
        case "webp":
            return { color: "#14B8A6", label: "IMG" }
        case "txt":
        case "md":
            return { color: "#6B7280", label: "TXT" }
        default:
            return { color: "#9CA3AF", label: "FILE" }
    }
}

function isPreviewable(extension: string): boolean {
    const ext = (extension || "").toLowerCase()
    return ["pdf", "png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext)
}

function isSafeURL(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")
}

const SMALL_FILE_THRESHOLD = 1024 * 1024 // 1MB 以下不显示进度条

interface FileCellState {
    downloading: boolean
    uploadProgress: number       // 0~1
    uploadStatus: TaskStatus | null
}

export class FileCell extends MessageCell<any, FileCellState> {
    private _taskListener = (task: Task) => {
        const { message } = this.props
        if (task.id !== message.clientMsgNo) return
        this.setState({
            uploadProgress: task.progress(),
            uploadStatus: task.status,
        })
    }

    constructor(props: any) {
        super(props)
        this.state = {
            downloading: false,
            uploadProgress: 0,
            uploadStatus: null,
        }
    }

    componentDidMount() {
        const { message } = this.props
        const content = message.content as FileContent
        // 小文件不显示进度，跳过订阅
        if (content.size >= SMALL_FILE_THRESHOLD) {
            // 拿初始 task 状态（taskMap 为 private，用 any 访问）
            const taskMgr = WKSDK.shared().taskManager as any
            const task: Task | undefined = taskMgr.taskMap?.get(message.clientMsgNo)
            if (task) {
                this.setState({ uploadProgress: task.progress(), uploadStatus: task.status })
            }
            WKSDK.shared().taskManager.addListener(this._taskListener)
        }
    }

    componentWillUnmount() {
        WKSDK.shared().taskManager.removeListener(this._taskListener)
    }

    getFileURL(content: FileContent): string {
        if (content.url && content.url !== "") {
            const fileUrl = WKApp.dataSource.commonDataSource.getFileURL(content.url)
            // Ensure we have an absolute URL
            if (fileUrl && !fileUrl.startsWith("http")) {
                return window.location.origin + "/" + fileUrl.replace(/^\//, "")
            }
            return fileUrl
        }
        return ""
    }

    handleDownload = () => {
        const { message } = this.props
        const content = message.content as FileContent
        const url = this.getFileURL(content)
        if (!url || !isSafeURL(url)) return

        try {
            const a = document.createElement("a")
            a.href = url
            a.download = content.name || "file"
            a.target = "_blank"
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
        } catch {
            alert("文件下载失败")
        }
    }

    handlePreview = () => {
        const { message } = this.props
        const content = message.content as FileContent
        const url = this.getFileURL(content)
        if (!url || !isSafeURL(url)) return

        try {
            window.open(url, "_blank")
        } catch {
            alert("文件预览失败")
        }
    }

    render() {
        const { message, context } = this.props
        const content = message.content as FileContent
        const iconInfo = getFileIconInfo(content.extension)
        const canPreview = isPreviewable(content.extension)
        const { uploadProgress, uploadStatus } = this.state

        const isUploading =
            content.size >= SMALL_FILE_THRESHOLD &&
            uploadStatus !== null &&
            uploadStatus !== TaskStatus.success &&
            uploadStatus !== TaskStatus.fail &&
            uploadStatus !== TaskStatus.cancel

        const isFailed =
            content.size >= SMALL_FILE_THRESHOLD &&
            uploadStatus === TaskStatus.fail

        // 上传中：显示进度条
        if (isUploading) {
            const pct = Math.round(uploadProgress)
            return (
                <MessageBase context={context} message={message}>
                    <div className="wk-message-file wk-message-file--uploading">
                        <div className="wk-message-file-icon" style={{ backgroundColor: iconInfo.color }}>
                            <span className="wk-message-file-icon-label">{iconInfo.label}</span>
                        </div>
                        <div className="wk-message-file-info">
                            <div className="wk-message-file-name" title={content.name}>
                                {content.name || "上传中…"}
                            </div>
                            <div className="wk-message-file-progress-bar">
                                <div className="wk-message-file-progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="wk-message-file-progress-text">{pct}%</div>
                        </div>
                    </div>
                </MessageBase>
            )
        }

        // 上传失败：显示失败提示 + 重试按钮
        if (isFailed) {
            return (
                <MessageBase context={context} message={message}>
                    <div className="wk-message-file wk-message-file--failed">
                        <div className="wk-message-file-icon" style={{ backgroundColor: "#EF4444" }}>
                            <span className="wk-message-file-icon-label">!</span>
                        </div>
                        <div className="wk-message-file-info">
                            <div className="wk-message-file-name" title={content.name}>
                                {content.name || "上传失败"}
                            </div>
                            <div className="wk-message-file-meta">
                                <span style={{ color: "#EF4444" }}>上传失败</span>
                            </div>
                        </div>
                        <div className="wk-message-file-actions">
                            <div className="wk-message-file-action" title="重试" onClick={() => {
                                const taskMgr = WKSDK.shared().taskManager as any
                                const task: Task | undefined = taskMgr.taskMap?.get(message.clientMsgNo)
                                task?.start()
                            }}>
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1 4 1 10 7 10" />
                                    <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </MessageBase>
            )
        }

        return (
            <MessageBase context={context} message={message}>
                <div>
                    <div className="wk-message-file">
                        <div className="wk-message-file-icon" style={{ backgroundColor: iconInfo.color }}>
                            <span className="wk-message-file-icon-label">{iconInfo.label}</span>
                        </div>
                        <div className="wk-message-file-info">
                            <div className="wk-message-file-name" title={content.name}>
                                {content.name || "未知文件"}
                            </div>
                            <div className="wk-message-file-meta">
                                <span className="wk-message-file-size">{formatFileSize(content.size)}</span>
                                {content.extension && (
                                    <span className="wk-message-file-ext">{content.extension.toUpperCase()}</span>
                                )}
                            </div>
                        </div>
                        <div className="wk-message-file-actions">
                            {canPreview && (
                                <div className="wk-message-file-action" title="预览" onClick={this.handlePreview}>
                                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                        <circle cx="12" cy="12" r="3" />
                                    </svg>
                                </div>
                            )}
                            <div className="wk-message-file-action" title="下载" onClick={this.handleDownload}>
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                            </div>
                        </div>
                    </div>
                    {content.caption && (
                        <div className="wk-message-file-caption">
                            {content.caption}
                        </div>
                    )}
                </div>
            </MessageBase>
        )
    }
}
