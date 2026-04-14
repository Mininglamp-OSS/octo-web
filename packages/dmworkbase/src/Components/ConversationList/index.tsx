import WKSDK from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk";
import { Channel, ChannelInfo, ChannelTypePerson, ChannelTypeGroup } from "wukongimjssdk";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import { parseThreadChannelId } from "../../Service/Thread";
import React, { Component } from "react";
import { Modal } from "@douyinfe/semi-ui";
import { ConversationWrap, MessageWrap } from "../../Service/Model";
import { getTimeStringAutoShort2 } from '../../Utils/time'
import classNames from "classnames";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import "./index.css"
import { Badge, Toast } from "@douyinfe/semi-ui";
import WKApp from "../../App";
import { EndpointID } from "../../Service/Const";
import { Hash } from "lucide-react";
import ThreadIcon from "../Icons/ThreadIcon";
import ContextMenus, { ContextMenusContext, ContextMenusData } from "../ContextMenus";
import { ChannelSettingManager } from "../../Service/ChannelSetting";
import { TypingListener, TypingManager } from "../../Service/TypingManager";
import { BeatLoader } from "react-spinners";
import { RevokeCell } from "../../Messages/Revoke";
import { FlameMessageCell } from "../../Messages/Flame";
import WKAvatar from "../WKAvatar";
import AiBadge from "../AiBadge";
import ConversationVM from "../Conversation/vm";
export type ConvFilter = 'all' | 'human' | 'ai' | 'group' | 'dm'

// ── CompactGroupItem：群聊 Tab 紧凑 item，支持拖拽 ──────────────────────
interface CompactGroupItemProps {
    conversationWrap: ConversationWrap
    selected: boolean
    onClick: () => void
    onContextMenu: (e: React.MouseEvent) => void
    /** 该群聊有子区，需要在 # icon 下方画竖线 */
    hasThreads?: boolean
}

const CompactGroupItem: React.FC<CompactGroupItemProps> = ({
    conversationWrap, selected, onClick, onContextMenu, hasThreads,
}) => {
    const channelInfo = conversationWrap.channelInfo
    // channelInfo 未加载时主动拉取，加载完触发 re-render
    React.useEffect(() => {
        if (!channelInfo) {
            WKSDK.shared().channelManager.fetchChannelInfo(conversationWrap.channel)
        }
    }, [conversationWrap.channel.channelID])

    const isThread = conversationWrap.channel.channelType === ChannelTypeCommunityTopic

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `grp::${conversationWrap.channel.channelID}`,
        data: {
            type: 'group',
            groupNo: conversationWrap.channel.channelID,
        },
        // 子区不参与跨分组拖拽
        disabled: isThread,
    })

    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : undefined,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            key={conversationWrap.channel.getChannelKey()}
            className={classNames(
                "wk-conv-compact-item",
                selected ? "wk-conv-compact-item--selected" : undefined,
                conversationWrap.unread > 0 ? "wk-conv-compact-item--unread" : undefined,
                isThread ? "wk-conv-compact-item--thread" : undefined,
                isDragging ? "wk-conv-compact-item--dragging" : undefined,
                hasThreads ? "wk-conv-compact-item--has-threads" : undefined,
            )}
            onClick={onClick}
            onContextMenu={onContextMenu}
        >
            {/* 拖拽 handle（非子区才显示） */}
            {!isThread && (
                <span
                    className="wk-conv-compact-drag-handle"
                    {...attributes}
                    {...listeners}
                    onClick={e => e.stopPropagation()}
                >
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
                        <circle cx="3" cy="3" r="1.2" fill="currentColor" />
                        <circle cx="7" cy="3" r="1.2" fill="currentColor" />
                        <circle cx="3" cy="7" r="1.2" fill="currentColor" />
                        <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                        <circle cx="3" cy="11" r="1.2" fill="currentColor" />
                        <circle cx="7" cy="11" r="1.2" fill="currentColor" />
                    </svg>
                </span>
            )}
            <span className="wk-conv-compact-icon">
                {isThread
                    ? <ThreadIcon size={13} />
                    : <Hash size={14} strokeWidth={2} />
                }
            </span>
            <span className="wk-conv-compact-name">
                {channelInfo?.orgData.displayName ?? conversationWrap.channel.channelID}
            </span>
            {conversationWrap.unread > 0 && (
                <span className="wk-conv-compact-badge">
                    {conversationWrap.unread > 99 ? '99+' : conversationWrap.unread}
                </span>
            )}
        </div>
    )
}
// ────────────────────────────────────────────────────────────────────────────

export interface ConversationListProps {
    conversations: ConversationWrap[]
    select?: Channel
    /** 外部控制过滤，不传则内部默认 'all' */
    filter?: ConvFilter
    /** 紧凑模式：隐藏头像/消息预览/时间戳，显示 # icon，用于群聊 Tab */
    compact?: boolean
    onClick?: (conversation: ConversationWrap) => void
    onClearMessages?: (channel: Channel) => void
    /** 点击 "+N 个子区" 时的回调，传入父群组 ID */
    onThreadOverflowClick?: (groupNo: string) => void
    /** 外部注入的额外右键菜单项，追加到内置菜单之后 */
    extraContextMenus?: (conversation: ConversationWrap | undefined) => ContextMenusData[]
}

export interface ConversationListState {
    selectConversationWrap?: ConversationWrap
    /** compact 模式：已展开全部子区的父群聊 ID 集合（点击 +N 后加入） */
    expandedGroupIds: Set<string>
}

export default class ConversationList extends Component<ConversationListProps, ConversationListState>{
    channelListener!: ChannelInfoListener
    contextMenusContext!: ContextMenusContext
    typingListener!: TypingListener
    constructor(props: ConversationListProps) {
        super(props)

        this.state = { expandedGroupIds: new Set() }
    }

    componentDidMount() {
        this.channelListener = (channelInfo: ChannelInfo) => {
            this.setState({})
        }
        WKSDK.shared().channelManager.addListener(this.channelListener)

        this.typingListener = (channel: Channel, add: boolean) => {
            this.setState({})
        }
        TypingManager.shared.addTypingListener(this.typingListener)

    }

    componentWillUnmount() {
        WKSDK.shared().channelManager.removeListener(this.channelListener)
        TypingManager.shared.removeTypingListener(this.typingListener)
    }


    _handleScroll = () => {
        this.contextMenusContext.hide()
    }
    _handleContextMenu(conversationWrap: ConversationWrap, event: React.MouseEvent) {
        this.contextMenusContext.show(event)
        this.setState({
            selectConversationWrap: conversationWrap
        })
    }

    _getTypingUI(conversationWrap: ConversationWrap) {
        const { select } = this.props
        const typing = TypingManager.shared.getTyping(conversationWrap.channel)
        const selected = select && select.isEqual(conversationWrap.channel)
        return <div className="wk-typing"><BeatLoader size={4} margin={3} color={selected ? "white" : "var(--wk-color-theme)"} />&nbsp;&nbsp;{conversationWrap.channel.channelType !== ChannelTypePerson ? typing?.fromName : ""}正在输入</div>
    }

    lastContent(conversationWrap: ConversationWrap) {
        if (!conversationWrap.lastMessage) {
            return
        }
        const draft = conversationWrap.remoteExtra.draft
        if(draft && draft!=="") {
            return draft
        }
        // 检查是否有进行中的 AI 折叠 session
        const foldPreview = ConversationVM.foldSessionPreview.get(conversationWrap.channel.getChannelKey())
        if (foldPreview) {
            return (
                <span className="wk-ai-collab-preview">
                    <span className="wk-ai-collab-tag">
                        <span className="wk-ai-collab-pulse" />
                        AI协作中
                    </span>
                    <span className="wk-ai-collab-text">{foldPreview.participants.join(' × ')} · {foldPreview.count}条</span>
                </span>
            )
        }
        const lastMessage = new MessageWrap(conversationWrap.lastMessage)
        if (lastMessage.isDeleted) {
            return ""
        }
        if (lastMessage.revoke) {
            return RevokeCell.tip(lastMessage)
        }
        if(lastMessage.flame) {
            return FlameMessageCell.tip(lastMessage)
        }
        if (lastMessage.channel.channelType === ChannelTypePerson) {
            return lastMessage.content?.conversationDigest
        } else {
            // 群组和子区频道都显示发送者名称
            let from = ""
            if (lastMessage.fromUID && lastMessage.fromUID !== "") {
                const fromChannel = new Channel(lastMessage.fromUID, ChannelTypePerson)
                const fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(fromChannel)
                if (fromChannelInfo) {
                    from = `${fromChannelInfo.title}: `
                } else {
                    WKSDK.shared().channelManager.fetchChannelInfo(fromChannel)
                }
            }

            return `${from}${lastMessage.content?.conversationDigest || ""}`
        }
    }

    getOnlineTip(channelInfo: ChannelInfo) {
        if (channelInfo.online) {
            return undefined
        }
        const nowTime = new Date().getTime() / 1000
        const btwTime = nowTime - channelInfo.lastOffline
        if (btwTime < 60) {
            return "刚刚"
        }
        return `${(btwTime / 60).toFixed(0)}分钟`
    }

    // 是否需要显示在线状态
    needShowOnlineStatus(channelInfo?: ChannelInfo) {
        if (!channelInfo) {
            return false
        }
        if (channelInfo.online) {
            return true
        }
        const nowTime = new Date().getTime() / 1000
        const btwTime = nowTime - channelInfo.lastOffline
        if (btwTime > 0 && btwTime < 60 * 60) { // 小于1小时才显示
            return true
        }
        return false
    }

    conversationItem(conversationWrap: ConversationWrap, hasThreads = false) {
        let channelInfo = conversationWrap.channelInfo
        if (!channelInfo) {
            WKSDK.shared().channelManager.fetchChannelInfo(conversationWrap.channel)
        }

        const { compact } = this.props

        // ── Compact 模式（群聊 Tab）：用 CompactGroupItem 函数组件（支持拖拽） ──
        if (compact) {
            const selected = !!(this.props.select && this.props.select.isEqual(conversationWrap.channel))
            return (
                <CompactGroupItem
                    key={conversationWrap.channel.getChannelKey()}
                    conversationWrap={conversationWrap}
                    selected={selected}
                    hasThreads={hasThreads}
                    onClick={() => { if (this.props.onClick) this.props.onClick(conversationWrap) }}
                    onContextMenu={(e) => { this._handleContextMenu(conversationWrap, e) }}
                />
            )
        }

        const avatarKey = WKApp.shared.getChannelAvatarTag(conversationWrap.channel);

        const { select, onClick } = this.props
        const typing = TypingManager.shared.getTyping(conversationWrap.channel)
        const selected = select && select.isEqual(conversationWrap.channel)
        const isThread = conversationWrap.channel.channelType === ChannelTypeCommunityTopic
        return <div key={conversationWrap.channel.getChannelKey()} onClick={() => {
            if (onClick) {
                onClick(conversationWrap)
            }
        }} className={classNames("wk-conversationlist-item", selected ? "wk-conversationlist-item-selected" : undefined, channelInfo?.top ? "wk-conversationlist-item-top" : undefined, conversationWrap.unread > 0 ? "wk-conversationlist-item-unread" : undefined, isThread ? "wk-conversationlist-item-thread" : undefined)} onContextMenu={(e) => {
            this._handleContextMenu(conversationWrap, e)
        }}>
            <div className="wk-conversationlist-item-content">
                {/* 子区不显示左侧图标区域 */}
                {!isThread && (
                    <div className="wk-conversationlist-item-left">
                        <div className="wk-conversationlist-item-avatar-box">
                            <WKAvatar channel={conversationWrap.channel} key={avatarKey}></WKAvatar>
                            {hasThreads && (
                              <div className="wk-conv-group-hash-badge">
                                <Hash size={10} strokeWidth={2.5} />
                              </div>
                            )}
                            {channelInfo && this.needShowOnlineStatus(channelInfo) ? <OnlineStatusBadge tip={this.getOnlineTip(channelInfo)}></OnlineStatusBadge> : undefined}
                        </div>
                    </div>
                )}
                <div className="wk-conversationlist-item-right">
                    <div className="wk-conversationlist-item-right-first-line">
                        <div className="wk-conversationlist-item-name">
                            <h3>
                                {conversationWrap.channel.channelType === ChannelTypeCommunityTopic && (
                                  <ThreadIcon size={13} className="wk-conv-channel-icon wk-conv-thread-icon" />
                                )}
                                {channelInfo?.orgData.displayName}
                            </h3>
                            {channelInfo?.orgData?.robot === 1 && <AiBadge />}
                            {
                                channelInfo?.orgData.identityIcon ? <img style={{ "width": channelInfo?.orgData?.identitySize.width, "height": channelInfo?.orgData?.identitySize.height }} src={channelInfo?.orgData.identityIcon}></img> : undefined
                            }
                            <div style={{ "width": "14px", height: "14px", "display": "flex", "alignItems": "center" }}>
                                {
                                    channelInfo?.mute && <svg className="icon" viewBox="0 0 1131 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2755" width="14" height="14"><path d="M914.688 892.736L64 236.224l38.784-50.88L271.36 315.648a300.288 300.288 0 0 1 246.976-157.952v-33.28c0-16.64 13.504-30.08 30.08-30.08h2.304c16.576 0 30.08 13.44 30.08 30.08v32.96a299.776 299.776 0 0 1 284.928 299.136v294.272l45.504 58.624 48.768 37.696-45.312 45.632zM234.624 480.384l506.88 391.232H140.416l94.272-121.536-0.064-269.696z" fill="#bfbfbf" p-id="2756"></path></svg>
                                }

                            </div>
                            <div className="wk-conversationlist-item-time">
                                <span>{getTimeStringAutoShort2(conversationWrap.timestamp * 1000, true)}</span>
                            </div>
                        </div>

                    </div>
                    <div className="wk-conversationlist-item-right-second-line">
                        <div className="wk-conversationlist-item-lastmsg">
                            {
                                !typing?<label className="wk-reminder" style={{ display: conversationWrap.remoteExtra.draft  ? undefined : 'none' }}>[草稿]</label>:undefined
                            }
                            {
                                conversationWrap.simpleReminders && !typing &&  conversationWrap.simpleReminders.length>0 ?(
                                    conversationWrap.simpleReminders.filter((r)=>r.done === false).map((r)=>{
                                        return   <label key={r.reminderID} className="wk-reminder">{r.text}</label>
                                    })
                                ):undefined
                            }
                            {
                                typing ? this._getTypingUI(conversationWrap) : this.lastContent(conversationWrap)
                            }

                        </div>
                        <div className="wk-conversationlist-item-reddot">
                            {
                                conversationWrap.unread > 0 ? <Badge style={channelInfo?.mute ? { "border": "none", "backgroundColor": "var(--semi-color-text-2)" } : { "border": "none", "backgroundColor": "var(--wk-brand-primary)" }} count={conversationWrap.unread} type='danger'></Badge> : undefined
                            }
                        </div>
                    </div>
                </div>
            </div>
        </div>
    }

    onTop(channelInfo: ChannelInfo) {
        ChannelSettingManager.shared.top(!channelInfo.top, channelInfo.channel)
    }

    onMute(channelInfo: ChannelInfo) {
        ChannelSettingManager.shared.mute(!channelInfo.mute, channelInfo.channel)
    }

    onCloseChat(channel: Channel) { // 关闭聊天
        WKApp.conversationProvider.deleteConversation(channel)
    }

    async onClearMessages(channel: Channel) {
        if(this.props.onClearMessages) {
            this.props.onClearMessages(channel)
        }
    }

    filterConversation(conv: ConversationWrap): boolean {
        const filter = this.props.filter ?? 'all'
        if (filter === 'all') return true
        const channelInfo = conv.channelInfo
        // 群组和子区频道都归类到 group 过滤器
        if (filter === 'group') return conv.channel.channelType === ChannelTypeGroup || conv.channel.channelType === ChannelTypeCommunityTopic
        // dm = human + ai（私聊 Tab 包含所有私聊会话）
        if (filter === 'dm') return conv.channel.channelType === ChannelTypePerson
        if (filter === 'ai') {
            if (conv.channel.channelType !== ChannelTypePerson) return false
            // channelInfo 未加载时隐藏，等 channelInfoListener 触发重渲后再显示
            if (!channelInfo) return false
            return channelInfo.orgData?.robot === 1
        }
        if (filter === 'human') {
            if (conv.channel.channelType !== ChannelTypePerson) return false
            // channelInfo 未加载时暂时归入 human，channelInfoListener 更新后自动修正
            if (!channelInfo) return true
            return channelInfo.orgData?.robot !== 1
        }
        return true
    }

    // 将子区放在父群组后面，最多显示2个，超出部分用计数表示
    private groupThreadsWithParent(convs: ConversationWrap[]): { items: Array<ConversationWrap | { type: 'thread-overflow'; parentGroupId: string; count: number }>, threadsByParent: Map<string, ConversationWrap[]> } {
        const MAX_VISIBLE_THREADS = 2

        // 分离群组和子区
        const threads: ConversationWrap[] = []

        for (const conv of convs) {
            if (conv.channel.channelType === ChannelTypeCommunityTopic) {
                threads.push(conv)
            }
        }

        // 按父群组分组子区
        const threadsByParent = new Map<string, ConversationWrap[]>()
        for (const thread of threads) {
            const parentGroupNo = thread.channelInfo?.orgData?.parentGroupNo
                || parseThreadChannelId(thread.channel.channelID)?.groupNo
            if (parentGroupNo) {
                const list = threadsByParent.get(parentGroupNo) || []
                list.push(thread)
                threadsByParent.set(parentGroupNo, list)
            }
        }

        // 重新组织：群组后面跟着其子区（最多2个）
        const result: Array<ConversationWrap | { type: 'thread-overflow'; parentGroupId: string; count: number }> = []
        const usedThreads = new Set<string>()

        for (const conv of convs) {
            if (conv.channel.channelType === ChannelTypeCommunityTopic) {
                // 子区会在父群组后面添加，这里跳过
                continue
            }
            result.push(conv)
            // 如果是群组，添加其子区（最多2个）
            if (conv.channel.channelType === ChannelTypeGroup) {
                const groupThreads = threadsByParent.get(conv.channel.channelID) || []
                const visibleThreads = groupThreads.slice(0, MAX_VISIBLE_THREADS)
                const overflowCount = groupThreads.length - MAX_VISIBLE_THREADS

                // 标记所有已分组的子区（包括溢出的）为已使用
                for (const thread of groupThreads) {
                    usedThreads.add(thread.channel.channelID)
                }

                for (const thread of visibleThreads) {
                    result.push(thread)
                }

                // 如果有超出的子区，添加溢出提示
                if (overflowCount > 0) {
                    result.push({
                        type: 'thread-overflow',
                        parentGroupId: conv.channel.channelID,
                        count: overflowCount
                    })
                }
            }
        }

        // 收集列表中存在的群组 ID
        const groupIdsInList = new Set(
            convs.filter(c => c.channel.channelType === ChannelTypeGroup).map(c => c.channel.channelID)
        )

        // 孤儿子区：父群组在列表中但未被分组的先显示，父群组不在列表中的隐藏
        for (const thread of threads) {
            if (!usedThreads.has(thread.channel.channelID)) {
                const parentGroupNo = thread.channelInfo?.orgData?.parentGroupNo
                    || parseThreadChannelId(thread.channel.channelID)?.groupNo
                if (parentGroupNo && groupIdsInList.has(parentGroupNo)) {
                    // 父群组在列表中但子区未被分组（理论上不应该出现）
                    result.push(thread)
                }
                // 父群组不在列表中（已退出等）：隐藏
            }
        }

        return { items: result, threadsByParent }
    }

    render() {
        const { conversations, select } = this.props
        const { selectConversationWrap } = this.state

        const filtered = conversations?.filter(c => this.filterConversation(c)) ?? []

        // 先对整个列表分组子区，再分离置顶/最近（避免置顶群组和子区断开）
        const { items: grouped, threadsByParent } = this.groupThreadsWithParent(filtered)
        const groupedPinned = grouped.filter(item => {
            if ('type' in item) return false
            return (item as ConversationWrap).channelInfo?.top
        })

        // 子区和溢出提示跟随父群组：如果父群组被置顶，把它的子区也移到置顶区
        const pinnedGroupIds = new Set(
            groupedPinned
                .filter(item => !('type' in item) && (item as ConversationWrap).channel.channelType === ChannelTypeGroup)
                .map(item => (item as ConversationWrap).channel.channelID)
        )
        const finalPinned: typeof grouped = []
        const finalRecent: typeof grouped = []
        for (const item of grouped) {
            if ('type' in item) {
                // thread-overflow 跟随父群组
                if (pinnedGroupIds.has(item.parentGroupId)) {
                    finalPinned.push(item)
                } else {
                    finalRecent.push(item)
                }
            } else {
                const conv = item as ConversationWrap
                if (conv.channelInfo?.top) {
                    finalPinned.push(item)
                } else if (conv.channel.channelType === ChannelTypeCommunityTopic) {
                    // 子区跟随父群组
                    const parentGroupNo = conv.channelInfo?.orgData?.parentGroupNo
                        || parseThreadChannelId(conv.channel.channelID)?.groupNo
                    if (parentGroupNo && pinnedGroupIds.has(parentGroupNo)) {
                        finalPinned.push(item)
                    } else {
                        finalRecent.push(item)
                    }
                } else {
                    finalRecent.push(item)
                }
            }
        }

        const { onThreadOverflowClick, compact } = this.props
        const { expandedGroupIds } = this.state

        const renderItem = (item: ConversationWrap | { type: 'thread-overflow'; parentGroupId: string; count: number }) => {
            if ('type' in item && item.type === 'thread-overflow') {
                if (compact) {
                    // compact 模式：overflow indicator 改为「+N 个子区」/ 「收起」可切换
                    const isExpanded = expandedGroupIds.has(item.parentGroupId)
                    const toggleExpand = () => {
                        this.setState(s => {
                            const next = new Set(s.expandedGroupIds)
                            if (next.has(item.parentGroupId)) next.delete(item.parentGroupId)
                            else next.add(item.parentGroupId)
                            return { expandedGroupIds: next }
                        })
                    }
                    // 控件位置固定在前2个子区下方，展开的额外子区在控件下面
                    const extraThreads = (threadsByParent.get(item.parentGroupId) ?? []).slice(2)
                    return (
                        <React.Fragment key={`overflow-${item.parentGroupId}`}>
                            {/* 展开时：先渲染剩余子区，控件始终置底 */}
                            {isExpanded && extraThreads.map(conv => {
                                const selected = !!(this.props.select && this.props.select.isEqual(conv.channel))
                                return (
                                    <CompactGroupItem
                                        key={conv.channel.getChannelKey()}
                                        conversationWrap={conv}
                                        selected={selected}
                                        onClick={() => { if (this.props.onClick) this.props.onClick(conv) }}
                                        onContextMenu={(e) => { this._handleContextMenu(conv, e) }}
                                    />
                                )
                            })}
                            {/* 展开/收起控件始终置底 */}
                            <div
                                className={`wk-conv-compact-thread-overflow${isExpanded ? ' wk-conv-compact-thread-overflow--expanded' : ''}`}
                                onClick={toggleExpand}
                            >
                                {isExpanded ? '收起' : `+ ${item.count} 个子区`}
                            </div>
                        </React.Fragment>
                    )
                }
                return (
                    <div
                        key={`overflow-${item.parentGroupId}`}
                        className="wk-conversationlist-thread-overflow"
                        onClick={() => onThreadOverflowClick?.(item.parentGroupId)}
                    >
                        <span>+{item.count} 个子区</span>
                    </div>
                )
            }
            const conv = item as ConversationWrap

            // compact 模式展开：已展开分组的子区（overflow 之后的部分）是否显示
            // 注意：groupThreadsWithParent 只给前 2 个，overflow 的在 threadsByParent 里
            // 这里 item 已经是 groupThreadsWithParent 处理后的，超出的不在 items 里
            // 所以只需要在 overflow click 后渲染额外的子区
            // → 用 expandedGroupIds 控制是否渲染 threadsByParent 里超出 MAX 的部分（见下方额外渲染）

            const hasThreads = conv.channel.channelType === ChannelTypeGroup
                && threadsByParent.has(conv.channel.channelID)
            return this.conversationItem(conv, hasThreads)
        }

        return <div id="wk-conversationlist" className="wk-conversationlist" onScroll={this._handleScroll}>
            {finalPinned.map(renderItem)}
            {finalRecent.map(renderItem)}
        

            <ContextMenus onContext={(ctx) => {
                this.contextMenusContext = ctx
            }} menus={(() => {
                const conv = selectConversationWrap
                const channelInfo = conv?.channelInfo
                const channel = conv?.channel
                const extraMenus = this.props.extraContextMenus ? this.props.extraContextMenus(conv) : []

                const menus: any[] = []

                // 1. 标为已读（有未读时显示）
                if (conv && conv.unread > 0) {
                    menus.push({
                        title: "标为已读",
                        icon: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
                        onClick: () => {
                            if (!channel) return
                            WKApp.apiClient.put("conversation/clearUnread", {
                                channel_id: channel.channelID,
                                channel_type: channel.channelType,
                                unread: 0,
                            })
                        }
                    })
                }

                // 2. 关闭聊天窗口
                menus.push({
                    title: "关闭聊天窗口",
                    icon: "M18 6 6 18 M6 6l12 12",
                    onClick: () => {
                        if (!channel) return
                        Modal.confirm({
                            title: '确认关闭',
                            content: '确定要关闭此聊天窗口吗？',
                            okText: '确定',
                            cancelText: '取消',
                            onOk: () => { this.onCloseChat(channel) },
                        })
                    }
                })

                // 3. 额外菜单项（移出分组 / 移到分组等，由上层通过 extraContextMenus 传入）
                if (extraMenus.length > 0) {
                    menus.push(...extraMenus)
                }

                // 4. 置顶 / 取消置顶
                menus.push({
                    title: channelInfo?.top ? "取消置顶" : "置顶",
                    icon: "M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5",
                    onClick: () => { if (channelInfo) this.onTop(channelInfo) }
                })

                // 5. 免打扰 / 关闭免打扰
                menus.push({
                    title: channelInfo?.mute ? "关闭免打扰" : "开启免打扰",
                    icon: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
                    onClick: () => { if (channelInfo) this.onMute(channelInfo) }
                })

                // 6. 分隔线
                menus.push({ separator: true } as ContextMenusData)

                // 7. 更多（子菜单：清空聊天记录 / 关闭并清空）
                menus.push({
                    title: "更多",
                    icon: "M12 12m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0 M12 5m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0 M12 19m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0",
                    children: [
                        {
                            title: "清空聊天记录",
                            danger: true,
                            onClick: () => {
                                if (!channel) return
                                Modal.confirm({
                                    title: '确认清空',
                                    content: '确定要清空所有聊天记录吗？此操作不可撤销。',
                                    okText: '确定',
                                    cancelText: '取消',
                                    onOk: () => { this.onClearMessages(channel) },
                                })
                            }
                        },
                        {
                            title: "关闭窗口并清空记录",
                            danger: true,
                            onClick: () => {
                                if (!channel) return
                                Modal.confirm({
                                    title: '确认关闭并清空',
                                    content: '确定要关闭窗口并清空所有聊天记录吗？此操作不可撤销。',
                                    okText: '确定',
                                    cancelText: '取消',
                                    onOk: () => {
                                        this.onCloseChat(channel)
                                        this.onClearMessages(channel)
                                    },
                                })
                            }
                        },
                    ]
                })

                return menus
            })()} />
        </div>
    }
}


interface OnlineStatusBadgeProps {
    tip?: string
}
export class OnlineStatusBadge extends Component<OnlineStatusBadgeProps> {

    render(): React.ReactNode {
        const { tip } = this.props
        return <div className={classNames("wk-onlinestatusbadge", !tip ? "wk-onlinestatusbadge-empty" : undefined)}>
            <div className="wk-onlinestatusbadge-content">
                <div className="wk-onlinestatusbadge-content-tip">{tip}</div>
            </div>
        </div>
    }
}