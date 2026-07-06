import React, { useEffect, useRef, useState, useCallback } from "react";
import { Component } from "react";
import { Contacts, ContextMenus, ContextMenusContext, WKApp, WKBase, WKBaseContext, ErrorBoundary, WKModal, I18nContext, t } from "@octo/base"
import "./index.css"
import { toSimplized } from "@octo/base";
import { getPinyin } from "@octo/base";
import classnames from "classnames";
import { Toast, Tooltip } from "@douyinfe/semi-ui";
import { ChevronRight, ChevronDown, Users, Bot, UsersRound, Search as SearchIcon } from "lucide-react";

import { Channel, ChannelTypePerson, ChannelTypeGroup, WKSDK, ChannelInfoListener, ChannelInfo } from "wukongimjssdk";
import { ContactsListManager } from "../Service/ContactsListManager";
import { Card } from "@octo/base/src/Messages/Card";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import AiBadge from "@octo/base/src/Components/AiBadge";
import BotDetailModal from "@octo/base/src/Components/BotDetailModal";
import UserInfo from "@octo/base/src/Components/UserInfo";
import GroupCard from "@octo/base/src/Components/GroupCard";
import { Space, SpaceMember, SpaceService } from "@octo/base/src/Service/SpaceService";
import { debounce } from "@octo/base/src/Utils/rateLimit";
import { useVirtualizer } from "@tanstack/react-virtual";

function OverflowTooltip({ text, children }: { text: string; children: React.ReactNode }) {
    const [visible, setVisible] = useState(false)
    const textRef = useRef<HTMLSpanElement>(null)
    const onEnter = useCallback(() => {
        if (textRef.current && textRef.current.scrollWidth > textRef.current.clientWidth) {
            setVisible(true)
        }
    }, [])
    const onLeave = useCallback(() => setVisible(false), [])
    return (
        <Tooltip content={text} position="right" trigger="custom" visible={visible}>
            <div className="wk-contacts-section-item-name" onMouseEnter={onEnter} onMouseLeave={onLeave}>
                <span ref={textRef} className="wk-contacts-section-item-text">{text}</span>
                {children}
            </div>
        </Tooltip>
    )
}

const ITEM_HEIGHT = 44
const LETTER_HEADER_HEIGHT = 24

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
}

function VirtualContactList({ rows, renderItem, initialScrollTop, onScrollTopChange }: VirtualContactListProps) {
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

    return (
        <div
            ref={parentRef}
            className="wk-contacts-all-list"
            onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
        >
            <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                {virtualizer.getVirtualItems().map(virtualItem => {
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
    selectedItem?: Contacts
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
    contextMenusContext!: ContextMenusContext
    baseContext!: WKBaseContext
    private spaceChangedHandler!: (space: any) => void
    private flatItems: Contacts[] = []
    private indexCache = new Map<ContactFilterMode, ContactIndexData>()
    private filterScrollTops: Record<ContactFilterMode, number> = { all: 0, bots: 0, humans: 0 }

    constructor(props: any) {
        super(props)
        this.state = new ContactsState()
    }

    componentDidMount() {
        this.channelInfoListener = (channelInfo: ChannelInfo) => {
            if (channelInfo.channel.channelType !== ChannelTypePerson) return
            const idx = this.state.spaceMembers.findIndex(
                (m) => m.uid === channelInfo.channel.channelID
            )
            if (idx !== -1) {
                const members = [...this.state.spaceMembers]
                members[idx] = { ...members[idx], name: channelInfo.title }
                this.setState({ spaceMembers: members }, () => {
                    this.clearIndexCache()
                    this.rebuildIndex()
                })
            }
        }

        this.spaceChangedHandler = (space: any) => {
            const sp = space as Space | undefined
            this.clearIndexCache()
            this.resetFilterScrollTops()
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
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)

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
        ContactsListManager.shared.setRefreshList = undefined
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
        WKApp.mittBus.off('space-changed', this.spaceChangedHandler)
        this.debouncedSearch.cancel()
    }

    private async loadAllData(spaceId: string) {
        try {
            const [members, myBots, spaceBots, myGroups] = await Promise.all([
                SpaceService.shared.getMembers(spaceId, 1, 10000),
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
                this.clearIndexCache()
                this.rebuildIndex()
            })
        } catch {
            this.setState({ loading: false })
        }
    }

    private clearIndexCache() {
        this.indexCache.clear()
    }

    private resetFilterScrollTops() {
        this.filterScrollTops = { all: 0, bots: 0, humans: 0 }
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
            pinyinCache.set(item.uid, getPinyin(toSimplized(name)).toUpperCase())
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
        this.setState({ indexList, indexItemMap, listRows })
    }

    private debouncedSearch = debounce((keyword: string) => {
        if (!keyword || keyword.trim() === '') {
            this.setState({ isSearching: false, searchContacts: [], searchGroups: [] })
            return
        }

        const { spaceMembers, spaceBots, myGroups } = this.state
        const myUID = WKApp.loginInfo.uid || ""
        const kw = keyword.toLowerCase()

        const memberUids = new Set(spaceMembers.map(m => m.uid))
        const memberResults = spaceMembers
            .filter(m => m.uid !== myUID)
            .filter(m => m.name.replace(/\*\*/g, '').toLowerCase().includes(kw))
        // spaceBots 中不在 members 里的 AI 也参与搜索
        const extraBotResults = (spaceBots || [])
            .filter((b: any) => b.uid !== myUID && !memberUids.has(b.uid))
            .filter((b: any) => (b.name || '').toLowerCase().includes(kw))
            .map((b: any) => ({ ...b, robot: 1 }))
        const contacts = [...memberResults, ...extraBotResults]

        const groups = (myGroups || [])
            .filter((g: any) => g.name && g.name.toLowerCase().includes(kw))

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

    private toggleSection = (section: 'groups' | 'myBots' | 'allContacts') => {
        const willExpand = this.state.expandedSection !== section
        this.setState({
            expandedSection: willExpand ? section : null,
        })
    }

    private handleContactClick = (uid: string, isBot: boolean) => {
        if (isBot && uid !== 'botfather') {
            this.setState({ botDetailUid: uid, botDetailVisible: true })
            return
        }
        if (uid === 'botfather') {
            // BotFather 直接进聊天
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
        this.setState({ groupCardVisible: true, groupCardGroupNo: groupNo, groupCardName: name, groupCardMemberCount: memberCount })
    }

    private handleFilterChange = (mode: ContactFilterMode) => {
        if (this.state.filterMode === mode) return
        const { items, indexList, indexItemMap, listRows } = this.getIndex(mode)
        this.flatItems = items
        this.setState({ filterMode: mode, indexList, indexItemMap, listRows })
    }

    _handleContextMenu(item: Contacts, event: React.MouseEvent) {
        this.contextMenusContext.show(event)
        this.setState({ selectedItem: item })
    }

    // ─── Render Helpers ─────────────────────────────

    renderBotFatherBanner() {
        return (
            <div className="wk-contacts-botfather-banner" onClick={() => {
                WKApp.endpoints.showConversation(new Channel("botfather", ChannelTypePerson))
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

    renderSearchBox() {
        return (
            <div className="wk-contacts-search">
                <div className="wk-contacts-search-input">
                    <SearchIcon size={14} className="wk-contacts-search-icon" />
                    <input
                        type="text"
                        placeholder={t("contacts.search.placeholder")}
                        value={this.state.keyword || ''}
                        onChange={(e) => this.handleSearchChange(e.target.value)}
                    />
                    {this.state.keyword && (
                        <span className="wk-contacts-search-clear" onClick={this.handleClearSearch}>&times;</span>
                    )}
                </div>
            </div>
        )
    }

    renderSearchResults() {
        const { searchContacts, searchGroups } = this.state

        if (searchContacts.length === 0 && searchGroups.length === 0) {
            return (
                <div className="wk-contacts-empty">
                    <SearchIcon size={28} className="wk-contacts-empty-icon" />
                    <div className="wk-contacts-empty-text">{t("contacts.search.noResults")}</div>
                </div>
            )
        }

        return (
            <div className="wk-contacts-search-results">
                {searchContacts.length > 0 && (
                    <div className="wk-contacts-search-section">
                        <div className="wk-contacts-search-section-title">{t("contacts.section.contacts")}</div>
                        {searchContacts.map((m: any) => (
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
                        ))}
                    </div>
                )}
                {searchGroups.length > 0 && (
                    <div className="wk-contacts-search-section">
                        <div className="wk-contacts-search-section-title">{t("contacts.section.groups")}</div>
                        {searchGroups.map((g: any) => (
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
                )}
            </div>
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

    renderAccordionHeader(section: 'groups' | 'myBots' | 'allContacts', icon: React.ReactNode, label: string, count: number) {
        const isExpanded = this.state.expandedSection === section
        return (
            <div className="wk-contacts-accordion-header" onClick={() => this.toggleSection(section)}>
                <span className="wk-contacts-accordion-arrow">{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                <span className="wk-contacts-accordion-icon">{icon}</span>
                <span className="wk-contacts-accordion-label">{label}</span>
                {count > 0 && <span className="wk-contacts-accordion-count">({count})</span>}
            </div>
        )
    }

    renderGroupsSection() {
        const { expandedSection, myGroups } = this.state
        const isExpanded = expandedSection === 'groups'
        const groups = myGroups || []

        return (
            <div className={classnames("wk-contacts-accordion", isExpanded && "wk-contacts-accordion--expanded")}>
                {this.renderAccordionHeader('groups', <UsersRound size={16} />, t("contacts.section.groups"), groups.length)}
                {isExpanded && (
                    <div className="wk-contacts-accordion-body">
                        {groups.length === 0 ? (
                            <div className="wk-contacts-empty">
                                <UsersRound size={28} className="wk-contacts-empty-icon" />
                                <div className="wk-contacts-empty-text">{t("contacts.empty.groups")}</div>
                            </div>
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
                )}
            </div>
        )
    }

    renderMyBotsSection() {
        const { expandedSection, myBots } = this.state
        const isExpanded = expandedSection === 'myBots'
        const bots = myBots || []

        return (
            <div className={classnames("wk-contacts-accordion", isExpanded && "wk-contacts-accordion--expanded")}>
                {this.renderAccordionHeader('myBots', <Bot size={16} />, t("contacts.section.addedAi"), bots.length)}
                {isExpanded && (
                    <div className="wk-contacts-accordion-body">
                        {bots.length === 0 ? (
                            <div className="wk-contacts-empty">
                                <Bot size={28} className="wk-contacts-empty-icon" />
                                <div className="wk-contacts-empty-text">{t("contacts.empty.ai")}</div>
                            </div>
                        ) : bots.map((bot: any) => (
                            <div key={bot.uid} className="wk-contacts-section-item" onClick={() => {
                                this.handleContactClick(bot.uid, true)
                            }}>
                                <div className="wk-contacts-section-item-avatar">
                                    <WKAvatar channel={new Channel(bot.uid, ChannelTypePerson)} />
                                </div>
                                <div className="wk-contacts-section-item-name">
                                    {bot.name || bot.uid}
                                    <AiBadge />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )
    }

    renderAllContactsSection() {
        const { expandedSection } = this.state
        const isExpanded = expandedSection === 'allContacts'
        const totalCount = this.flatItems.length

        return (
            <div className={classnames("wk-contacts-accordion", isExpanded && "wk-contacts-accordion--expanded")}>
                {this.renderAccordionHeader('allContacts', <Users size={16} />, t("contacts.section.allContacts"), totalCount)}
                {isExpanded && (
                    <>
                        {this.renderFilterChips()}
                        {totalCount === 0 ? (
                            <div className="wk-contacts-empty">
                                <Users size={28} className="wk-contacts-empty-icon" />
                                <div className="wk-contacts-empty-text">{t("contacts.empty.members")}</div>
                            </div>
                        ) : this.renderContactListWithLetters()}
                    </>
                )}
            </div>
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
            }} onContextMenu={(e) => {
                this._handleContextMenu(item, e)
            }}>
                <div className="wk-contacts-section-item-avatar">
                    <WKAvatar channel={new Channel(item.uid, ChannelTypePerson)} />
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

        return <WKBase onContext={(baseCtx) => {
            this.baseContext = baseCtx
        }}>
            <ErrorBoundary moduleName={t("contacts.page.title")}>
                <div className="wk-contacts">
                    <div className="wk-contacts-content">
                        {this.renderBotFatherBanner()}
                        {this.renderSearchBox()}

                        {isSearching ? (
                            this.renderSearchResults()
                        ) : (
                            <>
                                {this.renderGroupsSection()}
                                {this.renderMyBotsSection()}
                                {this.renderAllContactsSection()}
                            </>
                        )}
                    </div>

                    <ContextMenus onContext={(context: ContextMenusContext) => {
                        this.contextMenusContext = context
                    }} menus={[{
                        title: t("contacts.context.viewProfile"), onClick: () => {
                            const { selectedItem } = this.state
                            this.setState({ userInfoUid: selectedItem?.uid || "", userInfoVisible: true })
                        }
                    }, {
                        title: t("contacts.context.shareToFriend"), onClick: () => {
                            WKApp.shared.baseContext.showConversationSelect((channels: Channel[]) => {
                                const { selectedItem } = this.state
                                if (channels && channels.length > 0) {
                                    for (const channel of channels) {
                                        const card = new Card()
                                        card.uid = selectedItem?.uid || ""
                                        card.name = selectedItem?.name || ""
                                        card.vercode = selectedItem?.vercode || ""
                                        WKSDK.shared().chatManager.send(card, channel)
                                    }
                                    Toast.success(t("contacts.share.success"))
                                }
                            }, t("contacts.share.cardTitle"))
                        }
                    }]} />

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
                                    this.setState({ spaceBots: res || [] }, () => this.rebuildIndex())
                                }).catch(() => {})
                            }
                        }}
                        onChat={(channel) => {
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
                            WKApp.endpoints.showConversation(channel)
                            this.setState({ groupCardVisible: false })
                        }}
                    />
                </div>
            </ErrorBoundary>
        </WKBase>
    }
}
