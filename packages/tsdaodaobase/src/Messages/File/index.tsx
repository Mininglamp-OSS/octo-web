import React from "react"
import "./index.css"
import { MessageCell } from "../MessageCell"
import MessageBase from "../Base"
import WKApp from "../../App"
import { FileContent } from "./FileContent"

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

interface FileCellState {
    downloading: boolean
}

export class FileCell extends MessageCell<any, FileCellState> {
    constructor(props: any) {
        super(props)
        this.state = {
            downloading: false,
        }
    }

    getFileURL(content: FileContent): string {
        if (content.url && content.url !== "") {
            return WKApp.dataSource.commonDataSource.getFileURL(content.url)
        }
        return ""
    }

    handleDownload = () => {
        const { message } = this.props
        const content = message.content as FileContent
        const url = this.getFileURL(content)
        if (!url) return

        const a = document.createElement("a")
        a.href = url
        a.download = content.name || "file"
        a.target = "_blank"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }

    handlePreview = () => {
        const { message } = this.props
        const content = message.content as FileContent
        const url = this.getFileURL(content)
        if (!url) return
        window.open(url, "_blank")
    }

    render() {
        const { message, context } = this.props
        const content = message.content as FileContent
        const iconInfo = getFileIconInfo(content.extension)
        const canPreview = isPreviewable(content.extension)

        return (
            <MessageBase context={context} message={message}>
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
            </MessageBase>
        )
    }
}
