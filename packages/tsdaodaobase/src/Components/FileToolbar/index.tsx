import React from "react"
import { Component, ReactNode } from "react"
import ConversationContext from "../Conversation/context"
import { FileContent } from "../../Messages/File/FileContent"

import "./index.css"

interface FileToolbarProps {
    conversationContext: ConversationContext
    icon: string
}

interface FileToolbarState {
    showDialog: boolean
    file?: File
    fileName?: string
    fileSize?: number
    fileExtension?: string
}

export default class FileToolbar extends Component<FileToolbarProps, FileToolbarState> {
    $fileInput: any

    constructor(props: any) {
        super(props)
        this.state = {
            showDialog: false,
        }
    }

    onFileClick = (event: any) => {
        event.target.value = ""
    }

    onFileChange() {
        const file = this.$fileInput.files[0]
        if (!file) return
        this.showFile(file)
    }

    chooseFile = () => {
        this.$fileInput.click()
    }

    showFile(file: File) {
        const name = file.name || "unknown"
        const dotIndex = name.lastIndexOf(".")
        const extension = dotIndex > 0 ? name.substring(dotIndex + 1) : ""

        this.setState({
            file: file,
            fileName: name,
            fileSize: file.size,
            fileExtension: extension,
            showDialog: true,
        })
    }

    onSend = () => {
        const { conversationContext } = this.props
        const { file, fileName, fileExtension, fileSize } = this.state

        if (file) {
            const content = new FileContent(file, fileName, fileExtension, fileSize)
            conversationContext.sendMessage(content)
        }

        this.setState({ showDialog: false })
    }

    onClose = () => {
        this.setState({ showDialog: false })
    }

    formatFileSize(bytes: number): string {
        if (bytes <= 0) return "0 B"
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    }

    getFileIconInfo(extension: string): { color: string; label: string } {
        const ext = (extension || "").toLowerCase()
        switch (ext) {
            case "pdf": return { color: "#EF4444", label: "PDF" }
            case "doc": case "docx": return { color: "#3B82F6", label: "DOC" }
            case "xls": case "xlsx": return { color: "#22C55E", label: "XLS" }
            case "ppt": case "pptx": return { color: "#F97316", label: "PPT" }
            case "zip": case "rar": case "7z": return { color: "#EAB308", label: "ZIP" }
            default: return { color: "#9CA3AF", label: "FILE" }
        }
    }

    render(): ReactNode {
        const { icon } = this.props
        const { showDialog, fileName, fileSize, fileExtension } = this.state
        const iconInfo = this.getFileIconInfo(fileExtension || "")

        return (
            <div className="wk-filetoolbar">
                <div className="wk-filetoolbar-content" onClick={this.chooseFile}>
                    <div className="wk-filetoolbar-content-icon">
                        <img src={icon} alt="" />
                        <input
                            onClick={this.onFileClick}
                            onChange={this.onFileChange.bind(this)}
                            ref={(ref) => { this.$fileInput = ref }}
                            type="file"
                            multiple={false}
                            style={{ display: "none" }}
                        />
                    </div>
                </div>
                {showDialog ? (
                    <div className="wk-filedialog">
                        <div className="wk-filedialog-mask" onClick={this.onClose}></div>
                        <div className="wk-filedialog-content">
                            <div className="wk-filedialog-content-close" onClick={this.onClose}>
                                <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M568.92178541 508.23169412l299.36805789-299.42461715a39.13899415 39.13899415 0 0 0 0-55.1452591L866.64962537 152.02159989a39.13899415 39.13899415 0 0 0-55.08869988 0L512.19286756 451.84213173 212.76825042 151.90848141a39.13899415 39.13899415 0 0 0-55.0886999 0L155.98277331 153.54869938a38.46028327 38.46028327 0 0 0 0 55.08869987L455.46394971 508.23169412 156.03933259 807.71287052a39.13899415 39.13899415 0 0 0 0 55.08869986l1.64021795 1.6967772a39.13899415 39.13899415 0 0 0 55.08869988 0l299.42461714-299.48117638 299.36805793 299.42461714a39.13899415 39.13899415 0 0 0 55.08869984 0l1.6967772-1.64021796a39.13899415 39.13899415 0 0 0 0-55.08869987L568.86522614 508.17513487z" />
                                </svg>
                            </div>
                            <div className="wk-filedialog-content-title">发送文件</div>
                            <div className="wk-filedialog-content-body">
                                <div className="wk-filedialog-preview">
                                    <div className="wk-filedialog-preview-icon" style={{ backgroundColor: iconInfo.color }}>
                                        <span className="wk-filedialog-preview-icon-label">{iconInfo.label}</span>
                                    </div>
                                    <div className="wk-filedialog-preview-info">
                                        <div className="wk-filedialog-preview-name">{fileName}</div>
                                        <div className="wk-filedialog-preview-size">{this.formatFileSize(fileSize || 0)}</div>
                                    </div>
                                </div>
                                <div className="wk-filedialog-footer">
                                    <button onClick={this.onClose}>取消</button>
                                    <button className="wk-filedialog-footer-okbtn" onClick={this.onSend} style={{ backgroundColor: "var(--wk-color-theme)" }}>发送</button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        )
    }
}
