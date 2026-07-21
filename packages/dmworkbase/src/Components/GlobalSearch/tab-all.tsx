import React, { Component } from "react";
import { ReactNode } from "react";
import Section from "./section";
import ItemMessage from "./item-message";
import WKApp from "../../App";
import "./tab-all.css"
import WKSDK, { Channel, ChannelInfo, ChannelInfoListener, ChannelTypePerson, MessageContentType } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../Service/Const";
import { debounce, throttle } from "../../Utils/rateLimit";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import VisibilityTrigger from "../VisibilityTrigger";
import { I18nContext } from "../../i18n";
import { addImChannelInfoListener, fetchImChannelInfo, getImChannelInfo } from "../../im-runtime/channelRuntime";


interface TabAllProps {
    keyword?: string;
    searchResult?: any;
    loadMore?: () => void; // 添加加载更多的回调函数
    // item点击事件，传递item和type，type为contacts、group、message
    onClick?: (item: any, type: string) => void;
}

export default class TabAll extends Component<TabAllProps> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    handleScroll = throttle((event: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
        if (scrollTop + clientHeight >= scrollHeight) {
            if (this.props.loadMore) {
                this.props.loadMore();
            }
        }
    }, 100);

    // 懒加载：仅视口内的消息才拉发送者 channelInfo。debounce 合批 forceUpdate，
    // fetchedUids 防止同 uid 重复请求。
    private _channelInfoListener!: ChannelInfoListener
    private unsubscribeChannelInfoListener?: () => void
    private _forceUpdateDebounced = debounce(() => this.forceUpdate(), 150)
    private fetchedUids = new Set<string>()

    componentDidMount() {
        this._channelInfoListener = (channelInfo: ChannelInfo) => {
            if (channelInfo?.channel?.channelType === ChannelTypePerson) {
                this._forceUpdateDebounced()
            }
        }
        this.unsubscribeChannelInfoListener = addImChannelInfoListener(WKSDK.shared(), this._channelInfoListener)
    }

    componentWillUnmount() {
        this.unsubscribeChannelInfoListener?.()
        this.unsubscribeChannelInfoListener = undefined
        this._forceUpdateDebounced.cancel()
    }

    private requestSenderChannelInfoIfNeeded = (fromUid: string) => {
        if (!fromUid || this.fetchedUids.has(fromUid)) return
        const senderChannel = new Channel(fromUid, ChannelTypePerson)
        if (getImChannelInfo(WKSDK.shared(), senderChannel)) return
        this.fetchedUids.add(fromUid)
        void fetchImChannelInfo(WKSDK.shared(), senderChannel)
    }

    /**
     * 计算一条搜索到的消息中「发送者相对当前查看 Space」的来源
     * Space 名称。优先读 msg-level 新字段（from_home_space_id / name），
     * 缺失时回落到 msg-level 旧字段（from_is_external / from_source_space_name），
     * 再缺失时从已缓存的发送者 channelInfo.orgData 补齐，最终由
     * resolveExternalForViewer 统一判定。返回空字符串表示同 Space / 内部消息。
     */
    private resolveMessageSenderSourceSpaceName(item: any): string {
        if (!item) return ""
        // 消息级字段（来自 /search/global → 后端 message）
        let homeId: string | undefined = item.from_home_space_id
        let homeName: string | undefined = item.from_home_space_name
        let isExternalLegacy: number | undefined =
            typeof item.from_is_external === "boolean"
                ? (item.from_is_external ? 1 : 0)
                : item.from_is_external
        let sourceNameLegacy: string | undefined = item.from_source_space_name

        // 兜底：从发送者 channelInfo.orgData 取（tab-all 已经 fetch/获取过）
        if (!homeId && (isExternalLegacy === undefined || isExternalLegacy === null) && item.from_uid) {
            const senderChannel = new Channel(item.from_uid, ChannelTypePerson)
            const ci = getImChannelInfo(WKSDK.shared(), senderChannel)
            const org = ci?.orgData
            if (org) {
                // homeId / isExternalLegacy 已经过 !homeId / undefined|null 判据，
                // 此分支内必为 falsy，直接赋值；homeName / sourceNameLegacy 仍
                // 可能已在 msg-level 取到，保留 ?? 兜底。
                homeId = org.home_space_id as string | undefined
                homeName = homeName ?? (org.home_space_name as string | undefined)
                isExternalLegacy = org.is_external as number | undefined
                sourceNameLegacy =
                    sourceNameLegacy ?? (org.source_space_name as string | undefined)
            }
        }

        const { isExternal, sourceSpaceName } = resolveExternalForViewer({
            homeSpaceId: homeId,
            homeSpaceName: homeName,
            isExternalLegacy,
            sourceSpaceNameLegacy: sourceNameLegacy,
        })
        return isExternal ? sourceSpaceName : ""
    }

    render(): ReactNode {

        let existMessages = this.props.searchResult?.messages.length > 0

        return <div className="wk-tab-all" onScroll={this.handleScroll}>

            {
                !this.props.searchResult && !this.props.keyword && (
                    <div style={{ textAlign: 'center', color: 'var(--wk-text-tertiary, #9498A8)', padding: '48px 0', fontSize: '13px' }}>
                        {this.context.t("base.globalSearch.startHint")}
                    </div>
                )
            }

            {
                existMessages ? (
                    <Section title={this.context.t("base.globalSearch.messages")}>
                        {
                            this.props.searchResult?.messages.map((item: any) => {
                                let digest = this.context.t("base.globalSearch.unknownMessage")
                                if(item.content) {
                                    digest = item.content.conversationDigest
                                }else {
                                    if (item.payload.type === MessageContentType.text) {
                                        digest = item.payload.content
                                    } else if (item.payload.type === MessageContentTypeConst.file) {
                                        digest = `[${item.payload.name}]`
                                    }
                                }


                                let sender;
                                if (item.channel?.channel_type !== ChannelTypePerson && item.from_uid && item.from_uid !== "") {
                                    const senderChannel = new Channel(item.from_uid, ChannelTypePerson)
                                    const channelInfo = getImChannelInfo(WKSDK.shared(), senderChannel)
                                    if (channelInfo) {
                                        sender = channelInfo.title
                                    }
                                    // 缺失时交由 VisibilityTrigger 在行进入视口时按需拉取，
                                    // 不在 render 中产生副作用
                                }

                                // 跨 Space 搜索消息时在发送者名字后展示来源 Space
                                const senderSourceSpaceName =
                                    this.resolveMessageSenderSourceSpaceName(item)

                                // 永远用 VisibilityTrigger 包裹（首次 fire 后 observer
                                // 已 disconnect，相当于一个无副作用的 div）。避免
                                // VisibilityTrigger ↔ Fragment 切换让同 key 节点被
                                // unmount + remount，引发 WKAvatar 重建。
                                return <VisibilityTrigger
                                    key={item.message_idstr}
                                    onVisible={() => {
                                        if (item.from_uid) {
                                            this.requestSenderChannelInfoIfNeeded(item.from_uid)
                                        }
                                    }}
                                >
                                    <ItemMessage
                                        sender={sender}
                                        senderSourceSpaceName={senderSourceSpaceName}
                                        digest={digest}
                                        name={item.channel?.channel_name}
                                        avatar={WKApp.shared.avatarChannel(new Channel(item.channel?.channel_id, item.channel?.channel_type))}
                                        onClick={() => {
                                            if (this.props.onClick) {
                                                this.props.onClick(item, "message")
                                            }
                                        }}
                                    />
                                </VisibilityTrigger>
                            })
                        }
                    </Section>
                ) : null
            }


        </div>
    }
}
