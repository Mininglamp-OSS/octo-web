import { MediaMessageContent, WKSDK, Task, TaskStatus, MessageStatus } from "wukongimjssdk"
import React from "react"
import WKApp from "../../App"
import { MessageContentTypeConst } from "../../Service/Const"
import MessageBase from "../Base"
import { MessageCell } from "../MessageCell"
import Lightbox, { isImageSlide, useLightboxState } from "yet-another-react-lightbox"
import type { Slide, ZoomRef } from "yet-another-react-lightbox"
import Zoom from "yet-another-react-lightbox/plugins/zoom"
import "yet-another-react-lightbox/styles.css"
import { Copy, Download, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react"
import { Toast } from "@douyinfe/semi-ui"
import { downloadFile } from "../../Utils/download"
import { copyImageToClipboard } from "../../Utils/clipboard"
import MessageRow from "../../ui/message/MessageRow"
import SingleImage from "../../ui/message/ImageContent/SingleImage"
import MultiImage from "../../ui/message/ImageContent/MultiImage"
import type { ImageTransferState } from "../../ui/message/ImageContent/SingleImage"
import { getImageMessageUI } from "../../bridge/message/useImageMessageUI"
import { isMessageSelectable } from "../../Service/messageSelection"
import { t } from "../../i18n"
import "./index.css"

const SMALL_FILE_THRESHOLD = 1024 * 1024 // 1MB 以下不显示进度覆盖层

interface ImagePreviewToolbarProps {
    zoom: ZoomRef
    filename?: string
    onReset: () => void
    onRotate: () => void
}

export function ImagePreviewToolbar({ zoom, filename, onReset, onRotate }: ImagePreviewToolbarProps) {
    const { currentSlide } = useLightboxState()
    const [copying, setCopying] = React.useState(false)
    const src = currentSlide && isImageSlide(currentSlide) ? currentSlide.src : ""

    const handleCopy = async () => {
        if (!src) return
        setCopying(true)
        try {
            await copyImageToClipboard(src)
            Toast.success(t("base.module.contextMenus.copyImageSuccess"))
        } catch (error) {
            Toast.warning(error instanceof Error ? error.message : t("base.module.contextMenus.copyFailed"))
        } finally {
            setCopying(false)
        }
    }

    return (
        <div className="wk-image-preview-toolbar">
            <button
                type="button"
                aria-label={t("base.filePreview.pdf.zoomOut")}
                title={t("base.filePreview.pdf.zoomOut")}
                disabled={zoom.disabled || zoom.zoom <= zoom.minZoom}
                onClick={zoom.zoomOut}
            >
                <ZoomOut size={19} />
            </button>
            <button
                type="button"
                className="wk-image-preview-toolbar-reset"
                aria-label={t("base.filePreview.pdf.actualSize")}
                title={t("base.filePreview.pdf.actualSize")}
                onClick={() => {
                    zoom.changeZoom(1)
                    onReset()
                }}
            >
                1:1
            </button>
            <button
                type="button"
                aria-label={t("base.filePreview.pdf.zoomIn")}
                title={t("base.filePreview.pdf.zoomIn")}
                disabled={zoom.disabled || zoom.zoom >= zoom.maxZoom}
                onClick={zoom.zoomIn}
            >
                <ZoomIn size={19} />
            </button>
            <span className="wk-image-preview-toolbar-divider" />
            <button
                type="button"
                aria-label={t("base.message.imagePreview.rotate")}
                title={t("base.message.imagePreview.rotate")}
                onClick={() => {
                    zoom.changeZoom(1)
                    onRotate()
                }}
            >
                <RotateCw size={19} />
            </button>
            <span className="wk-image-preview-toolbar-divider" />
            <button
                type="button"
                aria-label={t("base.module.contextMenus.copyImage")}
                title={t("base.module.contextMenus.copyImage")}
                disabled={!src || copying}
                onClick={handleCopy}
            >
                <Copy size={19} />
            </button>
            <span className="wk-image-preview-toolbar-divider" />
            <button
                type="button"
                aria-label={t("base.filePreview.download")}
                title={t("base.filePreview.download")}
                disabled={!src}
                onClick={() => src && downloadFile(src, filename || "image.png")}
            >
                <Download size={19} />
            </button>
        </div>
    )
}

interface ImagePreviewLightboxProps {
    open: boolean
    close: () => void
    slides: readonly Slide[]
    index?: number
    filename?: string
    isMulti?: boolean
}

export function ImagePreviewLightbox({ open, close, slides, index, filename, isMulti }: ImagePreviewLightboxProps) {
    const [rotation, setRotation] = React.useState(0)
    const resetRotation = () => setRotation(0)

    return (
        <Lightbox
            className="wk-image-preview"
            open={open}
            close={() => {
                resetRotation()
                close()
            }}
            slides={slides}
            index={index}
            plugins={[Zoom]}
            labels={{
                Close: t("base.common.close"),
                "Zoom in": t("base.filePreview.pdf.zoomIn"),
                "Zoom out": t("base.filePreview.pdf.zoomOut"),
            }}
            toolbar={{ buttons: ["zoom", "close"] }}
            zoom={{ minZoom: 0.25, maxZoomPixelRatio: 4, zoomInMultiplier: 1.25, scrollToZoom: true }}
            carousel={{
                finite: true,
                imageProps: {
                    style: {
                        maxWidth: rotation % 180 ? "100cqh" : "100%",
                        maxHeight: rotation % 180 ? "100cqw" : "100%",
                    },
                },
            }}
            controller={{ closeOnBackdropClick: true }}
            on={{ entering: resetRotation, view: resetRotation }}
            styles={{
                root: { "--yarl__image_preview_rotation": `${rotation}deg` },
            }}
            render={{
                buttonPrev: isMulti ? undefined : () => null,
                buttonNext: isMulti ? undefined : () => null,
                buttonZoom: (zoom) => (
                    <ImagePreviewToolbar
                        zoom={zoom}
                        filename={filename}
                        onReset={resetRotation}
                        onRotate={() => setRotation(value => (value + 90) % 360)}
                    />
                ),
                iconClose: () => <X size={22} />,
            }}
        />
    )
}


export class ImageContent extends MediaMessageContent {
    width!: number
    height!: number
    url!: string
    imgData?: string
    caption?: string
    mentionUids?: string[]
    name?: string
    constructor(file?: File, imgData?: string, width?: number, height?: number, caption?: string, mentionUids?: string[]) {
        super()
        this.file = file
        this.imgData = imgData
        this.width = width || 0
        this.height = height || 0
        this.caption = caption
        this.mentionUids = mentionUids
        if (file) {
            this.name = file.name
        }
    }
    decodeJSON(content: any) {
        this.width = content["width"] || 0
        this.height = content["height"] || 0
        this.url = content["url"] || ''
        this.caption = content["caption"] || ''
        this.mentionUids = content["mention_uids"] || []
        this.name = content["name"] || undefined
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
        if (this.name) {
            json["name"] = this.name
        }
        return json
    }
    get contentType() {
        return MessageContentTypeConst.image
    }
    get conversationDigest() {
        return t("base.message.digest.image")
    }
}


interface ImageCellState {
    showPreview: boolean
    previewIndex: number
    uploadProgress: number
    uploadStatus: TaskStatus | null
}

export interface ImageTransferInput {
    hasLocalFile: boolean
    hasRemoteUrl: boolean
    fileSize: number
    messageStatus: MessageStatus
    uploadStatus: TaskStatus | null
    uploadProgress: number
    onUploadRetry?: () => void
    onMessageRetry?: () => void
}

function isTaskFailed(uploadStatus: TaskStatus | null) {
    return uploadStatus === TaskStatus.fail || uploadStatus === TaskStatus.cancel
}

function isTaskActive(uploadStatus: TaskStatus | null) {
    return uploadStatus !== null && uploadStatus !== TaskStatus.success && !isTaskFailed(uploadStatus)
}

export function getImageTransferState({
    hasLocalFile,
    hasRemoteUrl,
    fileSize,
    messageStatus,
    uploadStatus,
    uploadProgress,
    onUploadRetry,
    onMessageRetry,
}: ImageTransferInput): ImageTransferState | undefined {
    if (isTaskActive(uploadStatus)) {
        const progress = Math.max(0, Math.min(100, Math.round(uploadProgress)))
        if (fileSize >= SMALL_FILE_THRESHOLD && progress > 0) {
            return { status: "uploading", progress }
        }
        return { status: "sending" }
    }

    if (isTaskFailed(uploadStatus)) {
        return { status: "failed", onRetry: onUploadRetry }
    }

    if (messageStatus === MessageStatus.Fail) {
        return { status: "failed", onRetry: onMessageRetry }
    }

    if (messageStatus === MessageStatus.Wait || (hasLocalFile && !hasRemoteUrl)) {
        return { status: "sending" }
    }

    return undefined
}

/** task 自身支持的重试接口（MediaMessageUploadTask 实现） */
interface RestartableTask extends Task {
    restart(): Promise<void>;
}

export class ImageCell extends MessageCell<any, ImageCellState> {
    private _task?: RestartableTask

    private _taskListener = (task: Task) => {
        const { message } = this.props
        if (task.id !== message.clientMsgNo) return
        this.setState({ uploadProgress: task.progress(), uploadStatus: task.status })
    }

    constructor(props: any) {
        super(props)
        this.state = {
            showPreview: false,
            previewIndex: 0,
            uploadProgress: 0,
            uploadStatus: null,
        }
    }

    componentDidMount() {
        super.componentDidMount()
        const { message } = this.props
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

    imageScale(orgWidth: number, orgHeight: number, maxWidth = 660, maxHeight = 372) {
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
        if (content.url && content.url !== "") {
            return WKApp.dataSource.commonDataSource.getImageURL(content.url, { width: content.width, height: content.height })
        }
        return content.imgData
    }

    getImageElement() {
        const { message } = this.props
        const content = message.content as ImageContent
        let scaleSize = this.imageScale(content.width, content.height);
        return <img alt="" src={this.getImageSrc(content)} style={{ borderRadius: '8px', width: scaleSize.width, height: scaleSize.height, maxWidth: '100%' }} />
    }

    private handleRetry = () => {
        if (!this._task) {
            Toast.warning(t("base.message.uploadTaskExpired"))
            return
        }
        this._task.restart()
    }

    render() {
        const { message, context } = this.props
        const { showPreview, previewIndex, uploadProgress, uploadStatus } = this.state
        const content = message.content as ImageContent

        // 新 UI 实现
        const useNewUI = true
        if (useNewUI) {
            const uiProps = getImageMessageUI(message)
            const hasRemoteUrl = uiProps.isMulti
                ? uiProps.images.some(image => !!image.src)
                : !!(content.url || (content as any).remoteUrl)
            const fileSize = (content as any).file?.size ?? 0
            const transferState = getImageTransferState({
                hasLocalFile: !!(content as any).file,
                hasRemoteUrl,
                fileSize,
                messageStatus: message.status,
                uploadStatus,
                uploadProgress,
                onUploadRetry: this.handleRetry,
                onMessageRetry: () => context.resendMessage(message.message),
            })
            const selectionMode = context.editOn()
            const selectable = isMessageSelectable(message)
            const canPreview = !transferState && hasRemoteUrl
            const canOpenPreview = canPreview && !selectionMode
            return (
                <>
                    <MessageRow
                        {...uiProps.row}
                        onContextMenu={(event) => context.showContextMenus(message, event)}
                        isActive={context.isContextMenuOpen(message.message)}
                        selectionMode={selectionMode}
                        showCheckbox={selectionMode && selectable}
                        isSelected={selectable && !!message.checked}
                        onSelect={selectable ? (selected) => context.checkeMessage(message.message, selected) : undefined}
                        onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
                        onSenderNameClick={() => context.showUser(message.fromUID)}
                    >
                        {uiProps.isMulti
                            ? <MultiImage
                                images={uiProps.images}
                                transferState={transferState}
                                onImageClick={canOpenPreview ? (index) => {
                                    if (uiProps.images[index]?.src) {
                                        this.setState({ showPreview: true, previewIndex: index })
                                    }
                                } : undefined}
                              />
                            : uiProps.singleImage
                                ? <SingleImage
                                    {...uiProps.singleImage}
                                    transferState={transferState}
                                    onClick={canOpenPreview ? () => this.setState({ showPreview: true }) : undefined}
                                  />
                                : null
                        }
                    </MessageRow>
                    <ImagePreviewLightbox
                        open={showPreview}
                        close={() => this.setState({ showPreview: false })}
                        index={previewIndex}
                        slides={uiProps.isMulti
                            ? uiProps.images.map(img => ({ src: img.src, alt: '' }))
                            : [{ src: uiProps.singleImage?.src || '', alt: '' }]
                        }
                        filename={content.name}
                        isMulti={uiProps.isMulti}
                    />
                </>
            )
        }

        // 旧 UI 实现（保持向后兼容）
        let scaleSize = this.imageScale(content.width, content.height);
        const imageURL = this.getImageSrc(content) || ""

        const hasRemoteUrl = !!(content.url || (content as any).remoteUrl)
        const isUploading =
            uploadStatus !== null &&
            uploadStatus !== TaskStatus.success &&
            uploadStatus !== TaskStatus.fail &&
            uploadStatus !== TaskStatus.cancel &&
            !hasRemoteUrl

        const pct = Math.round(uploadProgress)

        return <MessageBase context={context} message={message}>
            <div style={{ cursor: isUploading ? "default" : "pointer" }}>
                <div style={{ position: "relative", width: scaleSize.width, height: scaleSize.height, maxWidth: '100%' }}
                    onClick={() => { if (!isUploading) this.setState({ showPreview: !showPreview }) }}>
                    {this.getImageElement()}
                    {/* 上传进度覆盖层 */}
                    {isUploading && (
                        <div style={{
                            position: "absolute", inset: 0,
                            background: "rgba(0,0,0,0.45)",
                            borderRadius: 8,
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
                            borderRadius: 8,
                            display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center",
                            gap: 6,
                            cursor: "pointer",
                        }} onClick={(e) => {
                            e.stopPropagation()
                            if (!this._task) {
                                Toast.warning(t("base.message.uploadTaskExpired"))
                                return
                            }
                            this._task.restart()
                        }}>
                            <span style={{ color: "#fff", fontSize: 22 }}>⚠️</span>
                            <span style={{ color: "#fff", fontSize: 11 }}>{t("base.message.uploadFailedRetry")}</span>
                        </div>
                    )}
                </div>
                {content.caption && (
                    <div className="wk-image-caption" style={{ maxWidth: scaleSize.width, marginTop: '4px', fontSize: '14px', color: 'var(--wk-text-item)', wordBreak: 'break-word' }}>
                        {content.caption}
                    </div>
                )}
            </div>
            <ImagePreviewLightbox
                open={showPreview}
                close={() => this.setState({ showPreview: false })}
                slides={[{ src: imageURL, alt: '' }]}
                filename={content.name}
            />
        </MessageBase>
    }
}
