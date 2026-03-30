import React from "react";
import { Component, createRef } from "react";
import { Contacts, ContextMenus, ContextMenusContext, WKApp, WKBase, WKBaseContext, ErrorBoundary } from "@octo/base"
import "./index.css"
import { toSimplized } from "@octo/base";
import { getPinyin } from "@octo/base";
import classnames from "classnames";
import { Toast } from "@douyinfe/semi-ui";
import { ChevronRight, ChevronDown, Users, Bot, UsersRound, Search as SearchIcon } from "lucide-react";

import { Channel, ChannelTypePerson, ChannelTypeGroup, WKSDK, ChannelInfoListener, ChannelInfo } from "wukongimjssdk";
import { ContactsListManager } from "../Service/ContactsListManager";
import { Card } from "@octo/base/src/Messages/Card";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import AiBadge from "@octo/base/src/Components/AiBadge";
import BotDetailModal from "@octo/base/src/Components/BotDetailModal";
import GroupCard from "@octo/base/src/Components/GroupCard";
import { Space, SpaceMember, SpaceService } from "@octo/base/src/Service/SpaceService";
import { debounce } from "@octo/base/src/Utils/rateLimit";
import { Virtualizer } from "@tanstack/virtual-core";

const SpaceRoleLabels: Record<number, string> = { 1: '创建者', 2: '管理员', 3: '成员' }

export class ContactsState {
    keyword?: string
    selectedItem?: Contacts
    currentSpace?: Space
    spaceMembers: SpaceMember[] = []

    // 手风琴展开状态
    expandedSection: 'groups' | 'myBots' | 'allContacts' | null = 'allContacts'

    // 数据源
    myBots: any[] = []
    myGroups: any[] = []

    // 筛选
    filterMode: 'all' | 'bots' | 'humans' = 'all'

    // 搜索
    isSearching: boolean = false
    searchContacts: any[] = []
    searchGroups: any[] = []

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

    // 加载
    loading: boolean = true
}

export default class ContactsList extends Component<any, ContactsState> {
    channelInfoListener!: ChannelInfoListener
    contextMenusContext!: ContextMenusContext
    baseContext!: WKBaseContext
    private spaceChangedHandler!: (space: any) => void

    private scrollContainerRef = createRef<HTMLDivElement>()
    private virtualListRef = createRef<HTMLDivElement>()
    private virtualizer?: Virtualizer<HTMLDivElement, Element>
    private flatItems: Contacts[] = []

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
                this.setState({ spaceMembers: members }, () => this.rebuildIndex())
            }
        }

        this.spaceChangedHandler = (space: any) => {
            const sp = space as Space | undefined
            if (sp) {
                this.setState({ currentSpace: sp, myGroups: [], myBots: [], loading: true }, () => {
                    this.loadAllData(sp.space_id)
                })
            } else {
                this.setState({ currentSpace: undefined, spaceMembers: [], myBots: [], myGroups: [] })
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
        if (this.virtualizer) {
            this.virtualizer = undefined
        }
    }

    private async loadAllData(spaceId: string) {
        try {
            const [members, myBots, myGroups] = await Promise.all([
                SpaceService.shared.getMembers(spaceId, 1, 10000),
                WKApp.apiClient.get("/robot/my_bots", { param: { space_id: spaceId } }).catch(() => []),
                WKApp.apiClient.get(`/group/my?space_id=${spaceId}`).catch(() => []),
            ])
            this.setState({
                spaceMembers: members || [],
                myBots: myBots || [],
                myGroups: myGroups || [],
                loading: false,
            }, () => {
                this.rebuildIndex()
            })
        } catch {
            this.setState({ loading: false })
        }
    }

    private rebuildIndex() {
        const { spaceMembers, filterMode, keyword } = this.state
        const myUID = WKApp.loginInfo.uid || ""

        let filtered = spaceMembers.filter(m => m.uid !== myUID)

        // 筛选
        if (filterMode === 'bots') {
            filtered = filtered.filter(m => m.robot === 1)
        } else if (filterMode === 'humans') {
            filtered = filtered.filter(m => m.robot !== 1)
        }

        // 搜索（非搜索模式下不过滤）
        // 搜索模式由 debouncedSearch 处理，这里只构建索引

        // 转为 Contacts 对象
        const items: Contacts[] = filtered.map(m => {
            const c = new Contacts()
            c.uid = m.uid
            c.name = m.name
            c.avatar = m.avatar || ""
            c.follow = 1
            c.robot = m.robot === 1
            ;(c as any)._spaceRole = m.role
            return c
        })

        // 按拼音排序
        items.sort((a, b) => {
            const na = (a.remark || a.name || '').replace(/\*\*/g, '')
            const nb = (b.remark || b.name || '').replace(/\*\*/g, '')
            const pa = getPinyin(toSimplized(na)).toUpperCase()
            const pb = getPinyin(toSimplized(nb)).toUpperCase()
            return pa.localeCompare(pb)
        })

        // 构建字母分组索引
        const indexItemMap = new Map<string, Contacts[]>()
        const indexList: string[] = []

        for (const item of items) {
            let name = (item.name || '').replace(/\*\*/g, '')
            if (item.remark && item.remark !== "") name = item.remark
            const py = getPinyin(toSimplized(name)).toUpperCase()
            let letter = (py && py[0]) || '#'
            if (!/[A-Z]/.test(letter)) letter = '#'

            if (!indexItemMap.has(letter)) {
                indexItemMap.set(letter, [])
                indexList.push(letter)
            }
            indexItemMap.get(letter)!.push(item)
        }

        // 排序字母：A-Z, # 排最后
        indexList.sort((a, b) => {
            if (a === '#') return 1
            if (b === '#') return -1
            return a.localeCompare(b)
        })

        // 构建虚拟列表用的扁平数组
        this.flatItems = items
        this.initVirtualizer(items.length)

        this.setState({ indexList, indexItemMap })
    }

    private initVirtualizer(count: number) {
        const el = this.virtualListRef.current
        if (!el) {
            // 延迟初始化
            this.virtualizer = undefined
            return
        }

        const ITEM_HEIGHT = 44
        const LETTER_HEADER_HEIGHT = 24
        this.virtualizer = new Virtualizer({
            count,
            getScrollElement: () => this.virtualListRef.current,
            estimateSize: (index: number) => {
                // 首行或字母切换行需要加上 letter header 高度
                if (index === 0) return ITEM_HEIGHT + LETTER_HEADER_HEIGHT
                const curr = this.flatItems[index]
                const prev = this.flatItems[index - 1]
                if (curr && prev && this.getItemLetter(curr) !== this.getItemLetter(prev)) {
                    return ITEM_HEIGHT + LETTER_HEADER_HEIGHT
                }
                return ITEM_HEIGHT
            },
            overscan: 15,
            onChange: () => {
                this.forceUpdate()
            },
        })
        this.virtualizer._didMount()
    }

    private debouncedSearch = debounce((keyword: string) => {
        if (!keyword || keyword.trim() === '') {
            this.setState({ isSearching: false, searchContacts: [], searchGroups: [] })
            return
        }

        const { spaceMembers, myGroups } = this.state
        const myUID = WKApp.loginInfo.uid || ""
        const kw = keyword.toLowerCase()

        const contacts = spaceMembers
            .filter(m => m.uid !== myUID)
            .filter(m => m.name.toLowerCase().includes(kw))

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
        }, () => {
            // 展开全部联系人时初始化虚拟列表
            if (willExpand && section === 'allContacts') {
                setTimeout(() => {
                    this.initVirtualizer(this.flatItems.length)
                    this.forceUpdate()
                }, 50)
            }
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
        // 人：弹出名片
        this.baseContext.showUserInfo(uid)
    }

    private handleGroupClick = (groupNo: string, name?: string, memberCount?: number) => {
        this.setState({ groupCardVisible: true, groupCardGroupNo: groupNo, groupCardName: name, groupCardMemberCount: memberCount })
    }

    private handleFilterChange = (mode: 'all' | 'bots' | 'humans') => {
        this.setState({ filterMode: mode }, () => {
            this.rebuildIndex()
        })
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
                    <div className="wk-contacts-botfather-desc">创建和管理你的 AI 机器人</div>
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
                        placeholder="搜索通讯录"
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
                    <div className="wk-contacts-empty-text">没有找到相关联系人</div>
                </div>
            )
        }

        return (
            <div className="wk-contacts-search-results">
                {searchContacts.length > 0 && (
                    <div className="wk-contacts-search-section">
                        <div className="wk-contacts-search-section-title">联系人</div>
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
                        <div className="wk-contacts-search-section-title">群聊</div>
                        {searchGroups.map((g: any) => (
                            <div key={g.group_no} className="wk-contacts-section-item" onClick={() => {
                                this.handleGroupClick(g.group_no, g.name, g.member_count)
                            }}>
                                <div className="wk-contacts-section-item-avatar">
                                    <WKAvatar channel={new Channel(g.group_no, ChannelTypeGroup)} />
                                </div>
                                <div className="wk-contacts-section-item-name">
                                    {g.name}
                                    <span className="wk-contacts-group-tag">群</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )
    }

    renderFilterChips() {
        const { filterMode } = this.state
        return (
            <div className="wk-contacts-filters">
                <span className={classnames("wk-contacts-chip", filterMode === 'all' && "active")}
                    onClick={() => this.handleFilterChange('all')}>全部</span>
                <span className={classnames("wk-contacts-chip", filterMode === 'bots' && "active")}
                    onClick={() => this.handleFilterChange('bots')}>只看 AI</span>
                <span className={classnames("wk-contacts-chip", filterMode === 'humans' && "active")}
                    onClick={() => this.handleFilterChange('humans')}>只看人类</span>
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
            <div className="wk-contacts-accordion">
                {this.renderAccordionHeader('groups', <UsersRound size={16} />, '群聊', groups.length)}
                {isExpanded && (
                    <div className="wk-contacts-accordion-body">
                        {groups.length === 0 ? (
                            <div className="wk-contacts-empty">
                                <UsersRound size={28} className="wk-contacts-empty-icon" />
                                <div className="wk-contacts-empty-text">还没有群聊，去创建一个吧</div>
                            </div>
                        ) : groups.map((g: any) => (
                            <div key={g.group_no} className="wk-contacts-section-item" onClick={() => {
                                this.handleGroupClick(g.group_no, g.name, g.member_count)
                            }}>
                                <div className="wk-contacts-section-item-avatar">
                                    <WKAvatar channel={new Channel(g.group_no, ChannelTypeGroup)} />
                                </div>
                                <div className="wk-contacts-section-item-name">
                                    {g.name}
                                    <span className="wk-contacts-group-tag">群</span>
                                </div>
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
            <div className="wk-contacts-accordion">
                {this.renderAccordionHeader('myBots', <Bot size={16} />, '已添加 AI', bots.length)}
                {isExpanded && (
                    <div className="wk-contacts-accordion-body">
                        {bots.length === 0 ? (
                            <div className="wk-contacts-empty">
                                <Bot size={28} className="wk-contacts-empty-icon" />
                                <div className="wk-contacts-empty-text">还没有添加 AI，去全部联系人里看看</div>
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
        const { expandedSection, indexList, indexItemMap, spaceMembers } = this.state
        const isExpanded = expandedSection === 'allContacts'
        const myUID = WKApp.loginInfo.uid || ""
        const totalCount = spaceMembers.filter(m => m.uid !== myUID).length

        return (
            <div className="wk-contacts-accordion">
                {this.renderAccordionHeader('allContacts', <Users size={16} />, '全部联系人', totalCount)}
                {isExpanded && (
                    <>
                        {this.renderFilterChips()}
                        <div className="wk-contacts-accordion-body wk-contacts-all-list" ref={this.virtualListRef}>
                            {totalCount === 0 ? (
                                <div className="wk-contacts-empty">
                                    <Users size={28} className="wk-contacts-empty-icon" />
                                    <div className="wk-contacts-empty-text">当前 Space 还没有成员</div>
                                </div>
                            ) : this.renderContactListWithLetters()}
                        </div>
                    </>
                )}
            </div>
        )
    }

    renderContactListWithLetters() {
        const { indexList, indexItemMap } = this.state

        // 如果虚拟列表已初始化且有足够多的项目，使用虚拟滚动
        if (this.virtualizer && this.flatItems.length > 100) {
            return this.renderVirtualList()
        }

        // 少量项目直接渲染
        return indexList.map(letter => {
            const items = indexItemMap.get(letter)
            if (!items || items.length === 0) return null
            return (
                <div key={letter}>
                    <div className="wk-contacts-letter-header">{letter}</div>
                    {items.map(item => this.renderContactItem(item))}
                </div>
            )
        })
    }

    renderVirtualList() {
        if (!this.virtualizer) return null
        const virtualItems = this.virtualizer.getVirtualItems()
        const totalSize = this.virtualizer.getTotalSize()

        return (
            <div style={{ height: totalSize, width: '100%', position: 'relative' }}>
                {virtualItems.map(virtualItem => {
                    const item = this.flatItems[virtualItem.index]
                    if (!item) return null

                    // 检查是否是该字母分组的第一个项目
                    let showLetter = false
                    let letter = ''
                    if (virtualItem.index === 0) {
                        showLetter = true
                    } else {
                        const prev = this.flatItems[virtualItem.index - 1]
                        const currLetter = this.getItemLetter(item)
                        const prevLetter = this.getItemLetter(prev)
                        if (currLetter !== prevLetter) {
                            showLetter = true
                        }
                        letter = currLetter
                    }
                    if (virtualItem.index === 0) {
                        letter = this.getItemLetter(item)
                    }

                    return (
                        <div
                            key={item.uid}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualItem.start}px)`,
                            }}
                        >
                            {showLetter && <div className="wk-contacts-letter-header">{letter}</div>}
                            {this.renderContactItem(item)}
                        </div>
                    )
                })}
            </div>
        )
    }

    private getItemLetter(item: Contacts): string {
        let name = (item.name || '').replace(/\*\*/g, '')
        if (item.remark && item.remark !== "") name = item.remark
        const py = getPinyin(toSimplized(name)).toUpperCase()
        let letter = (py && py[0]) || '#'
        if (!/[A-Z]/.test(letter)) letter = '#'
        return letter
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
                <div className="wk-contacts-section-item-name">
                    {name}
                    {item.robot === true && <AiBadge />}
                    {(item as any)._spaceRole && (item as any)._spaceRole <= 2 && (
                        <span className={`wk-contacts-role-badge wk-contacts-role-badge--${(item as any)._spaceRole === 1 ? 'owner' : 'admin'}`}>
                            {SpaceRoleLabels[(item as any)._spaceRole] || ''}
                        </span>
                    )}
                </div>
            </div>
        )
    }

    render() {
        const { isSearching } = this.state

        return <WKBase onContext={(baseCtx) => {
            this.baseContext = baseCtx
        }}>
            <ErrorBoundary moduleName="通讯录">
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
                        title: "查看资料", onClick: () => {
                            const { selectedItem } = this.state
                            this.baseContext.showUserInfo(selectedItem?.uid || "")
                        }
                    }, {
                        title: "分享给朋友...", onClick: () => {
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
                                    Toast.success("分享成功！")
                                }
                            }, "分享名片")
                        }
                    }]} />

                    <BotDetailModal
                        uid={this.state.botDetailUid || ""}
                        visible={this.state.botDetailVisible}
                        onClose={() => this.setState({ botDetailVisible: false })}
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
