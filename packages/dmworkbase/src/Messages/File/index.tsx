import React from "react"
import "./index.css"
import { MessageCell } from "../MessageCell"
import MessageBase from "../Base"
import WKApp from "../../App"
import { FileContent } from "./FileContent"
import { downloadFile, BLOB_DOWNLOAD_SIZE_LIMIT, fallbackAnchorDownload } from "../../Utils/download"
import { WKSDK, Task, TaskStatus } from "wukongimjssdk"
import { Toast } from "@douyinfe/semi-ui"
import WKModal from "../../Components/WKModal"
import MarkdownContent from "../Text/MarkdownContent"

export { FileContent } from "./FileContent"

export function formatFileSize(bytes: number): string {
    if (bytes <= 0) return "0 B"
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function getFileIconInfo(extension: string, name?: string): { color: string; label: string } {
    const ext = getExtension(extension, name)
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

function getExtension(extension: string, name?: string): string {
    const ext = (extension || "").toLowerCase()
    if (ext) return ext
    // fallback: extract from filename
    if (name) {
        const dot = name.lastIndexOf(".")
        if (dot >= 0) return name.substring(dot + 1).toLowerCase()
    }
    return ""
}

function isPreviewable(extension: string, name?: string): boolean {
    const ext = getExtension(extension, name)
    return ["pdf", "png", "jpg", "jpeg", "gif", "bmp", "webp", "md", "txt"].includes(ext)
}

function isTextFile(extension: string, name?: string): boolean {
    const ext = getExtension(extension, name)
    return ["md", "txt"].includes(ext)
}

function isSafeURL(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")
}

const SMALL_FILE_THRESHOLD = 1024 * 1024 // 1MB 以下不显示进度条

/** task 自身支持的重试接口（MediaMessageUploadTask 实现） */
interface RestartableTask extends Task {
    restart(): Promise<void>;
}

interface FileCellState {
    uploadProgress: number       // 0~100 整数百分比
    uploadStatus: TaskStatus | null
    textPreviewVisible: boolean
    textPreviewContent: string
    textPreviewName: string
    textPreviewExt: string
}

export class FileCell extends MessageCell<any, FileCellState> {
    private _task?: RestartableTask

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
            uploadProgress: 0,
            uploadStatus: null,
            textPreviewVisible: false,
            textPreviewContent: "",
            textPreviewName: "",
            textPreviewExt: "",
        }
    }

    componentDidMount() {
        const { message } = this.props
        const content = message.content as FileContent
        // 小文件不显示进度，跳过订阅
        if (content.size >= SMALL_FILE_THRESHOLD) {
            // taskManager 通过 addListener 订阅；初始 task 状态通过首次回调获取
            WKSDK.shared().taskManager.addListener(this._taskListener)
            // 存 task 引用供重试使用（addTask 时 task 已调 start，此处仅读取）
            const allListeners = (WKSDK.shared().taskManager as any).taskMap as Map<string, Task> | undefined
            const found = allListeners?.get(message.clientMsgNo) as RestartableTask | undefined
            if (found) {
                this._task = found
                this.setState({ uploadProgress: found.progress(), uploadStatus: found.status })
            }
        }
    }

    componentWillUnmount() {
        WKSDK.shared().taskManager.removeListener(this._taskListener)
    }

    getFileURL(content: FileContent): string {
        const rawUrl = content.url || content.remoteUrl || ""
        if (rawUrl !== "") {
            const fileUrl = WKApp.dataSource.commonDataSource.getFileURL(rawUrl)
            // Ensure we have an absolute URL
            if (fileUrl && !fileUrl.startsWith("http")) {
                return window.location.origin + "/" + fileUrl.replace(/^\//, "")
            }
            return fileUrl
        }
        return ""
    }

    handleDownload = async () => {
        const { message } = this.props
        const content = message.content as FileContent
        const url = this.getFileURL(content)
        if (!url || !isSafeURL(url)) return

        try {
            // Text-file path: three-layer size guard, keep charset conversion logic
            if (isTextFile(content.extension, content.name)) {
                // Layer 1: Pre-check with known file size
                if (content.size && content.size > BLOB_DOWNLOAD_SIZE_LIMIT) {
                    fallbackAnchorDownload(url, content.name || "file")
                    return
                }
                // Text files: fetch and decode as UTF-8 to avoid CDN charset issues
                const resp = await fetch(url)
                if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
                // Layer 2: Content-Length check (catches oversized files when content.size is 0)
                const cl = resp.headers.get("Content-Length")
                if (cl && parseInt(cl, 10) > BLOB_DOWNLOAD_SIZE_LIMIT) {
                    if (resp.body) resp.body.cancel().catch(() => {})
                    fallbackAnchorDownload(url, content.name || "file")
                    return
                }
                // Layer 3: Streaming byte-count enforcement
                let textBuf: Uint8Array
                if (resp.body) {
                    const reader = resp.body.getReader()
                    const chunks: Uint8Array[] = []
                    let totalBytes = 0
                    while (true) {
                        const { done, value } = await reader.read()
                        if (done) break
                        totalBytes += value.byteLength
                        if (totalBytes > BLOB_DOWNLOAD_SIZE_LIMIT) {
                            reader.cancel().catch(() => {})
                            fallbackAnchorDownload(url, content.name || "file")
                            return
                        }
                        chunks.push(value)
                    }
                    const combined = new Uint8Array(totalBytes)
                    let offset = 0
                    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength }
                    textBuf = combined
                } else {
                    // Fallback for environments without ReadableStream body
                    const buf = await resp.arrayBuffer()
                    if (buf.byteLength > BLOB_DOWNLOAD_SIZE_LIMIT) {
                        fallbackAnchorDownload(url, content.name || "file")
                        return
                    }
                    textBuf = new Uint8Array(buf)
                }
                const text = new TextDecoder("utf-8").decode(textBuf)
                const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
                const blobUrl = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = blobUrl
                a.download = content.name || "file"
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
            // Non-text-file path: use shared downloadFile() utility
            } else {
                await downloadFile(url, content.name || "file", {
                    fileSize: content.size,
                })
            }
        } catch {
            alert("文件下载失败")
        }
    }

    handlePreview = () => {
        const { message } = this.props
        const content = message.content as FileContent
        const url = this.getFileURL(content)
        if (!url || !isSafeURL(url)) return

        if (isTextFile(content.extension, content.name)) {
            this.handleTextPreview(url, content.name, getExtension(content.extension, content.name))
            return
        }

        try {
            window.open(url, "_blank")
        } catch {
            alert("文件预览失败")
        }
    }

    handleTextPreview = async (url: string, name: string, extension: string) => {
        const TEXT_PREVIEW_LIMIT = 5 * 1024 * 1024 // 5MB
        try {
            const response = await fetch(url)
            if (!response.ok) {
                Toast.error("文件预览失败")
                return
            }
            const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10)
            if (contentLength > TEXT_PREVIEW_LIMIT) {
                alert('File too large to preview')
                return
            }
            const buffer = await response.arrayBuffer()
            if (buffer.byteLength > TEXT_PREVIEW_LIMIT) {
                alert('File too large to preview')
                return
            }
            const text = new TextDecoder("utf-8").decode(buffer)
            this.setState({
                textPreviewVisible: true,
                textPreviewContent: text,
                textPreviewName: name,
                textPreviewExt: extension.toLowerCase(),
            })
        } catch {
            Toast.error("文件预览失败")
        }
    }

    render() {
        const { message, context } = this.props
        const content = message.content as FileContent
        const iconInfo = getFileIconInfo(content.extension, content.name)
        const canPreview = isPreviewable(content.extension, content.name)
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
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                <line x1="12" y1="9" x2="12" y2="13" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                        </div>
                        <div className="wk-message-file-info">
                            <div className="wk-message-file-name" title={content.name}>
                                {content.name || "上传失败"}
                            </div>
                            <div className="wk-message-file-meta">
                                <span className="wk-message-file-failed-text">上传失败</span>
                            </div>
                            <div className="wk-message-file-retry-hint">点击图标重试</div>
                        </div>
                        <div className="wk-message-file-actions">
                            <div className="wk-message-file-action" title="重试" onClick={() => {
                                if (!this._task) {
                                    Toast.warning('上传任务已失效，请重新发送文件')
                                    return
                                }
                                this._task.restart()
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
                <WKModal
                    className="wk-base-modal"
                    visible={this.state.textPreviewVisible}
                    title={this.state.textPreviewName}
                    size="lg"
                    onCancel={() => this.setState({ textPreviewVisible: false })}
                >
                    <div className="wk-text-file-preview">
                        {this.state.textPreviewExt === "md" ? (
                            <MarkdownContent content={this.state.textPreviewContent} />
                        ) : (
                            <pre className="wk-text-file-preview-plain">{this.state.textPreviewContent}</pre>
                        )}
                    </div>
                </WKModal>
            </MessageBase>
        )
    }
}
