import classNames from "classnames";
import React from "react";
import ReactDOM from "react-dom";
import { Component, ReactNode } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { EndpointID } from "../../Service/Const";
import WKApp from "../../App";
import { Emoji, EmojiService } from "../../Service/EmojiService";
import { StickerItem } from "../../Service/DataSource/DataSource";
import ConversationContext from "../Conversation/context";
import { t } from "../../i18n";

import "./index.css"
import { LottieSticker, isBitmapStickerFormat } from "../../Messages/LottieSticker";
import IconClick from "../IconClick";

// 自定义贴纸 tab 的内部标识。贴纸是扁平的（不分包），所以只有这一个固定 tab。
const STICKER_CATEGORY = "sticker"

// 客户端侧的上传预校验（size / format / dimension）读 WKApp.remoteConfig.stickerUploadLimits
// （后端 appconfig 的 sticker_upload_limits，见 App.tsx），不再本地硬编码——运维在管理台
// 调整上限后，appconfig 灰度刷新即可让预校验口径跟上，不用发版。服务端 modules/file 侧
// 仍是最终防线，这里只是即时反馈、少打一次必失败的请求。

// 从文件名取扩展名（小写、带前导点），口径与服务端 SystemSettings.StickerUploadAllowedFormats
// 一致（.gif/.png/... 全小写带点），故可以直接与 stickerUploadLimits.allowedFormats 比较。
// 取不到扩展名（无 "." 或以 "." 结尾）返回空字符串，必然不在允许列表里。
function getStickerFileExtension(name: string): string {
    const dot = name.lastIndexOf(".")
    if (dot < 0 || dot === name.length - 1) {
        return ""
    }
    return name.slice(dot).toLowerCase()
}

// 把 KB 数值格式化成 sticker.tooLarge 提示文案里 {{size}} 的可读展示：1024 的整数倍
// 显示 MB（历史默认 1024 -> "1MB"，与改动前的提示文案字节对齐），否则显示 KB。
function formatStickerSizeLimit(maxSizeKB: number): string {
    return maxSizeKB % 1024 === 0 ? `${maxSizeKB / 1024}MB` : `${maxSizeKB}KB`
}

// 把 allowedFormats（[".gif", ".png", ...]）格式化成 sticker.formatUnsupported 提示文案
// 里 {{formats}} 的可读展示：去掉前导点、逗号分隔，例如 "gif, png, jpg, jpeg, webp"，
// 与改动前硬编码提示文案的措辞风格一致，不把协议层的点号暴露给用户。
function formatAllowedFormatsList(allowedFormats: string[]): string {
    return allowedFormats.map((f) => f.replace(/^\./, "")).join(", ")
}

// 读取图片文件的像素宽高，用于选完文件后的本地 dimension 预校验。解码失败（文件损坏等）
// resolve null——不能因为本地探测失败就拦掉本该合法的上传，服务端 modules/file 侧仍是
// 最终防线。做法与 Utils/clipboard.ts 的 loadImageAndConvertToPng 一致：new Image() +
// object URL 读 naturalWidth/naturalHeight，读完立即 revokeObjectURL 避免内存泄漏。
function readStickerImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
            URL.revokeObjectURL(url)
            resolve({ width: img.naturalWidth, height: img.naturalHeight })
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            resolve(null)
        }
        img.src = url
    })
}

// 面板尺寸（与 index.css 的 .wk-emojitoolbar-emojipanel 保持一致）与视口避让间距，
// 用于把面板按按钮位置定位并夹进视口，避免溢出/被祖先裁剪。
const EMOJI_PANEL_WIDTH = 460
const EMOJI_PANEL_HEIGHT = 372
const EMOJI_PANEL_GAP = 12
const EMOJI_PANEL_MARGIN = 8

// 贴纸 hover 放大预览（对齐 Discord 贴纸面板的「悬停看大图」）。60px 缩略图看不清复杂
// 插画，悬停时在格子上方浮出一张 STICKER_PREVIEW_SIZE 的圆角大图卡片。放大层 portal 到
// <body>、position:fixed 并夹进视口——因为面板内容区 .wk-emojipanel-content 是
// overflow:hidden，放大卡片会被裁掉顶部/边缘，portal 才能让它浮出面板而不被裁。
// 浮在格子上方（而非盖住格子）是为了不遮挡 hover 才出现的右上角删除「×」。
const STICKER_PREVIEW_SIZE = 140
const STICKER_PREVIEW_MARGIN = 8
// 放大卡片与格子之间的间距，避免贴着格子边缘。
const STICKER_PREVIEW_GAP = 8
// 首次悬停到浮出的延时：扫过网格时不会一路狂闪；一旦浮出，格子间移动直接无缝切换。
const STICKER_PREVIEW_DELAY = 120

interface EmojiToolbarProps {
    conversationContext: ConversationContext
    icon: string | React.ReactNode
}

interface EmojiToolbarState {
    show: boolean
    animationStart: boolean
    panelPos: { left: number; top: number } | null
}

export default class EmojiToolbar extends Component<EmojiToolbarProps, EmojiToolbarState>{
    private triggerRef = React.createRef<HTMLDivElement>()

    constructor(props: any) {
        super(props)
        this.state = {
            show: false,
            animationStart: false,
            panelPos: null,
        }
    }

    // 按触发按钮的位置计算面板坐标，并夹进视口：默认向上弹、左对齐按钮；上方空间
    // 不足则向下弹；左右超界则贴边。面板用 position:fixed + portal 到 body，因此
    // 不受任何祖先 overflow:hidden / 容器宽度影响（修复之前"偏左"与"溢出右"）。
    computePanelPos(): { left: number; top: number } {
        const rect = this.triggerRef.current?.getBoundingClientRect()
        const vw = typeof window !== "undefined" ? window.innerWidth : EMOJI_PANEL_WIDTH
        const vh = typeof window !== "undefined" ? window.innerHeight : EMOJI_PANEL_HEIGHT
        if (!rect) {
            return { left: EMOJI_PANEL_MARGIN, top: EMOJI_PANEL_MARGIN }
        }
        const left = Math.max(EMOJI_PANEL_MARGIN, Math.min(rect.left, vw - EMOJI_PANEL_WIDTH - EMOJI_PANEL_MARGIN))
        let top = rect.top - EMOJI_PANEL_HEIGHT - EMOJI_PANEL_GAP
        if (top < EMOJI_PANEL_MARGIN) {
            top = Math.max(EMOJI_PANEL_MARGIN, Math.min(rect.bottom + EMOJI_PANEL_GAP, vh - EMOJI_PANEL_HEIGHT - EMOJI_PANEL_MARGIN))
        }
        return { left, top }
    }

    togglePanel = () => {
        if (this.state.show) {
            this.close()
        } else {
            this.setState({ show: true, animationStart: true, panelPos: this.computePanelPos() })
            window.addEventListener("resize", this.onResize)
        }
    }

    close = () => {
        window.removeEventListener("resize", this.onResize)
        this.setState({ show: false, animationStart: true })
    }

    componentWillUnmount() {
        window.removeEventListener("resize", this.onResize)
    }

    // 打开期间窗口尺寸变化（DevTools 切换 / 分栏 / 缩放）时重新夹取面板位置（P2-4）。
    private onResize = () => {
        if (this.state.show) {
            this.setState({ panelPos: this.computePanelPos() })
        }
    }

    render(): ReactNode {
        const { show, animationStart, panelPos } = this.state
        const { icon, conversationContext } = this.props
        const overlay = <>
            <div
                onAnimationEnd={() => {
                    if (!show) {
                        this.setState({ animationStart: false })
                    }
                }}
                style={panelPos ? { left: panelPos.left, top: panelPos.top } : undefined}
                className={classNames("wk-emojitoolbar-emojipanel", animationStart ? (show ? "wk-emojitoolbar-emojipanel-show" : "wk-emojitoolbar-emojipanel-hide") : undefined)}
            >
                <EmojiPanel onSticker={(sticker) => {
                    this.close()
                    const lottieSticker = new LottieSticker()
                    lottieSticker.category = sticker.category
                    lottieSticker.url = sticker.path
                    lottieSticker.placeholder = sticker.placeholder
                    lottieSticker.format = sticker.format
                    conversationContext.sendMessage(lottieSticker)
                }} onEmoji={(emoji) => {
                    this.close()
                    conversationContext.messageInputContext().insertText(emoji.key)
                }}></EmojiPanel>
            </div>
            {
                show ? <div className="wk-emojitoolbar-mask" onClick={this.close}></div> : undefined
            }
        </>
        return <div className="wk-emojitoolbar" ref={this.triggerRef}>
            <IconClick
                size="sm"
                icon={typeof icon === 'string' ? <img src={icon} alt="" /> : icon}
                onClick={this.togglePanel}
            />
            {typeof document !== "undefined" ? ReactDOM.createPortal(overlay, document.body) : overlay}
        </div>
    }
}

interface EmojiPanelState {
    emojis: Emoji[]
    category: string
    stickers: StickerItem[]
    uploading: boolean
    // 当前 hover 放大预览的目标贴纸及其格子在视口中的矩形；null 表示不显示。
    preview: { sticker: StickerItem; rect: DOMRect } | null
}

interface EmojiPanelProps {
    onEmoji?: (emoji: Emoji) => void
    onSticker?: (sticker: StickerItem) => void
}

export class EmojiPanel extends Component<EmojiPanelProps, EmojiPanelState> {
    emojiService: EmojiService
    private fileInput: HTMLInputElement | null = null
    // EmojiPanel 被 portal 且常驻（每个会话输入栏一个），切换/关闭会话时卸载。下面三个
    // fire-and-forget 异步流在卸载后 setState 会触发 React 警告并对已离开的会话弹 toast，
    // 故用 isUnmounted 守卫（PR#496 review，参照 ThreadPanel）。
    private isUnmounted = false
    private stickersLoaded = false
    // 订阅 appconfig 字段变化，让 sticker_custom_enabled 灰度切换后无需刷新前台即可生效。
    private removeConfigChangeListener?: () => void
    // hover 放大预览的浮出延时句柄；卸载/隐藏时清除，避免离屏后 setState。
    private previewTimer: ReturnType<typeof setTimeout> | null = null

    constructor(props: any) {
        super(props)
        this.emojiService = WKApp.endpointManager.invoke(EndpointID.emojiService)
        this.state = {
            emojis: [],
            category: "emoji",
            stickers: [],
            uploading: false,
            preview: null,
        }
    }

    componentDidMount() {
        this.setState({
            emojis: this.emojiService.getAllEmoji()
        })
        // 表情清单（服务端内置表情，web#492）异步到达后刷新选择器，否则面板若在
        // load() 完成前挂载，要重开才显示新表情。
        WKApp.mittBus.on("emoji-manifest-updated", this._onEmojiManifestUpdated)
        // 「添加到我的贴纸」右键菜单收藏成功后广播此事件；已加载过贴纸的面板才
        // 重拉，未加载过的等下次点开时通过 ensureStickersLoaded 懒加载 —— 避免
        // 全应用每个 EmojiPanel 都被无谓地打一次 sticker/user 请求。
        WKApp.mittBus.on("stickers-updated", this._onStickersUpdated)
        this.removeConfigChangeListener = WKApp.remoteConfig.addConfigChangeListener(
            this._onRemoteConfigChange
        )
        // 放大预览用 hover 那一刻捕获的格子 rect 做 position:fixed 定位；网格滚动或窗口
        // 缩放后该 rect 会失真，而滚动不冒泡、也不触发 <ul> 的 mouseleave，卡片会悬在旧
        // 坐标、盖到错的贴纸上。捕获阶段监听任意滚动 + resize，一发生就隐藏预览（最简且
        // 正确，下次 hover 自然重新浮出）。
        // passive: true — 这个监听器只读、从不 preventDefault，标记 passive 让浏览器不用
        // 等它跑完就能开始滚动，避免不必要的滚动卡顿。
        window.addEventListener("scroll", this.hideStickerPreview, { capture: true, passive: true })
        window.addEventListener("resize", this.hideStickerPreview)
        // 贴纸列表延迟到首次切到「我的贴纸」tab 时再拉（ensureStickersLoaded），
        // 避免每次打开表情面板都打一次 sticker/user 请求（PR#496 review P2-1）。
    }

    componentWillUnmount() {
        this.isUnmounted = true
        WKApp.mittBus.off("emoji-manifest-updated", this._onEmojiManifestUpdated)
        WKApp.mittBus.off("stickers-updated", this._onStickersUpdated)
        this.removeConfigChangeListener?.()
        this.removeConfigChangeListener = undefined
        // removeEventListener 按 capture 标志匹配（passive 不参与匹配），{capture:true} 与
        // 注册时的 {capture:true, passive:true} 匹配一致。
        window.removeEventListener("scroll", this.hideStickerPreview, { capture: true })
        window.removeEventListener("resize", this.hideStickerPreview)
        if (this.previewTimer) {
            clearTimeout(this.previewTimer)
            this.previewTimer = null
        }
    }

    private _onEmojiManifestUpdated = () => {
        if (this.isUnmounted) {
            return
        }
        this.setState({ emojis: this.emojiService.getAllEmoji() })
    }

    private _onStickersUpdated = () => {
        if (this.isUnmounted) {
            return
        }
        if (this.stickersLoaded) {
            this.requestStickers()
        }
    }

    private _onRemoteConfigChange = () => {
        if (this.isUnmounted) {
            return
        }
        // 灰度关掉自定义贴纸时，顺手清掉可能仍在显示的放大预览——面板常驻不卸载，否则
        // stale preview 状态会跨这次 tab 消失继续留着。
        if (!WKApp.remoteConfig.stickerCustomEnabled) {
            this.hideStickerPreview()
        }
        // 开关值直接从 WKApp.remoteConfig 读取, 用 forceUpdate 触发 render 拾取最新值。
        // 不需要拷贝到 state, 避免 state 与 remoteConfig 双源不一致。
        this.forceUpdate()
    }

    requestStickers(): Promise<void> {
        return WKApp.dataSource.commonDataSource.userStickers().then((result) => {
            this.stickersLoaded = true
            if (!this.isUnmounted) {
                const list = result.list || []
                this.setState((prev) => ({
                    stickers: list,
                    // 后台刷新（如「stickers-updated」广播）可能悄悄把正在 hover 预览的那张
                    // 贴纸移除/替换掉，而指针并没有移动去触发任何 hide 路径——预览会滞留、
                    // 展示一张已经不存在的贴纸。新列表里已经找不到该 sticker_id 时一并清掉，
                    // 和 onDelete 是同一类残影，只是触发源不同。
                    preview: prev.preview && !list.some((s) => s.sticker_id === prev.preview!.sticker.sticker_id)
                        ? null
                        : prev.preview,
                }))
            }
        }).catch(() => {
            if (!this.isUnmounted) {
                // 失败分支把 stickers 清空，等于「新列表里不含任何 sticker_id」——和成功分支
                // 同一类残影，正在显示的预览必然指向一个已经不在（空）列表里的贴纸，一并清掉。
                this.setState({ stickers: [], preview: null })
            }
        })
    }

    // 首次需要时才拉取贴纸（切到「我的贴纸」tab 时调用），之后不再重复拉。
    ensureStickersLoaded() {
        if (!this.stickersLoaded) {
            this.requestStickers()
        }
    }

    onAddClick = () => {
        this.fileInput?.click()
    }

    onFileChange = async () => {
        const file = this.fileInput?.files?.[0]
        if (this.fileInput) {
            this.fileInput.value = ""
        }
        if (!file) {
            return
        }
        // "+ 按钮点击 → 用户选文件" 之间的异步窗口内, 后端可能通过 appconfig 灰度把
        // stickerCustomEnabled 翻 false, 此时贴纸 tab / 上传按钮已从 UI 消失。沿用旧回调
        // 继续上传会与「入口已下线」的 UX 语义冲突, 也让请求白跑一趟。后端 /v1/sticker/user
        // 仍是最终守卫, 这里只是配合 UI 门控。
        if (!WKApp.remoteConfig.stickerCustomEnabled) {
            return
        }
        // 同一个异步窗口内运维也可能调整了上传上限，实时读取而非沿用组件挂载时的旧值。
        const limits = WKApp.remoteConfig.stickerUploadLimits
        if (!limits.allowedFormats.includes(getStickerFileExtension(file.name))) {
            Toast.error(t("base.sticker.formatUnsupported", { values: { formats: formatAllowedFormatsList(limits.allowedFormats) } }))
            return
        }
        if (file.size > limits.maxSizeKB * 1024) {
            Toast.error(t("base.sticker.tooLarge", { values: { size: formatStickerSizeLimit(limits.maxSizeKB) } }))
            return
        }
        // 在发起 dimension 探测(唯一的异步校验步骤)之前就置位 uploading, 让「+」按钮的
        // !uploading 门控立刻生效——否则解码期间按钮仍可点击, 用户能在同一张贴纸还没
        // 校验完时再选一张, 触发两个并发的 onFileChange/uploadSticker。finally 统一收尾
        // 保证无论哪条分支返回, uploading 都会被重置。
        this.setState({ uploading: true })
        try {
            const dimensions = await readStickerImageDimensions(file)
            if (this.isUnmounted) {
                return
            }
            // dimension 探测这段 await 期间, stickerCustomEnabled / 上传上限都可能被运维
            // 改掉, 沿用 await 之前捕获的旧值校验就失去了「实时」的意义。这里重新读一次
            // 最新快照, 和顶部 stickerCustomEnabled 守卫是同一套 TOCTOU 顾虑, 覆盖到新增
            // 的这段异步窗口。
            if (!WKApp.remoteConfig.stickerCustomEnabled) {
                return
            }
            const freshLimits = WKApp.remoteConfig.stickerUploadLimits
            // 解码失败（文件损坏等）fail-open：本地探测不出宽高不代表文件不合法，交给服务端
            // modules/file 侧做最终判断，不能因为这一步本地探测失败就拦掉本该合法的上传。
            if (dimensions && (dimensions.width > freshLimits.maxDimension || dimensions.height > freshLimits.maxDimension)) {
                Toast.error(t("base.sticker.dimensionTooLarge", { values: { dimension: String(freshLimits.maxDimension) } }))
                return
            }
            const uploaded = await WKApp.dataSource.commonDataSource.uploadSticker(file)
            await WKApp.dataSource.commonDataSource.addSticker({ path: uploaded.path, format: uploaded.format })
            await this.requestStickers()
            if (!this.isUnmounted) {
                this.setState({ category: STICKER_CATEGORY })
            }
        } catch {
            if (!this.isUnmounted) {
                Toast.error(t("base.sticker.addFailed"))
            }
        } finally {
            if (!this.isUnmounted) {
                this.setState({ uploading: false })
            }
        }
    }

    onDelete = (e: React.MouseEvent, sticker: StickerItem) => {
        e.stopPropagation()
        // × 的 onClick stopPropagation 会绕过 <li> 的 hideStickerPreview，删掉正在 hover 的
        // 那张贴纸后预览会残留在空位上（还会短暂渲染一张已不存在的贴纸），先清掉。
        this.hideStickerPreview()
        WKApp.dataSource.commonDataSource.deleteSticker(sticker.sticker_id).then(() => {
            this.requestStickers()
        }).catch(() => {
            if (!this.isUnmounted) {
                Toast.error(t("base.sticker.deleteFailed"))
            }
        })
    }

    // 按 format 分流：已知位图格式用 <img>，其余(含空/未知/tgs)走 tgs-player，与
    // 聊天气泡里的 LottieStickerCell 共用同一判定(isBitmapStickerFormat)，避免两处
    // 分流口径漂移把历史 .tgs 贴纸喂进 <img>(PR#496 review)。尺寸由 CSS
    // (.wk-sticker-item img/tgs-player) 统一控制。
    renderStickerMedia(sticker: StickerItem): ReactNode {
        const url = WKApp.dataSource.commonDataSource.getFileURL(sticker.path)
        if (isBitmapStickerFormat(sticker.format)) {
            return <img src={url} alt="" />
        }
        return <tgs-player autoplay mode="normal" src={url}></tgs-player>
    }

    // hover 进入某张贴纸：已有预览显示时立刻切换目标（格子间移动无缝跟随，对齐 Discord），
    // 否则起一个短延时再浮出，避免鼠标扫过网格时一路狂闪。rect 在进入时即取，用于把放大
    // 卡片按格子中心定位。
    private scheduleStickerPreview = (sticker: StickerItem, target: HTMLElement) => {
        const rect = target.getBoundingClientRect()
        // 先清掉可能仍在排队的旧延时，避免它稍后 fire 用旧 sticker/rect 覆盖更新的目标。
        if (this.previewTimer) {
            clearTimeout(this.previewTimer)
            this.previewTimer = null
        }
        if (this.state.preview) {
            this.setState({ preview: { sticker, rect } })
            return
        }
        this.previewTimer = setTimeout(() => {
            this.previewTimer = null
            // 延时排队期间贴纸列表也可能刷新掉这张（同 requestStickers 里的残影修复），
            // fire 时再核对一次，避免浮出一张已经不存在的贴纸。
            if (!this.isUnmounted && this.state.stickers.some((s) => s.sticker_id === sticker.sticker_id)) {
                this.setState({ preview: { sticker, rect } })
            }
        }, STICKER_PREVIEW_DELAY)
    }

    // 离开贴纸网格或点击发送后隐藏放大预览，并清掉尚未浮出的延时。
    private hideStickerPreview = () => {
        if (this.previewTimer) {
            clearTimeout(this.previewTimer)
            this.previewTimer = null
        }
        if (this.state.preview) {
            this.setState({ preview: null })
        }
    }

    // 离开某张贴纸格子：移到另一张贴纸时不隐藏（让它的 onMouseEnter 无缝切换目标，保留
    // Discord 式跟随）；移到「+」号 / 网格空白内边距 / 网格外等非贴纸目标时隐藏——否则指针
    // 虽已不在任何贴纸上、但仍在 <ul> 内，<ul> 的 mouseleave 不触发，预览会滞留在空位上。
    private onStickerLeave = (e: React.MouseEvent) => {
        const related = e.relatedTarget
        if (related instanceof Element && related.closest(".wk-sticker-item")) {
            return
        }
        this.hideStickerPreview()
    }

    // 把放大卡片定位并夹进视口（口径同 computePanelPos）：水平以格子中心对齐；垂直优先浮在
    // 格子上方（保留格子与删除「×」可见），上方空间不足则翻到格子下方，最后统一夹进视口。
    private computeStickerPreviewStyle(rect: DOMRect): React.CSSProperties {
        const vw = typeof window !== "undefined" ? window.innerWidth : STICKER_PREVIEW_SIZE
        const vh = typeof window !== "undefined" ? window.innerHeight : STICKER_PREVIEW_SIZE
        const m = STICKER_PREVIEW_MARGIN
        // 小视口兜底：卡片边长不超过可用视口，避免极窄/极矮窗口下夹取退化后仍溢出、盖住
        // 格子与删除「×」。正常面板尺寸下就是 STICKER_PREVIEW_SIZE。
        const size = Math.max(0, Math.min(STICKER_PREVIEW_SIZE, vw - 2 * m, vh - 2 * m))
        const left = Math.max(m, Math.min(rect.left + rect.width / 2 - size / 2, vw - size - m))
        let top = rect.top - STICKER_PREVIEW_GAP - size
        if (top < m) {
            top = rect.bottom + STICKER_PREVIEW_GAP
        }
        top = Math.max(m, Math.min(top, vh - size - m))
        return { left, top, width: size, height: size }
    }

    render(): React.ReactNode {
        const { emojis, category, stickers, uploading, preview } = this.state
        const { onEmoji, onSticker } = this.props
        // stickerCustomEnabled 关闭时: 隐藏贴纸 tab, 并把 isSticker 强制视为 false, 兜住
        // 「面板已打开且当前在 sticker tab, 后端灰度关掉开关」的边界——避免 tab 消失但
        // 内容区仍渲染上传/删除入口。纯 render-time 计算, 不触碰 state。
        const stickerCustomEnabled = WKApp.remoteConfig.stickerCustomEnabled
        const stickerUploadLimits = WKApp.remoteConfig.stickerUploadLimits
        const isSticker = stickerCustomEnabled && category === STICKER_CATEGORY
        // 放大预览层 portal 到 <body>，逃出 .wk-emojipanel-content 的 overflow:hidden 裁剪，
        // 并盖过面板（面板 z-index:999）。pointer-events:none（见 CSS）保证不拦截点击即发送。
        const previewOverlay = isSticker && preview && typeof document !== "undefined"
            ? ReactDOM.createPortal(
                <div className="wk-sticker-preview" style={this.computeStickerPreviewStyle(preview.rect)} aria-hidden="true">
                    {/* key 按 sticker_id：切换目标时重建媒体元素，避免复用同一 <tgs-player>、
                        只换 src 时 Lottie 动画不重启（沿用 renderStickerMedia 的分流）。 */}
                    {React.cloneElement(
                        this.renderStickerMedia(preview.sticker) as React.ReactElement,
                        { key: preview.sticker.sticker_id }
                    )}
                </div>,
                document.body
            )
            : null
        return <div className="wk-emojipanel">
            <div className={classNames("wk-emojipanel-content", isSticker ? "wk-emojipanel-content-sticker" : undefined)}>
                <ul onMouseLeave={this.hideStickerPreview}>
                    {
                        !isSticker ? emojis.map((emoji, i) => {
                            return <li key={i} onClick={(e) => {
                                e.stopPropagation()
                                if (onEmoji) {
                                    onEmoji(emoji)
                                }
                            }}>
                                <img src={emoji.image} style={{ width: 28, height: 28, objectFit: 'contain' }} />
                            </li>
                        }) : undefined
                    }
                    {
                        isSticker ? (
                            <li
                                key="__add__"
                                className="wk-sticker-add"
                                onClick={(e) => { e.stopPropagation(); if (!uploading) { this.onAddClick() } }}
                                title={t("base.sticker.add")}
                            >
                                {uploading
                                    ? <svg className="wk-sticker-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="40 18" /></svg>
                                    : <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>}
                            </li>
                        ) : undefined
                    }
                    {
                        isSticker ? stickers.map((sticker) => {
                            return <li key={sticker.sticker_id} className="wk-sticker-item"
                                onMouseEnter={(e) => this.scheduleStickerPreview(sticker, e.currentTarget)}
                                onMouseLeave={this.onStickerLeave}
                                onClick={(e) => {
                                e.stopPropagation()
                                this.hideStickerPreview()
                                if (onSticker) {
                                    onSticker(sticker)
                                }
                            }}>
                                {this.renderStickerMedia(sticker)}
                                <span
                                    className="wk-sticker-del"
                                    onClick={(e) => this.onDelete(e, sticker)}
                                    title={t("base.sticker.delete")}
                                >×</span>
                            </li>
                        }) : undefined
                    }
                    {
                        isSticker && stickers.length === 0 && !uploading
                            ? <li key="__empty__" className="wk-sticker-empty">{t("base.sticker.empty")}</li>
                            : undefined
                    }
                </ul>
            </div>
            <div className="wk-emojipanel-tab">
                <div className={classNames("wk-emojipanel-tab-item", !isSticker ? "wk-emojipanel-tab-item-selected" : undefined)} onClick={(e) => {
                    e.stopPropagation()
                    this.hideStickerPreview()
                    this.setState({ category: "emoji" })
                }}>
                    <img alt="" src={require("./emoji_tab_icon.png")}></img>
                </div>
                {stickerCustomEnabled ? (
                    <div className={classNames("wk-emojipanel-tab-item", isSticker ? "wk-emojipanel-tab-item-selected" : undefined)} onClick={(e) => {
                        e.stopPropagation()
                        this.setState({ category: STICKER_CATEGORY })
                        this.ensureStickersLoaded()
                    }} title={t("base.sticker.tab")}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.8" />
                            <circle cx="9" cy="10" r="1.2" fill="currentColor" />
                            <circle cx="15" cy="10" r="1.2" fill="currentColor" />
                            <path d="M8.5 14 a3.5 2.5 0 0 0 7 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                    </div>
                ) : undefined}
            </div>
            <input
                ref={(ref) => { this.fileInput = ref }}
                onChange={this.onFileChange}
                type="file"
                accept={stickerUploadLimits.allowedFormats.join(",")}
                style={{ display: "none" }}
            />
            {previewOverlay}
        </div>
    }
}
