import React, { Component } from "react";
import { ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";
import ItemContacts from "./item-contacts";
import WKApp from "../../App";
import { isBot } from "../WKAvatar";
import BotDetailModal from "../BotDetailModal";
import WKSDK, { Channel, ChannelInfo, ChannelInfoListener, ChannelTypePerson } from "wukongimjssdk";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import { debounce } from "../../Utils/rateLimit";
import { addImChannelInfoListener, fetchImChannelInfo, getImChannelInfo } from "../../im-runtime/channelRuntime";
import "./tab-contacts.css"

interface TabContactsProps {
    keyword?: string;
    friends?: any[];
    onClick?: (item: any) => void;
    // #989: bot 名片"发送消息"跳转会话后，外层搜索弹窗需要一起关掉
    hideModal?: () => void;
}

interface TabContactsState {
    botDetailUid: string;
    botDetailVisible: boolean;
}

export default class TabContacts extends Component<TabContactsProps, TabContactsState> {
    state: TabContactsState = {
        botDetailUid: "",
        botDetailVisible: false,
    };

    // channelInfo 到达后强制重渲，否则 resolveSourceSpaceName
    // 首次读缓存未命中时，UI 永远不更新。
    // 懒加载重构：使用 debounce 合批 forceUpdate，避免视口内多个 uid 集中返回
    // 时触发 N 次重渲；并用 fetchedUids 记录已发起过的 uid，避免重复请求。
    private _channelInfoListener!: ChannelInfoListener
    private unsubscribeChannelInfoListener?: () => void
    private _forceUpdateDebounced = debounce(() => this.forceUpdate(), 150)
    private fetchedUids = new Set<string>()
    // Sticky friends：files tab 切换时父层会把 friends 置为 undefined 触发
    // /search/global 重拉，中间这段时间我们保留上一次的非空数据继续渲染，
    // 避免 ItemContacts / <img> 节点被销毁-重建造成头像请求全量重发。
    private stickyFriends?: any[]

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

    // 懒加载：仅当 friend 进入视口且字段缺失时，才触发 channelInfo 拉取。
    // 通过 fetchedUids 去重，避免 forceUpdate 后重复发起同 uid 请求。
    private requestChannelInfoIfNeeded = (friend: any) => {
        if (!friend?.channel_id) return
        const org = friend?.orgData ?? {}
        const homeId: string | undefined = friend?.home_space_id ?? org.home_space_id
        const isExternalLegacy: number | undefined =
            friend?.is_external ?? org.is_external
        const missingHome = !homeId
        const missingLegacy =
            isExternalLegacy === undefined || isExternalLegacy === null
        if (!(missingHome && missingLegacy)) return
        if (this.fetchedUids.has(friend.channel_id)) return
        const ch = new Channel(friend.channel_id, ChannelTypePerson)
        if (getImChannelInfo(WKSDK.shared(), ch)) return
        this.fetchedUids.add(friend.channel_id)
        void fetchImChannelInfo(WKSDK.shared(), ch)
    }

    /**
     * 判定搜索到的联系人相对当前查看 Space 是否为外部成员，返回要
     * 展示在姓名后的「@{sourceSpaceName}」文本。优先读 friend 项自身带的
     * home_space_id / home_space_name / is_external / source_space_name 字段；
     * 缺失时回落到 channelInfo.orgData，同 @Mention 候选、成员列表保持一致。
     * 返回空字符串表示同 Space / 非外部 / 信息不足，上层不渲染后缀。
     * 该方法现为纯函数：不再主动触发 fetchChannelInfo。按需拉取逻辑由
     * requestChannelInfoIfNeeded 在 Virtuoso 渲染视口内 item 时处理。
     */
    private resolveSourceSpaceName(friend: any): string {
        const org = friend?.orgData ?? {}
        let homeId: string | undefined = friend?.home_space_id ?? org.home_space_id
        let homeName: string | undefined = friend?.home_space_name ?? org.home_space_name
        let isExternalLegacy: number | undefined = friend?.is_external ?? org.is_external
        let sourceNameLegacy: string | undefined =
            friend?.source_space_name ?? org.source_space_name

        // 回落：friend 顶层与 orgData 都没有外部字段时，读已缓存的 channelInfo
        const missingHome = !homeId
        const missingLegacy =
            isExternalLegacy === undefined || isExternalLegacy === null
        if (missingHome && missingLegacy && friend?.channel_id) {
            const ch = new Channel(friend.channel_id, ChannelTypePerson)
            const ci = getImChannelInfo(WKSDK.shared(), ch)
            const ciOrg = ci?.orgData
            if (ciOrg) {
                homeId = ciOrg.home_space_id as string | undefined
                homeName = homeName ?? (ciOrg.home_space_name as string | undefined)
                isExternalLegacy = ciOrg.is_external as number | undefined
                sourceNameLegacy =
                    sourceNameLegacy ??
                    (ciOrg.source_space_name as string | undefined)
            }
            // 缓存未命中：保持 sourceSpaceName="" 由 Virtuoso 渲染视口 item 时
            // 触发 requestChannelInfoIfNeeded → channelInfoListener → forceUpdate
            // 补上，不在 render 中产生副作用
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
        // friends undefined 时保持上次值，避免 tab 切换中途父层清空 searchResult
        // 导致列表 DOM 被销毁、头像 <img> 重挂发起重复请求。
        // 空数组（搜索无结果）视为有效数据，照常清空列表。
        const incoming = this.props.friends
        if (incoming !== undefined) {
            this.stickyFriends = incoming
        }
        const friends = this.stickyFriends ?? []
        return <div className="wk-tab-contacts">
            <Virtuoso
                style={{ height: "100%" }}
                data={friends}
                // 视口外保留 200px，滚动时少闪；语义与原 VisibilityTrigger rootMargin "100px 0px" 相当
                increaseViewportBy={200}
                itemContent={(_index, item) => this.renderItem(item)}
            />
            <BotDetailModal
                uid={this.state.botDetailUid}
                visible={this.state.botDetailVisible}
                onClose={() => this.setState({ botDetailVisible: false })}
                onChat={(channel) => {
                    WKApp.endpoints.showConversation(channel);
                    this.setState({ botDetailVisible: false });
                    this.props.hideModal?.();
                }}
            />
        </div>
    }

    private renderItem(item: any): ReactNode {
        // 用 local displayName 替代对 item.channel_name 的 mutation。
        // 之前直接改 item.channel_name（props / 源数据）会在 listener 触发 re-render
        // 后累积成 <mark><mark>key</mark></mark>（double-wrap），sanitizeHighlight
        // 虽然 escape 但视觉退化。保留源数据干净，仅渲染时替换。
        let displayName: string = item.channel_name
        if (this.props.keyword && item.channel_name.indexOf(this.props.keyword) !== -1) {
            displayName = item.channel_name.replace(
                this.props.keyword,
                `<mark>${this.props.keyword}</mark>`
            )
        }
        // Virtuoso 只渲染视口内 item，等价于懒挂载；进入视口时按需触发 channelInfo 拉取。
        // fetchedUids 去重避免 forceUpdate / 重入导致重复请求。
        this.requestChannelInfoIfNeeded(item)
        // 跨 Space 搜索联系人时展示来源 Space，避免误选外部成员
        const sourceSpaceName = this.resolveSourceSpaceName(item)
        return <ItemContacts
            name={displayName}
            avatar={WKApp.shared.avatarUser(item.channel_id)}
            isBot={isBot(item.channel_id)}
            sourceSpaceName={sourceSpaceName}
            onClick={() => {
                // #106: Bot 搜索结果点击弹名片
                if (isBot(item.channel_id)) {
                    this.setState({ botDetailUid: item.channel_id, botDetailVisible: true });
                    return;
                }
                if (this.props.onClick) {
                    this.props.onClick(item)
                }
            }}
        />
    }
}
