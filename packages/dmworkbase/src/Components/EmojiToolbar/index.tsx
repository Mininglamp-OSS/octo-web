import classNames from "classnames";
import React from "react";
import { Component, ReactNode } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { EndpointID } from "../../Service/Const";
import WKApp from "../../App";
import { Emoji, EmojiService } from "../../Service/EmojiService";
import { StickerItem } from "../../Service/DataSource/DataSource";
import ConversationContext from "../Conversation/context";

import "./index.css"
import { LottieSticker } from "../../Messages/LottieSticker";
import IconClick from "../IconClick";

// 自定义贴纸 tab 的内部标识。贴纸是扁平的（不分包），所以只有这一个固定 tab。
const STICKER_CATEGORY = "sticker"
// 客户端侧的上传约束，与服务端保持一致（StickerMaxFileSize=1MB；格式白名单）。
// 服务端是最终防线，这里只是即时反馈、少打一次必失败的请求。
const MAX_STICKER_BYTES = 1 * 1024 * 1024
const ACCEPTED_STICKER_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"]

interface EmojiToolbarProps {
    conversationContext: ConversationContext
    icon: string | React.ReactNode
}

interface EmojiToolbarState {
    show: boolean
    animationStart: boolean
}

export default class EmojiToolbar extends Component<EmojiToolbarProps, EmojiToolbarState>{

    constructor(props: any) {
        super(props)
        this.state = {
            show: false,
            animationStart: false,
        }
    }

    render(): ReactNode {
        const { show, animationStart } = this.state
        const { icon, conversationContext } = this.props
        return <div className="wk-emojitoolbar" >
            <IconClick
                size="sm"
                icon={typeof icon === 'string' ? <img src={icon} alt="" /> : icon}
                onClick={() => {
                    this.setState({ show: !show, animationStart: true })
                }}
            />
            <div onAnimationEnd={() => {
                    if (!show) {
                        this.setState({
                            animationStart: false,
                        })
                    }
                }} className={classNames("wk-emojitoolbar-emojipanel", animationStart ? (show ? "wk-emojitoolbar-emojipanel-show" : "wk-emojitoolbar-emojipanel-hide") : undefined)}>
                    <EmojiPanel onSticker={(sticker) => {
                        this.setState({
                            show: false
                        })
                        const lottieSticker = new LottieSticker()
                        lottieSticker.category = sticker.category
                        lottieSticker.url = sticker.path
                        lottieSticker.placeholder = sticker.placeholder
                        lottieSticker.format = sticker.format
                        conversationContext.sendMessage(lottieSticker)
                    }} onEmoji={(emoji) => {
                        this.setState({
                            show: false
                        })
                        conversationContext.messageInputContext().insertText(emoji.key)
                    }}></EmojiPanel>
            </div>
            {
                show ? <div className="wk-emojitoolbar-mask" onClick={()=>{
                    this.setState({
                        show: false,
                    })
                }}>
                </div> : undefined
            }

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
        // 预拉一次自定义贴纸，让「我的贴纸」tab 切过去即有内容。空集合返回
        // {list:[]}（issue #26 起后端已提供该端点，不再 404）。
        this.requestStickers()
    }

    componentWillUnmount() {
        WKApp.mittBus.off("emoji-manifest-updated", this._onEmojiManifestUpdated)
    }

    private _onEmojiManifestUpdated = () => {
        this.setState({ emojis: this.emojiService.getAllEmoji() })
    }

    requestStickers() {
        WKApp.dataSource.commonDataSource.userStickers().then((result) => {
            this.setState({ stickers: result.list || [] })
        }).catch(() => {
            this.setState({ stickers: [] })
        })
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
            Toast.error("仅支持 gif、png、jpg、jpeg、webp 格式")
            return
        }
        if (file.size > MAX_STICKER_BYTES) {
            Toast.error("贴纸大小不能超过 1MB")
            return
        }
        this.setState({ uploading: true })
        try {
            const uploaded = await WKApp.dataSource.commonDataSource.uploadSticker(file)
            await WKApp.dataSource.commonDataSource.addSticker({ path: uploaded.path, format: uploaded.format })
            this.requestStickers()
            this.setState({ category: STICKER_CATEGORY })
        } catch {
            Toast.error("添加贴纸失败")
        } finally {
            this.setState({ uploading: false })
        }
    }

    onDelete = (e: React.MouseEvent, sticker: StickerItem) => {
        e.stopPropagation()
        WKApp.dataSource.commonDataSource.deleteSticker(sticker.sticker_id).then(() => {
            this.requestStickers()
        }).catch(() => {
            Toast.error("删除贴纸失败")
        })
    }

    // 按 format 分流：tgs/lottie 用 tgs-player，其余位图用 <img>。
    renderStickerMedia(sticker: StickerItem, size: number): ReactNode {
        const url = WKApp.dataSource.commonDataSource.getFileURL(sticker.path)
        if ((sticker.format || "").toLowerCase() === "tgs") {
            return <tgs-player style={{ width: `${size}px`, height: `${size}px` }} autoplay mode="normal" src={url}></tgs-player>
        }
        return <img src={url} style={{ width: `${size}px`, height: `${size}px`, objectFit: "contain" }} alt="" />
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
                                className="wk-emojipanel-sticker-add"
                                onClick={(e) => { e.stopPropagation(); this.onAddClick() }}
                                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "74px", height: "74px", border: "1px dashed #ccc", borderRadius: "8px", cursor: "pointer", fontSize: "28px", color: "#999" }}
                            >
                                {uploading ? "…" : "+"}
                            </li>
                        ) : undefined
                    }
                    {
                        isSticker ? stickers.map((sticker) => {
                            return <li key={sticker.sticker_id} style={{ position: "relative" }} onClick={(e) => {
                                e.stopPropagation()
                                if (onSticker) {
                                    onSticker(sticker)
                                }
                            }}>
                                {this.renderStickerMedia(sticker, 74)}
                                <span
                                    className="wk-emojipanel-sticker-del"
                                    onClick={(e) => this.onDelete(e, sticker)}
                                    title="删除"
                                    style={{ position: "absolute", top: "-4px", right: "-4px", width: "16px", height: "16px", lineHeight: "14px", textAlign: "center", borderRadius: "50%", background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: "12px", cursor: "pointer" }}
                                >×</span>
                            </li>
                        }) : undefined
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
                    this.requestStickers()
                }} title="我的贴纸">
                    <span style={{ fontSize: "20px", lineHeight: "1" }}>🙂</span>
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
