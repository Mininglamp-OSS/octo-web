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
// 客户端侧的上传约束，与服务端保持一致（StickerMaxFileSize=1MB；格式白名单）。
// 服务端是最终防线，这里只是即时反馈、少打一次必失败的请求。
const MAX_STICKER_BYTES = 1 * 1024 * 1024
const ACCEPTED_STICKER_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"]

// 面板尺寸（与 index.css 的 .wk-emojitoolbar-emojipanel 保持一致）与视口避让间距，
// 用于把面板按按钮位置定位并夹进视口，避免溢出/被祖先裁剪。
const EMOJI_PANEL_WIDTH = 460
const EMOJI_PANEL_HEIGHT = 372
const EMOJI_PANEL_GAP = 12
const EMOJI_PANEL_MARGIN = 8

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

    constructor(props: any) {
        super(props)
        this.emojiService = WKApp.endpointManager.invoke(EndpointID.emojiService)
        this.state = {
            emojis: [],
            category: "emoji",
            stickers: [],
            uploading: false,
        }
    }

    componentDidMount() {
        this.setState({
            emojis: this.emojiService.getAllEmoji()
        })
        // 表情清单（服务端内置表情，web#492）异步到达后刷新选择器，否则面板若在
        // load() 完成前挂载，要重开才显示新表情。
        WKApp.mittBus.on("emoji-manifest-updated", this._onEmojiManifestUpdated)
        // 贴纸列表延迟到首次切到「我的贴纸」tab 时再拉（ensureStickersLoaded），
        // 避免每次打开表情面板都打一次 sticker/user 请求（PR#496 review P2-1）。
    }

    componentWillUnmount() {
        this.isUnmounted = true
        WKApp.mittBus.off("emoji-manifest-updated", this._onEmojiManifestUpdated)
    }

    private _onEmojiManifestUpdated = () => {
        if (this.isUnmounted) {
            return
        }
        this.setState({ emojis: this.emojiService.getAllEmoji() })
    }

    requestStickers(): Promise<void> {
        return WKApp.dataSource.commonDataSource.userStickers().then((result) => {
            this.stickersLoaded = true
            if (!this.isUnmounted) {
                this.setState({ stickers: result.list || [] })
            }
        }).catch(() => {
            if (!this.isUnmounted) {
                this.setState({ stickers: [] })
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
        if (!ACCEPTED_STICKER_TYPES.includes(file.type)) {
            Toast.error(t("base.sticker.formatUnsupported"))
            return
        }
        if (file.size > MAX_STICKER_BYTES) {
            Toast.error(t("base.sticker.tooLarge", { values: { size: "1MB" } }))
            return
        }
        this.setState({ uploading: true })
        try {
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

    render(): React.ReactNode {
        const { emojis, category, stickers, uploading } = this.state
        const { onEmoji, onSticker } = this.props
        const isSticker = category === STICKER_CATEGORY
        return <div className="wk-emojipanel">
            <div className={classNames("wk-emojipanel-content", isSticker ? "wk-emojipanel-content-sticker" : undefined)}>
                <ul>
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
                            return <li key={sticker.sticker_id} className="wk-sticker-item" onClick={(e) => {
                                e.stopPropagation()
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
                    this.setState({ category: "emoji" })
                }}>
                    <img alt="" src={require("./emoji_tab_icon.png")}></img>
                </div>
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
            </div>
            <input
                ref={(ref) => { this.fileInput = ref }}
                onChange={this.onFileChange}
                type="file"
                accept={ACCEPTED_STICKER_TYPES.join(",")}
                style={{ display: "none" }}
            />
        </div>
    }
}
