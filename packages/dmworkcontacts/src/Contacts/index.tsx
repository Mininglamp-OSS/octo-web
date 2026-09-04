import React, { useEffect, useRef, useState, useCallback } from "react";
import { Component } from "react";
import { Contacts, WKApp, WKBase, ErrorBoundary, WKModal, I18nContext, t, addCurrentImChannelInfoListener, fetchCurrentImChannelInfo, getCurrentImChannelInfo, Dap } from "@octo/base"
import "./index.css"
import { toSimplized } from "@octo/base";
import { getPinyin } from "@octo/base";
import classnames from "classnames";
import { Empty, Tooltip } from "@octo/ui";
import { Toast } from "@douyinfe/semi-ui";
import { ChevronRight, Users, Bot, UsersRound } from "lucide-react";

import { Channel, ChannelTypePerson, ChannelTypeGroup, ChannelInfoListener, ChannelInfo } from "wukongimjssdk";
import { ContactsListManager } from "../Service/ContactsListManager";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import AiBadge from "@octo/base/src/Components/AiBadge";
import BotDetailModal from "@octo/base/src/Components/BotDetailModal";
import UserInfo from "@octo/base/src/Components/UserInfo";
import GroupCard from "@octo/base/src/Components/GroupCard";
import { Space, SpaceMember, SpaceService, hasSpacePrefix } from "@octo/base/src/Service/SpaceService";
import { channelOpenedTrackPayload } from "@octo/base/src/Service/channelOpenedTracking";
import { debounce } from "@octo/base/src/Utils/rateLimit";
import { OnlineStatusBadge, needShowOnlineStatus, getOnlineTip } from "@octo/base/src/Components/ConversationList";
import { useVirtualizer } from "@tanstack/react-virtual";
import { shouldShowOnlineStatus, selectOnlineStatusUids } from "./onlineStatusGate";
import ContactsSearch from "../ui/ContactsSearch";
import { ContactsDirectory, ContactsDirectorySection } from "../ui/ContactsDirectory";
import type { ContactsDirectorySectionKey } from "../ui/ContactsDirectory/types";
import {
    buildContactsSearchIndex,
    createEmptyContactsSearchIndex,
    searchContacts,
} from "../bridge/contactsSearch/searchContacts";
import type { ContactsSearchIndex } from "../bridge/contactsSearch/types";

function OverflowTooltip({ text, children }: { text: string; children: React.ReactNode }) {
    const [isTruncated, setIsTruncated] = useState(false)
    const textRef = useRef<HTMLSpanElement>(null)
    const resizeObserverRef = useRef<ResizeObserver | null>(null)

    const checkTruncation = useCallback(() => {
        if (textRef.current) {
            setIsTruncated(textRef.current.scrollWidth > textRef.current.clientWidth)
        }
    }, [])

    const setTextRef = useCallback((node: HTMLSpanElement | null) => {
        resizeObserverRef.current?.disconnect()
        resizeObserverRef.current = null
        textRef.current = node
        if (!node) return

        if (typeof ResizeObserver !== "undefined") {
            resizeObserverRef.current = new ResizeObserver(checkTruncation)
            resizeObserverRef.current.observe(node)
        }
    }, [checkTruncation])

    useEffect(() => {
        checkTruncation()
    }, [text, checkTruncation])

    useEffect(() => {
        window.addEventListener("resize", checkTruncation)
        return () => {
            resizeObserverRef.current?.disconnect()
            window.removeEventListener("resize", checkTruncation)
        }
    }, [checkTruncation])
    const content = (
        <div className="wk-contacts-section-item-name">
            <span ref={setTextRef} className="wk-contacts-section-item-text">{text}</span>
            {children}
        </div>
    )

    return isTruncated ? <Tooltip content={text} placement="right">{content}</Tooltip> : content
}

const ITEM_HEIGHT = 44
const LETTER_HEADER_HEIGHT = 28

// 在线态 uid 归一化：Space 场景下列表持有的是带前缀 uid（s<spaceId>_<uid>），而
// channelInfo 回包、onlineStatus WS 推送、channelInfoListener 回调用的都是去前缀 uid
// （见 dmworkdatasource extractUID 与 dmworkbase 的 onlineStatus handler）。统一把在线态的
// 预取、缓存读取、listener 命中都收口到「去前缀 uid」这唯一 key，使初次 prefetch、实时 WS
// 推送、visibilitychange 三条路径命中同一缓存并触发重渲。与既有 hasSpacePrefix 约定一致。
function normalizeOnlineUid(uid: string): string {
    return hasSpacePrefix(uid) ? uid.substring(uid.indexOf('_') + 1) : uid
}

type ContactFilterMode = 'all' | 'bots' | 'humans'

interface ContactListRow {
    item: Contacts
    letter: string
    showLetter: boolean
}

interface ContactIndexData {
    items: Contacts[]
    indexList: string[]
    indexItemMap: Map<string, Contacts[]>
    listRows: ContactListRow[]
}

function getLetterFromPinyin(py: string): string {
    let letter = (py && py[0]) || '#'
    if (!/[A-Z]/.test(letter)) letter = '#'
    return letter
}

interface VirtualContactListProps {
    rows: ContactListRow[]
    renderItem: (item: Contacts) => React.ReactNode
    initialScrollTop: number
    onScrollTopChange: (scrollTop: number) => void
    // 仅上报当前可见项 uid，用于按需预取在线状态（避免对上万 uid 一次性发请求）
    onVisibleUids?: (uids: string[]) => void
}

function VirtualContactList({ rows, renderItem, initialScrollTop, onScrollTopChange, onVisibleUids }: VirtualContactListProps) {
    const parentRef = useRef<HTMLDivElement>(null)

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (index: number) => {
            return rows[index]?.showLetter ? ITEM_HEIGHT + LETTER_HEADER_HEIGHT : ITEM_HEIGHT
        },
        overscan: 15,
    })

    useEffect(() => {
        const scrollElement = parentRef.current
        if (!scrollElement) return

        const maxScrollTop = Math.max(0, virtualizer.getTotalSize() - scrollElement.clientHeight)
        virtualizer.scrollToOffset(Math.min(initialScrollTop, maxScrollTop))
    }, [initialScrollTop, virtualizer])

    const virtualItems = virtualizer.getVirtualItems()
    const visibleStart = virtualItems.length ? virtualItems[0].index : 0
    const visibleEnd = virtualItems.length ? virtualItems[virtualItems.length - 1].index : 0

    // 滚动到哪，就为当前可见区间的项按需预取在线状态。父级用 Set 去重，
    // 保证每个 uid 至多请求一次，绝不对整份上万条列表一次性发请求。
    useEffect(() => {
        if (!onVisibleUids) return
        const uids: string[] = []
        for (let i = visibleStart; i <= visibleEnd; i++) {
            // 只对 AI 条目预取在线态，真人 uid 不请求（在线态仅面向 AI）
            const item = rows[i]?.item
            if (item && shouldShowOnlineStatus(item) && item.uid) uids.push(item.uid)
        }
        if (uids.length) onVisibleUids(uids)
    }, [visibleStart, visibleEnd, rows, onVisibleUids])

    return (
        <div
            ref={parentRef}
            className="wk-contacts-all-list"
            onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
        >
            <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                {virtualItems.map(virtualItem => {
                    const row = rows[virtualItem.index]
                    if (!row) return null

                    return (
                        <div
                            key={row.item.uid}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualItem.start}px)`,
                            }}
                        >
                            {row.showLetter && <div className="wk-contacts-letter-header">{row.letter}</div>}
                            {renderItem(row.item)}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export class ContactsState {
    keyword?: string
    currentSpace?: Space
    spaceMembers: SpaceMember[] = []

    // 手风琴展开状态
    expandedSection: 'groups' | 'myBots' | 'allContacts' | null = 'allContacts'

    // 数据源
    myBots: any[] = []
    spaceBots: any[] = []
    myGroups: any[] = []

    // 筛选
    filterMode: ContactFilterMode = 'all'

    // 搜索
    isSearching: boolean = false
    searchContacts: any[] = []
    searchGroups: any[] = []

    // 人的名片弹窗
    userInfoUid?: string
    userInfoVisible: boolean = false

    // Bot 详情弹窗
    botDetailUid?: string
    botDetailVisible: boolean = false

    // 群聊名片弹窗
    groupCardVisible: boolean = false
    groupCardGroupNo?: string
    groupCardName?: string
    groupCardMemberCount?: number

    // 字母索引
    indexList: string[] = []
    indexItemMap: Map<string, Contacts[]> = new Map()
    listRows: ContactListRow[] = []

    // 加载
    loading: boolean = true
}

export default class ContactsList extends Component<any, ContactsState> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    channelInfoListener!: ChannelInfoListener
    private spaceChangedHandler!: (space: any) => void
    private flatItems: Contacts[] = []
    private indexCache = new Map<ContactFilterMode, ContactIndexData>()
    private contactsSearchIndex: ContactsSearchIndex = createEmptyContactsSearchIndex()
    private filterScrollTops: Record<ContactFilterMode, number> = { all: 0, bots: 0, humans: 0 }
    // 已预取过 channelInfo（含在线态）的 uid 集合，跨 filter/滚动去重，避免重复请求
    private prefetchedUids = new Set<string>()
    private unsubscribeChannelInfoListener?: () => void
    private visibilityHandler!: () => void
    // 组件是否仍挂载：refreshTrackedOnlineStatus 是异步的，回包后 setState 前需确认未卸载
    private mounted = false

    constructor(props: any) {
        super(props)
        this.state = new ContactsState()
    }

    componentDidMount() {
        this.mounted = true
        this.channelInfoListener = (channelInfo: ChannelInfo) => {
            if (channelInfo.channel.channelType !== ChannelTypePerson) return
            const uid = channelInfo.channel.channelID
            const idx = this.state.spaceMembers.findIndex(
                (m) => m.uid === uid
            )
            if (idx !== -1) {
                const members = [...this.state.spaceMembers]
                const nameChanged = members[idx].name !== channelInfo.title
                members[idx] = { ...members[idx], name: channelInfo.title }
                this.setState({ spaceMembers: members }, () => {
                    if (nameChanged) {
                        this.rebuildContactsSearchIndex()
                        this.clearIndexCache()
                        this.rebuildIndex()
                    }
                })
                return
            }
            // WS 推送在线态变更：命中已预取的列表内 uid（如未在 spaceMembers 里的
            // 已添加 AI / 企业 AI）时做一次轻量重渲，实时刷新在线绿点。listener 回调的
            // uid 已是去前缀形式，归一化后与 prefetchedUids（同为去前缀）一致命中。
            if (this.prefetchedUids.has(normalizeOnlineUid(uid))) {
                this.setState({})
            }
        }

        this.spaceChangedHandler = (space: any) => {
            const sp = space as Space | undefined
            this.clearIndexCache()
            this.contactsSearchIndex = createEmptyContactsSearchIndex()
            this.resetFilterScrollTops()
            this.prefetchedUids.clear()
            if (sp) {
                this.debouncedSearch.cancel()
                this.setState({ currentSpace: sp, myGroups: [], myBots: [], spaceBots: [], keyword: '', isSearching: false, searchContacts: [], searchGroups: [], filterMode: 'all', loading: true }, () => {
                    this.loadAllData(sp.space_id)
                })
            } else {
                this.debouncedSearch.cancel()
                this.setState({ currentSpace: undefined, spaceMembers: [], myBots: [], spaceBots: [], myGroups: [], keyword: '', isSearching: false, searchContacts: [], searchGroups: [], filterMode: 'all' })
            }
        }
        WKApp.mittBus.on('space-changed', this.spaceChangedHandler)
        this.unsubscribeChannelInfoListener = addCurrentImChannelInfoListener(this.channelInfoListener)

        // 页面重新可见时对已追踪的 AI 在线态做一次自愈重拉：正常情况下在线态靠
        // WKSDK 的 onlineStatus WS 回调实时重渲，但推送若因断连/节流被延迟或丢失，
        // 用户切回本页时不必整页刷新，也能补回最新在线绿点。
        this.visibilityHandler = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                this.refreshTrackedOnlineStatus()
            }
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.visibilityHandler)
        }

        ContactsListManager.shared.setRefreshList = () => {
            this.setState({})
        }

        // 首次加载
        const spaceId = WKApp.shared.currentSpaceId
        if (spaceId) {
            SpaceService.shared.getMySpaces().then((spaces) => {
                const sp = spaces.find((s) => s.space_id === spaceId)
                if (sp) {
                    this.setState({ currentSpace: sp }, () => {
                        this.loadAllData(sp.space_id)
                    })
                }
            }).catch(() => { this.setState({ loading: false }) })
        } else {
            this.setState({ loading: false })
        }
    }

    componentWillUnmount() {
        this.mounted = false
        ContactsListManager.shared.setRefreshList = undefined
        this.unsubscribeChannelInfoListener?.()
        this.unsubscribeChannelInfoListener = undefined
        WKApp.mittBus.off('space-changed', this.spaceChangedHandler)
        if (typeof document !== 'undefined' && this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler)
        }
        this.debouncedSearch.cancel()
        this.prefetchedUids.clear()
    }

    // 对当前已追踪（已预取过在线态、即可能展示绿点）的 AI uid 重新拉取 channelInfo。
    // prefetchedUids 已归一化为去前缀 uid，重拉、缓存写回、listener 命中与渲染读取都用同一 key，
    // 三条路径（初次 prefetch / 实时 WS 推送 / visibilitychange）因此一致。这里等所有重拉落库后
    // 再统一强制 setState 一次：即便推送因断连/节流被延迟或丢失，切回本页也能补回最新在线绿点，
    // 无需整页刷新（force re-render 亦作为 listener 未触发时的兜底）。
    private refreshTrackedOnlineStatus = async () => {
        const uids = Array.from(this.prefetchedUids).filter(Boolean)
        if (uids.length === 0) return
        await Promise.all(
            uids.map((uid) =>
                fetchCurrentImChannelInfo(new Channel(uid, ChannelTypePerson))
                    .catch(() => undefined)
            )
        )
        if (this.mounted) {
            this.setState({})
        }
    }

    // 翻页拉取空间全部成员。宿主 getMembers 单次 limit 上限 10000，超大空间若只请求一页会把
    // 第 10000 名之后的成员静默丢弃（与文档成员选择器同源的问题）。这里 10000/页循环到取尽为止；
    // MAX_PAGES 兜底防异常空间无限循环（20×10000=20 万，远超任何真实空间）。同一 getMembers
    // 接口、page/limit 传参不变，不碰后端、不影响移动端。
    private async fetchAllSpaceMembers(spaceId: string): Promise<any[]> {
        const PAGE_SIZE = 10000
        const MAX_PAGES = 20
        const all: any[] = []
        for (let page = 1; page <= MAX_PAGES; page++) {
            const batch = await SpaceService.shared.getMembers(spaceId, page, PAGE_SIZE)
            if (!batch || batch.length === 0) break
            all.push(...batch)
            if (batch.length < PAGE_SIZE) break // 最后一页
        }
        return all
    }

    private async loadAllData(spaceId: string) {
        try {
            const [members, myBots, spaceBots, myGroups] = await Promise.all([
                this.fetchAllSpaceMembers(spaceId),
                WKApp.apiClient.get("/robot/my_bots", { param: { space_id: spaceId } }).catch(() => []),
                WKApp.apiClient.get("/robot/space_bots", { param: { space_id: spaceId } }).catch(() => []),
                WKApp.apiClient.get(`/group/my?space_id=${spaceId}`).catch(() => []),
            ])
            this.setState({
                spaceMembers: members || [],
                myBots: myBots || [],
                spaceBots: spaceBots || [],
                myGroups: myGroups || [],
                loading: false,
            }, () => {
                this.rebuildContactsSearchIndex()
                this.clearIndexCache()
                this.rebuildIndex()
                // 「已添加AI」列表数量有界，数据就绪时整批预取一次在线态。
                this.prefetchOnlineStatus((myBots || []).map((b: any) => b.uid))
            })
        } catch {
            this.setState({ loading: false })
        }
    }

    private clearIndexCache() {
        this.indexCache.clear()
    }

    private rebuildContactsSearchIndex() {
        this.contactsSearchIndex = buildContactsSearchIndex({
            spaceMembers: this.state.spaceMembers,
            spaceBots: this.state.spaceBots,
            myGroups: this.state.myGroups,
            currentUid: WKApp.loginInfo.uid || "",
        })
    }

    private resetFilterScrollTops() {
        this.filterScrollTops = { all: 0, bots: 0, humans: 0 }
    }

    // 按需预取一批 person uid 的 channelInfo（含在线态），用 Set 去重。
    // 仅在成员/机器人已缓存时跳过网络请求；已请求过的 uid 不再重复请求。
    private prefetchOnlineStatus = (uids: string[]) => {
        for (const rawUid of uids) {
            if (!rawUid) continue
            // 归一化到去前缀 uid，使预取缓存 key 与 WS 推送 / listener / 渲染读取一致
            const uid = normalizeOnlineUid(rawUid)
            if (this.prefetchedUids.has(uid)) continue
            this.prefetchedUids.add(uid)
            const ch = new Channel(uid, ChannelTypePerson)
            if (!getCurrentImChannelInfo(ch)) {
                void fetchCurrentImChannelInfo(ch)
            }
        }
    }

    // 「全部联系人」>100 条走虚拟列表，仅对可见项预取（见 VirtualContactList.onVisibleUids）；
    // <=100 条为普通渲染、数量有界，可在数据就绪时整批预取一次。仅预取 AI 条目，真人不请求。
    private maybePrefetchSmallList() {
        if (this.flatItems.length > 0 && this.flatItems.length <= 100) {
            this.prefetchOnlineStatus(selectOnlineStatusUids(this.flatItems))
        }
    }

    // 复用会话列表/群成员列表同一份在线态判定与文案，渲染在线绿点。
    private renderOnlineBadge(uid: string): React.ReactNode {
        const channelInfo = getCurrentImChannelInfo(new Channel(normalizeOnlineUid(uid), ChannelTypePerson))
        if (!needShowOnlineStatus(channelInfo)) return null
        return <OnlineStatusBadge tip={getOnlineTip(channelInfo!)} />
    }

    private handleListScroll = (scrollTop: number) => {
        this.filterScrollTops[this.state.filterMode] = scrollTop
    }

    private restoreListScroll = (element: HTMLDivElement | null) => {
        if (!element) return
        element.scrollTop = this.filterScrollTops[this.state.filterMode] || 0
    }

    private getIndex(filterMode: ContactFilterMode) {
        const cached = this.indexCache.get(filterMode)
        if (cached) return cached

        const indexData = this.buildIndex(filterMode)
        this.indexCache.set(filterMode, indexData)
        return indexData
    }

    private buildIndex(filterMode: ContactFilterMode): ContactIndexData {
        const { spaceMembers, spaceBots } = this.state
        const myUID = WKApp.loginInfo.uid || ""

        let items: Contacts[]

        if (filterMode === 'bots') {
            // "只看 AI"：使用 space_bots 展示企业内所有 AI
            const allBots = spaceBots || []
            // 用 spaceMembers 中已有的 bot uid 集合判断是否已是成员
            const memberUids = new Set(spaceMembers.filter(m => m.robot === 1).map(m => m.uid))
            items = allBots
                .filter((b: any) => b.uid !== myUID)
                .map((b: any) => {
                    const c = new Contacts()
                    c.uid = b.uid
                    c.name = b.name || b.uid
                    c.avatar = b.avatar || ""
                    c.robot = true
                    c.follow = (b.status === 'added' || memberUids.has(b.uid)) ? 1 : 0
                    ;(c as any)._botStatus = b.status // "added" | "pending" | "not_added"
                    ;(c as any)._description = b.description
                    return c
                })
        } else if (filterMode === 'humans') {
            const filtered = spaceMembers.filter(m => m.uid !== myUID && m.robot !== 1)
            items = filtered.map(m => {
                const c = new Contacts()
                c.uid = m.uid
                c.name = m.name
                c.avatar = m.avatar || ""
                c.follow = 1
                c.robot = false
                ;(c as any)._spaceRole = m.role
                return c
            })
        } else {
            // "全部"：spaceMembers + spaceBots 中不在 members 里的 AI
            const memberUids = new Set(spaceMembers.map(m => m.uid))
            const memberItems: Contacts[] = spaceMembers
                .filter(m => m.uid !== myUID)
                .map(m => {
                    const c = new Contacts()
                    c.uid = m.uid
                    c.name = m.name
                    c.avatar = m.avatar || ""
                    c.follow = 1
                    c.robot = m.robot === 1
                    ;(c as any)._spaceRole = m.role
                    return c
                })
            // 补充 spaceBots 中未出现在 members 的 AI
            const extraBots: Contacts[] = (spaceBots || [])
                .filter((b: any) => b.uid !== myUID && !memberUids.has(b.uid))
                .map((b: any) => {
                    const c = new Contacts()
                    c.uid = b.uid
                    c.name = b.name || b.uid
                    c.avatar = b.avatar || ""
                    c.robot = true
                    c.follow = 0
                    return c
                })
            items = [...memberItems, ...extraBots]
        }

        // 预计算拼音，避免排序和分组时重复转换
        const pinyinCache = new Map<string, string>()
        for (const item of items) {
            let name = (item.remark || item.name || '').replace(/\*\*/g, '')
            const cachedPinyin = this.contactsSearchIndex.pinyinByUid.get(item.uid)
            pinyinCache.set(item.uid, (cachedPinyin || getPinyin(toSimplized(name))).toUpperCase())
        }

        // 按拼音排序
        items.sort((a, b) => {
            return pinyinCache.get(a.uid)!.localeCompare(pinyinCache.get(b.uid)!)
        })

        // 构建字母分组索引
        const indexItemMap = new Map<string, Contacts[]>()
        const indexList: string[] = []
        const listRows: ContactListRow[] = []
        let prevLetter = ''

        for (const item of items) {
            const py = pinyinCache.get(item.uid)!
            const letter = getLetterFromPinyin(py)

            if (!indexItemMap.has(letter)) {
                indexItemMap.set(letter, [])
                indexList.push(letter)
            }
            indexItemMap.get(letter)!.push(item)
            listRows.push({
                item,
                letter,
                showLetter: letter !== prevLetter,
            })
            prevLetter = letter
        }

        // 排序字母：A-Z, # 排最后
        indexList.sort((a, b) => {
            if (a === '#') return 1
            if (b === '#') return -1
            return a.localeCompare(b)
        })

        return { items, indexList, indexItemMap, listRows }
    }

    private rebuildIndex() {
        const { items, indexList, indexItemMap, listRows } = this.getIndex(this.state.filterMode)
        this.flatItems = items
        this.maybePrefetchSmallList()
        this.setState({ indexList, indexItemMap, listRows })
    }

    private debouncedSearch = debounce((keyword: string) => {
        if (!keyword || keyword.trim() === '') {
            this.setState({ isSearching: false, searchContacts: [], searchGroups: [] })
            return
        }

        // contacts_searched:仅 keyword 非空(去抖后)发;不采 keyword
        Dap.shared.track('contacts_searched', {})

        const { contacts, groups } = searchContacts(keyword, this.contactsSearchIndex)

        this.setState({
            isSearching: true,
            searchContacts: contacts,
            searchGroups: groups,
        })
    }, 300)

    private handleSearchChange = (value: string) => {
        this.setState({ keyword: value })
        this.debouncedSearch(value)
    }

    private handleClearSearch = () => {
        this.setState({ keyword: '', isSearching: false, searchContacts: [], searchGroups: [] })
    }

    private toggleSection = (section: ContactsDirectorySectionKey) => {
        const willExpand = this.state.expandedSection !== section
        // contacts_group_expanded:仅展开态发(gate willExpand),props 恒空(不带 section)
        if (willExpand) {
            Dap.shared.track('contacts_group_expanded', {})
        }
        this.setState({
            expandedSection: willExpand ? section : null,
        })
    }

    private handleContactClick = (uid: string, isBot: boolean) => {
        // contact_opened:补 is_ai / bot_type(system=botfather,余 custom;非 bot 为 null)
        Dap.shared.track('contact_opened', {
            object_id: uid,
            is_ai: isBot,
            bot_type: isBot ? (uid === 'botfather' ? 'system' : 'custom') : null,
        })
        if (isBot && uid !== 'botfather') {
            this.setState({ botDetailUid: uid, botDetailVisible: true })
            return
        }
        if (uid === 'botfather') {
            // BotFather 直接进聊天。botfather_opened 的来源标记(pendingBotfatherOpenEntry)不在此处写:
            // handleContactClick 有 4 个调用点(横幅 / 空间成员行 / 已加 AI 行 / 联系人·搜索行),只有横幅
            // 语义上是 contact_banner。故 sentinel 由 renderBotFatherBanner 的 onClick 单独写,其余入口点到
            // botfather 时不带标记 → ChatContentPage 挂载处落缺省 "conversation"。
            WKApp.endpoints.showConversation(new Channel(uid, ChannelTypePerson))
            return
        }
        // 人：弹出名片（劫持全局 hideUserInfo 以确保弹窗关闭）
        const origHide = WKApp.shared.baseContext.hideUserInfo.bind(WKApp.shared.baseContext)
        WKApp.shared.baseContext.hideUserInfo = () => {
            this.setState({ userInfoVisible: false })
            WKApp.shared.baseContext.hideUserInfo = origHide
        }
        this.setState({ userInfoUid: uid, userInfoVisible: true })
    }

    private handleGroupClick = (groupNo: string, name?: string, memberCount?: number) => {
        // group_card_opened:通讯录内点群行弹出群名片(唯一收口点,搜索结果行 + 列表行两处 onClick 都走这里)。
        // 与 contact_opened(打开人/bot 名片)对称。object_id 用原始 group_no(与本文件其他 opened 事件
        // 同口径,不 stripSpacePrefix)。仅记「打开卡片」这一手势;从卡片点「进入聊天」是另一事件 channel_opened。
        Dap.shared.track('group_card_opened', { object_id: groupNo })
        this.setState({ groupCardVisible: true, groupCardGroupNo: groupNo, groupCardName: name, groupCardMemberCount: memberCount })
    }

    private handleFilterChange = (mode: ContactFilterMode) => {
        if (this.state.filterMode === mode) return
        // contacts_filter_switched:已 guard 同值;props 恒空(不带 mode)
        Dap.shared.track('contacts_filter_switched', {})
        const { items, indexList, indexItemMap, listRows } = this.getIndex(mode)
        this.flatItems = items
        this.maybePrefetchSmallList()
        this.setState({ filterMode: mode, indexList, indexItemMap, listRows })
    }

    // ─── Render Helpers ─────────────────────────────

    renderBotFatherBanner() {
        return (
            <div className="wk-contacts-botfather-banner" onClick={() => {
                // 走 handleContactClick 而非直接 showConversation:后者绕过 contact_opened
                // 埋点(PR #1320 review P1-4)。handleContactClick('botfather', true) 会先补
                // contact_opened(is_bot/bot_type),再执行同样的「直接进聊天」。
                // botfather_opened 来源标记:仅本入口(顶端横幅)= contact_banner。在调用 handleContactClick
                // 前写 sentinel,ChatContentPage 挂载时一次性消费;其余点到 botfather 的入口不写 → 缺省
                // "conversation"。避免归因写在 handleContactClick 里被 4 个调用点共享而误标(PR #1510 P2-1)。
                WKApp.shared.pendingBotfatherOpenEntry = "contact_banner"
                this.handleContactClick("botfather", true)
            }}>
                <div className="wk-contacts-botfather-avatar">
                    <WKAvatar channel={new Channel("botfather", ChannelTypePerson)} />
                </div>
                <div className="wk-contacts-botfather-info">
                    <div className="wk-contacts-botfather-name">BotFather</div>
                    <div className="wk-contacts-botfather-desc">{t("contacts.botFather.desc")}</div>
                </div>
                <ChevronRight size={16} color="rgba(255,255,255,0.6)" />
            </div>
        )
    }

    renderSearch() {
        const { searchContacts, searchGroups } = this.state
        return (
            <ContactsSearch
                copy={{
                    placeholder: t("contacts.search.placeholder"),
                    emptyText: t("contacts.search.noResults"),
                    contactsTitle: t("contacts.section.contacts"),
                    groupsTitle: t("contacts.section.groups"),
                }}
                state={{
                    keyword: this.state.keyword || '',
                    isSearching: this.state.isSearching,
                    hasResults: searchContacts.length > 0 || searchGroups.length > 0,
                }}
                onKeywordChange={this.handleSearchChange}
                onClear={this.handleClearSearch}
                results={{
                    contacts: searchContacts.length > 0 ? searchContacts.map((m: any) => (
                            <div key={m.uid} className="wk-contacts-section-item" onClick={() => {
                                this.handleContactClick(m.uid, m.robot === 1)
                            }}>
                                <div className="wk-contacts-section-item-avatar">
                                    <WKAvatar channel={new Channel(m.uid, ChannelTypePerson)} />
                                </div>
                                <div className="wk-contacts-section-item-name">
                                    {m.name}
                                    {m.robot === 1 && <AiBadge />}
                                </div>
                            </div>
                        )) : undefined,
                    groups: searchGroups.length > 0 ? searchGroups.map((g: any) => (
                            <div key={g.group_no} className="wk-contacts-section-item" onClick={() => {
                                this.handleGroupClick(g.group_no, g.name, g.member_count)
                            }}>
                                <div className="wk-contacts-section-item-avatar">
                                    <WKAvatar channel={new Channel(g.group_no, ChannelTypeGroup)} />
                                </div>
                                <OverflowTooltip text={g.name}>
                                    <span className="wk-contacts-group-tag">{t("contacts.tag.group")}</span>
                                </OverflowTooltip>
                            </div>
                        )) : undefined,
                }}
            />
        )
    }

    private getFilterCounts() {
        const { spaceMembers, spaceBots } = this.state
        const myUID = WKApp.loginInfo.uid || ""
        const memberUids = new Set(spaceMembers.map(m => m.uid))

        const humansCount = spaceMembers.filter(m => m.uid !== myUID && m.robot !== 1).length
        const botsCount = (spaceBots || []).filter((b: any) => b.uid !== myUID).length
        // "全部" = members(去掉自己) + spaceBots 中不在 members 的
        const allCount = spaceMembers.filter(m => m.uid !== myUID).length
            + (spaceBots || []).filter((b: any) => b.uid !== myUID && !memberUids.has(b.uid)).length

        return { allCount, botsCount, humansCount }
    }

    renderFilterChips() {
        const { filterMode } = this.state
        const { allCount, botsCount, humansCount } = this.getFilterCounts()
        return (
            <div className="wk-contacts-filters">
                <span className={classnames("wk-contacts-chip", filterMode === 'all' && "active")}
                    onClick={() => this.handleFilterChange('all')}>{t("contacts.filter.all")} {allCount > 0 && <span className="wk-contacts-chip-count">{allCount}</span>}</span>
                <span className={classnames("wk-contacts-chip", filterMode === 'bots' && "active")}
                    onClick={() => this.handleFilterChange('bots')}>AI {botsCount > 0 && <span className="wk-contacts-chip-count">{botsCount}</span>}</span>
                <span className={classnames("wk-contacts-chip", filterMode === 'humans' && "active")}
                    onClick={() => this.handleFilterChange('humans')}>{t("contacts.filter.humans")} {humansCount > 0 && <span className="wk-contacts-chip-count">{humansCount}</span>}</span>
            </div>
        )
    }

    renderGroupsSection() {
        const { expandedSection, myGroups } = this.state
        const isExpanded = expandedSection === 'groups'
        const groups = myGroups || []

        return (
            <ContactsDirectorySection sectionKey="groups" expanded={isExpanded} icon={<UsersRound size={16} />} label={t("contacts.section.groups")} count={groups.length} onToggle={this.toggleSection}>
                    <div className="wk-contacts-accordion-body">
                        {groups.length === 0 ? (
                            <Empty
                                illustration={false}
                                description={t("contacts.empty.groups")}
                                className="wk-contacts-empty"
                            />
                        ) : groups.map((g: any) => (
                            <div key={g.group_no} className="wk-contacts-section-item" onClick={() => {
                                this.handleGroupClick(g.group_no, g.name, g.member_count)
                            }}>
                                <div className="wk-contacts-section-item-avatar">
                                    <WKAvatar channel={new Channel(g.group_no, ChannelTypeGroup)} />
                                </div>
                                <OverflowTooltip text={g.name}>
                                    <span className="wk-contacts-group-tag">{t("contacts.tag.group")}</span>
                                </OverflowTooltip>
                            </div>
                        ))}
                    </div>
            </ContactsDirectorySection>
        )
    }

    renderMyBotsSection() {
        const { expandedSection, myBots } = this.state
        const isExpanded = expandedSection === 'myBots'
        const bots = myBots || []

        return (
            <ContactsDirectorySection sectionKey="myBots" expanded={isExpanded} icon={<Bot size={16} />} label={t("contacts.section.addedAi")} count={bots.length} onToggle={this.toggleSection}>
                    <div className="wk-contacts-accordion-body">
                        {bots.length === 0 ? (
                            <Empty
                                illustration={false}
                                description={t("contacts.empty.ai")}
                                className="wk-contacts-empty"
                            />
                        ) : bots.map((bot: any) => (
                            <div key={bot.uid} className="wk-contacts-section-item" onClick={() => {
                                this.handleContactClick(bot.uid, true)
                            }}>
                                <div className="wk-contacts-section-item-avatar">
                                    <WKAvatar channel={new Channel(bot.uid, ChannelTypePerson)} />
                                    {this.renderOnlineBadge(bot.uid)}
                                </div>
                                <div className="wk-contacts-section-item-name">
                                    {bot.name || bot.uid}
                                    <AiBadge />
                                </div>
                            </div>
                        ))}
                    </div>
            </ContactsDirectorySection>
        )
    }

    renderAllContactsSection() {
        const { expandedSection } = this.state
        const isExpanded = expandedSection === 'allContacts'
        const totalCount = this.flatItems.length

        return (
            <ContactsDirectorySection sectionKey="allContacts" expanded={isExpanded} icon={<Users size={16} />} label={t("contacts.section.allContacts")} count={totalCount} onToggle={this.toggleSection}>
                    <>
                        {this.renderFilterChips()}
                        {totalCount === 0 ? (
                            <Empty
                                illustration={false}
                                description={t("contacts.empty.members")}
                                className="wk-contacts-empty"
                            />
                        ) : this.renderContactListWithLetters()}
                    </>
            </ContactsDirectorySection>
        )
    }

    renderContactListWithLetters() {
        const { filterMode, indexList, indexItemMap, listRows } = this.state

        // 大量联系人用虚拟列表（函数组件 + useVirtualizer）
        if (this.flatItems.length > 100) {
            return (
                <VirtualContactList
                    key={filterMode}
                    rows={listRows}
                    renderItem={(item) => this.renderContactItem(item)}
                    initialScrollTop={this.filterScrollTops[filterMode] || 0}
                    onScrollTopChange={this.handleListScroll}
                    onVisibleUids={this.prefetchOnlineStatus}
                />
            )
        }

        // 少量项目直接渲染
        return (
            <div
                key={filterMode}
                ref={this.restoreListScroll}
                className="wk-contacts-accordion-body"
                onScroll={(event) => this.handleListScroll(event.currentTarget.scrollTop)}
            >
                {indexList.map(letter => {
                    const items = indexItemMap.get(letter)
                    if (!items || items.length === 0) return null
                    return (
                        <div key={letter}>
                            <div className="wk-contacts-letter-header">{letter}</div>
                            {items.map(item => this.renderContactItem(item))}
                        </div>
                    )
                })}
            </div>
        )
    }

    renderContactItem(item: Contacts) {
        let name = (item.name || '').replace(/\*\*/g, '')
        if (item.remark && item.remark !== "") name = item.remark
        return (
            <div key={item.uid} className={classnames("wk-contacts-section-item",
                WKApp.shared.openChannel?.channelType === ChannelTypePerson && WKApp.shared.openChannel?.channelID === item.uid ? "wk-contacts-section-item-selected" : undefined
            )} onClick={() => {
                this.handleContactClick(item.uid, item.robot === true)
            }}>
                <div className="wk-contacts-section-item-avatar">
                    <WKAvatar channel={new Channel(item.uid, ChannelTypePerson)} />
                    {shouldShowOnlineStatus(item) && this.renderOnlineBadge(item.uid)}
                </div>
                <OverflowTooltip text={name}>
                    {item.robot === true && <AiBadge />}
                    {(item as any)._spaceRole != null && (item as any)._spaceRole > 0 && (item as any)._spaceRole <= 2 && (
                        <span className={`wk-contacts-role-badge wk-contacts-role-badge--${(item as any)._spaceRole === 1 ? 'owner' : 'admin'}`}>
                            {t(`contacts.role.${(item as any)._spaceRole}`)}
                        </span>
                    )}
                </OverflowTooltip>
            </div>
        )
    }

    render() {
        const { isSearching } = this.state

        return <WKBase>
            <ErrorBoundary moduleName={t("contacts.page.title")}>
                <div className="wk-contacts">
                    <div className="wk-contacts-content">
                        {this.renderBotFatherBanner()}
                        {this.renderSearch()}

                        {!isSearching && (
                            <ContactsDirectory>
                                {this.renderGroupsSection()}
                                {this.renderMyBotsSection()}
                                {this.renderAllContactsSection()}
                            </ContactsDirectory>
                        )}
                    </div>

                    <WKModal
                        title={null}
                        visible={this.state.userInfoVisible}
                        onCancel={() => this.setState({ userInfoVisible: false })}
                        className="wk-base-modal-userinfo wk-base-modal"
                        options={{ closable: false }}
                    >
                        {this.state.userInfoUid && (
                            <UserInfo
                                uid={this.state.userInfoUid}
                                onClose={() => this.setState({ userInfoVisible: false })}
                                trackContactMessageEntry
                            />
                        )}
                    </WKModal>

                    <BotDetailModal
                        uid={this.state.botDetailUid || ""}
                        visible={this.state.botDetailVisible}
                        onClose={() => {
                            this.setState({ botDetailVisible: false })
                            // 关闭后刷新 spaceBots 状态
                            const spaceId = WKApp.shared.currentSpaceId
                            if (spaceId) {
                                WKApp.apiClient.get("/robot/space_bots", { param: { space_id: spaceId } }).then((res: any) => {
                                    this.setState({ spaceBots: res || [] }, () => {
                                        this.rebuildContactsSearchIndex()
                                        this.clearIndexCache()
                                        this.rebuildIndex()
                                    })
                                }).catch(() => {})
                            }
                        }}
                        onChat={(channel) => {
                            // contact_message_clicked:通讯录 AI 名片「发消息」收口点(此 BotDetailModal 实例专属通讯录页,
                            // 不同于全局共享实例)。channel.channelID = bot uid。
                            Dap.shared.track('contact_message_clicked', {
                                object_id: channel.channelID,
                                contact_type: 'ai',
                                space_id: WKApp.shared.currentSpaceId || undefined,
                            })
                            WKApp.endpoints.showConversation(channel)
                            this.setState({ botDetailVisible: false })
                        }}
                    />

                    <GroupCard
                        groupNo={this.state.groupCardGroupNo || ""}
                        name={this.state.groupCardName}
                        memberCount={this.state.groupCardMemberCount}
                        visible={this.state.groupCardVisible}
                        onClose={() => this.setState({ groupCardVisible: false })}
                        onEnterChat={(channel) => {
                            // channel_opened:通讯录群聊名片「进入聊天」收口点(群聊)。与会话列表行同为命令式采集,
                            // 复用 channelOpenedTrackPayload 保证 object_id(原始 channelID)与 channel_type 口径一致。
                            // 群聊无「对端 AI」语义 → 不带 is_ai(helper 仅 person 行携带)。
                            const payload = channelOpenedTrackPayload(channel, false)
                            if (payload) Dap.shared.track('channel_opened', payload)
                            WKApp.endpoints.showConversation(channel)
                            this.setState({ groupCardVisible: false })
                        }}
                    />
                </div>
            </ErrorBoundary>
        </WKBase>
    }
}
