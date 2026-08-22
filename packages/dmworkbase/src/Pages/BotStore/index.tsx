import React, { Component } from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import WKApp from "../../App"
import BotDetailModal from "../../Components/BotDetailModal"
import { I18nContext } from "../../i18n"
import "./index.css"

interface BotInfo {
    uid: string
    name: string
    description: string
    creator_uid: string
    creator_name: string
    bot_commands: string
    auto_approve?: number
    status?: string // not_added | pending | added
}

interface BotStoreState {
    myBots: BotInfo[]
    spaceBots: BotInfo[]
    loading: boolean
    activeTab: "my" | "store"
    applyingUid: string
    botDetailUid: string
    botDetailVisible: boolean
}

export default class BotStore extends Component<{}, BotStoreState> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    state: BotStoreState = {
        myBots: [],
        spaceBots: [],
        loading: true,
        activeTab: "store",
        botDetailUid: "",
        botDetailVisible: false,
        applyingUid: "",
    }

    private handleSpaceChanged = () => {
        this.loadData()
    }

    componentDidMount() {
        this.loadData()
        WKApp.mittBus.on('space-changed', this.handleSpaceChanged)
    }

    componentWillUnmount() {
        WKApp.mittBus.off('space-changed', this.handleSpaceChanged)
    }

    async loadData() {
        this.setState({ loading: true })
        try {
            const spaceId = WKApp.shared.currentSpaceId
            const [myRes, spaceRes] = await Promise.all([
                WKApp.apiClient.get("/robot/my_bots", spaceId ? { param: { space_id: spaceId } } : undefined),
                spaceId ? WKApp.apiClient.get(`/robot/space_bots`, { param: { space_id: spaceId } }) : Promise.resolve([]),
            ])
            this.setState({
                myBots: myRes || [],
                spaceBots: spaceRes || [],
                loading: false,
            })
        } catch {
            this.setState({ loading: false })
        }
    }

    handleChat = (uid: string) => {
        WKApp.endpoints.showConversation(new Channel(uid, ChannelTypePerson))
    }

    handleAddFriend = (uid: string) => {
        // 打开 BotDetailModal，走好友审核流程
        this.setState({ botDetailUid: uid, botDetailVisible: true })
    }

    handleBotFatherChat = () => {
        WKApp.endpoints.showConversation(new Channel("botfather", ChannelTypePerson))
    }

    renderBotCard(bot: BotInfo, showAction: boolean) {
        const { applyingUid } = this.state
        const { t } = this.context
        const isAdded = bot.status === "added"
        const isPending = bot.status === "pending"
        const isApplying = applyingUid === bot.uid

        return (
            <div className="wk-bot-card" key={bot.uid}>
                <div className="wk-bot-card-avatar">
                    {bot.name?.charAt(0)?.toUpperCase() || "B"}
                </div>
                <div className="wk-bot-card-info">
                    <div className="wk-bot-card-name">
                        {bot.name || bot.uid}
                        <span className="wk-bot-card-badge">AI</span>
                    </div>
                    <div className="wk-bot-card-desc">
                        {bot.description || t("base.botStore.noDescription")}
                    </div>
                    {bot.creator_name && (
                        <div className="wk-bot-card-creator">
                            {t("base.botStore.creator")} {bot.creator_name}
                        </div>
                    )}
                </div>
                <div className="wk-bot-card-action">
                    {showAction && isAdded && (
                        <button className="wk-bot-btn wk-bot-btn-chat" onClick={() => this.handleChat(bot.uid)}>
                            {t("base.botStore.chat")}
                        </button>
                    )}
                    {showAction && isPending && (
                        <button className="wk-bot-btn wk-bot-btn-pending" disabled>
                            {t("base.botStore.pending")}
                        </button>
                    )}
                    {showAction && !isAdded && !isPending && (
                        <button
                            className="wk-bot-btn wk-bot-btn-add"
                            disabled={isApplying}
                            onClick={() => this.handleAddFriend(bot.uid)}
                        >
                            {isApplying ? t("base.botStore.applying") : t("base.botStore.add")}
                        </button>
                    )}
                    {!showAction && (
                        <button className="wk-bot-btn wk-bot-btn-chat" onClick={() => this.handleChat(bot.uid)}>
                            {t("base.botStore.chat")}
                        </button>
                    )}
                </div>
            </div>
        )
    }

    render() {
        const { myBots, spaceBots, loading, activeTab } = this.state
        const { t } = this.context

        return (
            <div className="wk-bot-store">
                {/* BotFather 固定置顶 */}
                <div className="wk-bot-father" onClick={this.handleBotFatherChat}>
                    <div className="wk-bot-father-avatar">⚙️</div>
                    <div className="wk-bot-father-info">
                        <div className="wk-bot-father-name">BotFather</div>
                        <div className="wk-bot-father-desc">
                            {t("base.botStore.botFatherDesc")}
                        </div>
                    </div>
                    <div className="wk-bot-father-arrow">›</div>
                </div>

                {/* Tab 切换 */}
                <div className="wk-bot-tabs">
                    <div
                        className={`wk-bot-tab ${activeTab === "my" ? "active" : ""}`}
                        onClick={() => this.setState({ activeTab: "my" })}
                    >
                        {t("base.botStore.myAI", { values: { count: myBots.length } })}
                    </div>
                    <div
                        className={`wk-bot-tab ${activeTab === "store" ? "active" : ""}`}
                        onClick={() => this.setState({ activeTab: "store" })}
                    >
                        {t("base.botStore.aiPlaza", { values: { count: spaceBots.length } })}
                    </div>
                </div>

                {/* 列表 */}
                <div className="wk-bot-list">
                    {loading && <div className="wk-bot-loading">{t("base.botStore.loading")}</div>}
                    {!loading && activeTab === "my" && myBots.length === 0 && (
                        <div className="wk-bot-empty">
                            {t("base.botStore.myEmptyTitle")}<br/>{t("base.botStore.myEmptyHint")}
                        </div>
                    )}
                    {!loading && activeTab === "store" && spaceBots.length === 0 && (
                        <div className="wk-bot-empty">{t("base.botStore.storeEmpty")}</div>
                    )}
                    {!loading && activeTab === "my" && myBots.map(bot => this.renderBotCard(bot, false))}
                    {!loading && activeTab === "store" && spaceBots.map(bot => this.renderBotCard(bot, true))}
                </div>
                <BotDetailModal
                    uid={this.state.botDetailUid || ""}
                    visible={this.state.botDetailVisible}
                    onClose={() => {
                        this.setState({ botDetailVisible: false })
                        setTimeout(() => this.loadData(), 500)
                    }}
                    onChat={(channel) => {
                        WKApp.endpoints.showConversation(channel)
                        this.setState({ botDetailVisible: false })
                    }}
                />
            </div>
        )
    }
}
