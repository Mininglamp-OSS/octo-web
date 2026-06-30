import classNames from "classnames";
import React from "react";
import { Component, ReactNode } from "react";
import { EndpointID } from "../../Service/Const";
import WKApp from "../../App";
import { Emoji, EmojiService } from "../../Service/EmojiService";
import ConversationContext from "../Conversation/context";

import "./index.css"
import { LottieSticker } from "../../Messages/LottieSticker";
import IconClick from "../IconClick";

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
                    // this.setState({
                    //     animationStart: false
                    // })
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
    stickers: any[]
    stickerCategories: any[]
}

interface EmojiPanelProps {
    onEmoji?: (emoji: Emoji) => void
    onSticker?: (sticker: any) => void
}

export class EmojiPanel extends Component<EmojiPanelProps, EmojiPanelState> {
    emojiService: EmojiService

    constructor(props: any) {
        super(props)
        this.emojiService = WKApp.endpointManager.invoke(EndpointID.emojiService)
        this.state = {
            emojis: [],
            category: "emoji",
            stickers: [],
            stickerCategories: []
        }
    }

    componentDidMount() {
        this.setState({
            emojis: this.emojiService.getAllEmoji()
        })
        // 表情清单异步到达后刷新选择器（否则面板若在 load() 完成前挂载，要重开才显示新表情）。
        WKApp.mittBus.on("emoji-manifest-updated", this._onEmojiManifestUpdated)
        // 贴纸分类依赖后端 /sticker/* 接口，服务端尚未实现（sticker/user/category 返回 404）。
        // 暂不调用 requestStickerCategory()，避免每次挂载都触发必失败的请求；
        // 后端实现该端点后，恢复调用即可让贴纸分类 Tab 重新出现。
    }

    componentWillUnmount() {
        WKApp.mittBus.off("emoji-manifest-updated", this._onEmojiManifestUpdated)
    }

    private _onEmojiManifestUpdated = () => {
        this.setState({ emojis: this.emojiService.getAllEmoji() })
    }

    requestStickerCategory() {
        if (!this.state.stickerCategories || this.state.stickerCategories.length === 0) {
            WKApp.dataSource.commonDataSource.userStickerCategory().then((result) => {
                this.setState({ stickerCategories: result })
            })
        }
    }
    requestStickers(category: string) {
        WKApp.dataSource.commonDataSource.getStickers(category).then((result) => {
            this.setState({
                stickers: result.list,
            })
        })
    }

    render(): React.ReactNode {
        const { emojis, category, stickers, stickerCategories } = this.state
        const { onEmoji, onSticker } = this.props
        return <div className="wk-emojipanel">
            <div className={classNames("wk-emojipanel-content", category !== "emoji" ? "wk-emojipanel-content-sticker" : undefined)}>
                <ul>
                    {
                        category === "emoji" ? emojis.map((emoji, i) => {
                            return <li key={i} onClick={(e) => {
                                e.stopPropagation()
                                if (onEmoji) {
                                    onEmoji(emoji)
                                }
                            }}>
                                {/* <img src={require(`./emoji/${emoji.image}`)}> </img> */}
                                <img src={emoji.image} style={{ width: 28, height: 28, objectFit: 'contain' }} />
                            </li>
                        }) : undefined
                    }
                    {
                        stickers && stickers.length > 0 && category !== "emoji" ? stickers.map((sticker) => {
                            return <li key={sticker.path} onClick={(e) => {
                                e.stopPropagation()
                                if (onSticker) {
                                    onSticker(sticker)
                                }
                            }}>
                                {/* <img src={require(`./emoji/${emoji.image}`)}> </img> */}
                                <tgs-player style={{ width: "74px", height: "74px" }} autoplay mode="normal" src={WKApp.dataSource.commonDataSource.getFileURL(sticker.path)}></tgs-player>
                            </li>
                        }) : undefined
                    }
                </ul>
            </div>
            <div className="wk-emojipanel-tab">
                <div className={classNames("wk-emojipanel-tab-item", category === "emoji" ? "wk-emojipanel-tab-item-selected" : undefined)} onClick={(e) => {
                    e.stopPropagation()
                    this.setState({ category: "emoji" })
                }}>
                    <img alt="" src={require("./emoji_tab_icon.png")}></img>
                </div>
                {
                    stickerCategories.map((stickerCategory) => {
                        return (
                            <div key={stickerCategory.category} className={classNames("wk-emojipanel-tab-item", stickerCategory.category === category ? "wk-emojipanel-tab-item-selected" : undefined)} onClick={(e) => {
                                e.stopPropagation()
                                const category: string = stickerCategory.category || ""
                                this.setState({ category: category })
                                this.requestStickers(category)

                            }}>
                                <img alt="" src={WKApp.dataSource.commonDataSource.getFileURL(stickerCategory.cover)}></img>
                            </div>
                        )
                    })
                }
            </div>
        </div>
    }
}