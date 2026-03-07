import React from "react";
import { Component } from "react";
import { Contacts, ContactsChangeListener, ContextMenus, ContextMenusContext, WKApp, WKBase, WKBaseContext, WKNavMainHeader, Search, UserRelation } from "@octo/base"
import "./index.css"
import { toSimplized } from "@octo/base";
import { getPinyin } from "@octo/base";
import classnames from "classnames";
import { Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson, WKSDK,ChannelInfoListener,ChannelInfo } from "wukongimjssdk";
import { ContactsListManager } from "../Service/ContactsListManager";
import { Card } from "@octo/base/src/Messages/Card";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import AiBadge from "@octo/base/src/Components/AiBadge";
import BotDetailModal from "@octo/base/src/Components/BotDetailModal";
import { Space, SpaceMember, SpaceService } from "@octo/base/src/Service/SpaceService";

const SpaceRoleLabels: Record<number, string> = { 1: '创建者', 2: '管理员', 3: '成员' }

type ContactsView = 'menu' | 'members' | 'bots' | 'groups'

export class ContactsState {
    indexList: string[] = []
    indexItemMap: Map<string, Contacts[]> = new Map()
    keyword?: string
    selectedItem?: Contacts // 被选中的联系人
    currentSpace?: Space
    spaceMembers: SpaceMember[] = []
    botDetailUid?: string // Bot 详情弹窗
    botDetailVisible: boolean = false
    botGroupCollapsed: boolean = false
    currentView: ContactsView = 'menu'
}

export default class ContactsList extends Component<any, ContactsState> {
    contactsChangeListener!: ContactsChangeListener
    channelInfoListener!: ChannelInfoListener
    contextMenusContext!: ContextMenusContext
    baseContext!: WKBaseContext
    private spaceChangedHandler!: (space: any) => void
    constructor(props: any) {
        super(props)

        this.state = {
            indexList: [],
            indexItemMap: new Map(),
            spaceMembers: [],
        }
    }
    componentDidMount() {

        this.contactsChangeListener = () => {
            if (!this.state.currentSpace) {
                this.rebuildIndex()
            }
        }

        this.channelInfoListener = (channelInfo:ChannelInfo)=>{
            if(channelInfo.channel.channelType !== ChannelTypePerson) {
                return
            }
            //是否包含
            let exist = false
            WKApp.dataSource.contactsList.forEach((v)=>{
                if(v.uid === channelInfo.channel.channelID) {
                    exist = true
                    v.name = channelInfo.title
                    v.remark = channelInfo?.orgData?.remark
                    return
                }
            })
            if(exist && !this.state.currentSpace) {
                this.rebuildIndex()
            }
        }

        this.spaceChangedHandler = (space: any) => {
            const sp = space as Space | undefined
            if (sp) {
                this.setState({ currentSpace: sp }, () => {
                    this.loadSpaceMembers(sp.space_id)
                })
            } else {
                this.setState({ currentSpace: undefined, spaceMembers: [] }, () => {
                    this.rebuildIndex()
                })
            }
        }
        WKApp.mittBus.on('space-changed', this.spaceChangedHandler)

        WKApp.dataSource.addContactsChangeListener(this.contactsChangeListener)

        // Space 模式：首次加载时自动拉取 Space 成员
        const spaceId = WKApp.shared.currentSpaceId
        if (spaceId && !this.state.currentSpace) {
            SpaceService.shared.getMySpaces().then((spaces) => {
                const sp = spaces.find((s) => s.space_id === spaceId)
                if (sp) {
                    this.setState({ currentSpace: sp }, () => {
                        this.loadSpaceMembers(sp.space_id)
                    })
                }
            }).catch(() => {})
        }

        this.rebuildIndex()

        WKSDK.shared().channelManager.addListener(this.channelInfoListener)

        ContactsListManager.shared.setRefreshList = () => {
            this.setState({})
        }
    }

    componentWillUnmount() {
        ContactsListManager.shared.setRefreshList = undefined
        WKApp.dataSource.removeContactsChangeListener(this.contactsChangeListener)
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
        WKApp.mittBus.off('space-changed', this.spaceChangedHandler)
    }

    private async loadSpaceMembers(spaceId: string) {
        try {
            const members = await SpaceService.shared.getMembers(spaceId, 1, 10000)
            this.setState({ spaceMembers: members }, () => {
                this.rebuildIndexFromSpaceMembers(members)
            })
        } catch {
            this.setState({ spaceMembers: [] })
        }
    }

    private rebuildIndexFromSpaceMembers(members: SpaceMember[]) {
        const { keyword, currentView } = this.state

        // 按 view 过滤
        let viewFiltered = members
        if (currentView === 'members') {
            viewFiltered = members.filter(m => m.robot !== 1)
        } else if (currentView === 'bots') {
            viewFiltered = members.filter(m => m.robot === 1)
        }

        const filtered = viewFiltered.filter((m) => {
            if (!keyword || keyword === "") return true
            return m.name.indexOf(keyword) !== -1
        })

        // 分离 Bot 和普通成员
        const bots: Contacts[] = []
        const users: Contacts[] = []
        for (const m of filtered) {
            const c = new Contacts()
            c.uid = m.uid
            c.name = m.name
            c.avatar = m.avatar
            c.follow = 1
            c.robot = m.robot === 1
            ;(c as any)._spaceRole = m.role
            if (c.robot) {
                bots.push(c)
            } else {
                users.push(c)
            }
        }

        // Bot 排序：BotFather 固定第一，其余按名称
        bots.sort((a, b) => {
            if (a.uid === 'botfather') return -1
            if (b.uid === 'botfather') return 1
            return a.name.localeCompare(b.name)
        })

        // 构建索引：先 Bot 分组，再成员字母分组
        const indexItemMap = new Map<string, Contacts[]>()
        const indexList: string[] = []

        if (bots.length > 0) {
            indexItemMap.set('🤖 Bot', bots)
            indexList.push('🤖 Bot')
        }

        // 成员按字母分组
        for (const item of users) {
            let name = item.name
            if (item.remark && item.remark !== "") name = item.remark
            let pinyinNick = getPinyin(toSimplized(name)).toUpperCase()
            let indexName = !pinyinNick || /[^a-z]/i.test(pinyinNick[0]) ? "#" : pinyinNick[0]
            let existItems = indexItemMap.get(indexName)
            if (!existItems) {
                existItems = []
                indexList.push(indexName)
            }
            existItems.push(item)
            indexItemMap.set(indexName, existItems)
        }

        // 字母排序（Bot 分组已在最前）
        const botIdx = indexList.indexOf('🤖 Bot')
        const rest = indexList.filter(i => i !== '🤖 Bot').sort((a, b) => {
            if (a === "#") return 1
            if (b === "#") return -1
            return a.localeCompare(b)
        })
        const sorted = botIdx >= 0 ? ['🤖 Bot', ...rest] : rest

        this.setState({ indexList: sorted, indexItemMap })
    }

    rebuildIndex() {
        if (this.state.currentSpace && this.state.spaceMembers.length > 0) {
            this.rebuildIndexFromSpaceMembers(this.state.spaceMembers)
        } else if (!this.state.currentSpace) {
            this.buildIndex(this.contactsList())
        }
    }

    contactsList() {
        const { keyword } = this.state
        return WKApp.dataSource.contactsList.filter((v) => {
            if (v.status === UserRelation.blacklist) {
                return false
            }
            if (v.follow !== 1) {
                return false
            }
            if (!keyword || keyword === "") {
                return true
            }

            if (v.remark && v.remark !== "") {
                if (v.remark.indexOf(keyword) !== -1) {
                    return true
                }
            }

            return v.name.indexOf(keyword) !== -1
        })
    }

    buildIndex(contacts: Contacts[]) {
        const indexItemMap = new Map<string, Contacts[]>()
        let indexList = []
        for (const item of contacts) {
            let name = item.name
            if (item.remark && item.remark !== "") {
                name = item.remark
            }

            let pinyinNick = getPinyin(toSimplized(name)).toUpperCase();
            let indexName = !pinyinNick || /[^a-z]/i.test(pinyinNick[0]) ? "#" : pinyinNick[0];

            let existItems = indexItemMap.get(indexName)
            if (!existItems) {
                existItems = []
                indexList.push(indexName)
            }
            existItems.push(item)
            indexItemMap.set(indexName, existItems)
        }
        indexList = indexList.sort((a, b) => {
            if (a === "#") {
                return -1
            }
            if (b === "#") {
                return 1
            }
            return a.localeCompare(b)
        })
        this.setState({
            indexList: indexList,
            indexItemMap: indexItemMap,
        })
    }

    _handleContextMenu(item: Contacts, event: React.MouseEvent) {
        this.contextMenusContext.show(event)
        this.setState({
            selectedItem: item,
        })
    }

    sectionUI(indexName: string) {
        const { indexItemMap, botGroupCollapsed } = this.state
        const { canSelect } = this.props
        const items = indexItemMap.get(indexName)
        const isBotGroup = indexName === '🤖 Bot'

        return <div key={indexName} className="wk-contacts-section">
            {isBotGroup && (
                <div className="wk-contacts-section-bot-header" onClick={() => this.setState({ botGroupCollapsed: !botGroupCollapsed })} style={{
                    display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', userSelect: 'none',
                    fontSize: 13, color: '#888', fontWeight: 500,
                }}>
                    <span style={{ marginRight: 6, fontSize: 10, transition: 'transform 0.2s', transform: botGroupCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', display: 'inline-block' }}>▶</span>
                    🤖 Bot ({items?.length || 0})
                </div>
            )}
            <div className="wk-contacts-section-list" style={isBotGroup && botGroupCollapsed ? { display: 'none' } : undefined}>
                {
                    items?.map((item, i) => {
                        let name = item.name
                        if (item.remark && item.remark !== "") {
                            name = item.remark
                        }
                        return <div key={item.uid} className={classnames("wk-contacts-section-item", WKApp.shared.openChannel?.channelType === ChannelTypePerson && WKApp.shared.openChannel?.channelID === item.uid ? "wk-contacts-section-item-selected" : undefined)} onClick={() => {
                            if (item.robot && item.uid !== 'botfather') {
                                // 非系统 Bot: 弹出详情弹窗
                                this.setState({ botDetailUid: item.uid, botDetailVisible: true })
                                return
                            }
                            const spaceId = WKApp.shared.currentSpaceId
                            const channelId = spaceId ? `s${spaceId}_${item.uid}` : item.uid
                            const channel = new Channel(channelId, ChannelTypePerson)
                            WKApp.endpoints.showConversation(channel)
                            this.setState({})
                        }} onContextMenu={(e) => {
                            this._handleContextMenu(item, e)
                        }}>
                            <div className="wk-contacts-section-item-index">
                                {i === 0 && !isBotGroup ? indexName : ""}
                            </div>
                            <div className="wk-contacts-section-item-avatar">
                                <WKAvatar channel={new Channel(item.uid, ChannelTypePerson)}></WKAvatar>
                            </div>
                            <div className="wk-contacts-section-item-name">
                                {name}
                                {item.robot === 1 && <AiBadge />}
                                {(item as any)._spaceRole && (item as any)._spaceRole <= 2 && (
                                    <span className="wk-contacts-role-badge" style={{
                                        marginLeft: 6,
                                        fontSize: 11,
                                        padding: '1px 6px',
                                        borderRadius: 3,
                                        backgroundColor: (item as any)._spaceRole === 1 ? 'var(--wk-color-theme, #6366F1)' : '#f0ad4e',
                                        color: '#fff',
                                    }}>
                                        {SpaceRoleLabels[(item as any)._spaceRole] || ''}
                                    </span>
                                )}
                            </div>
                        </div>
                    })
                }
            </div>
        </div>

    }
    renderMenuView() {
        const space = this.state.currentSpace
        const memberCount = this.state.spaceMembers.filter(m => m.robot !== 1).length
        const botCount = this.state.spaceMembers.filter(m => m.robot === 1).length

        return (
            <div className="wk-contacts-menu">
                {space && (
                    <div className="wk-contacts-menu-header">
                        <div className="wk-contacts-menu-space-icon" style={{
                            backgroundColor: ['#667eea','#764ba2','#f093fb','#4facfe','#43e97b','#fa709a'][space.name.charCodeAt(0) % 6],
                        }}>
                            {space.name.charAt(0)}
                        </div>
                        <span className="wk-contacts-menu-space-name">{space.name}</span>
                    </div>
                )}
                <div className="wk-contacts-menu-list">
                    <div className="wk-contacts-menu-item" onClick={() => {
                        this.setState({ currentView: 'members' }, () => this.rebuildIndex())
                    }}>
                        <span className="wk-contacts-menu-item-icon">👥</span>
                        <span className="wk-contacts-menu-item-label">组织内联系人</span>
                        <span className="wk-contacts-menu-item-count">{memberCount}</span>
                        <span className="wk-contacts-menu-item-arrow">›</span>
                    </div>
                    <div className="wk-contacts-menu-item" onClick={() => {
                        this.setState({ currentView: 'bots' }, () => this.rebuildIndex())
                    }}>
                        <span className="wk-contacts-menu-item-icon">🤖</span>
                        <span className="wk-contacts-menu-item-label">Bot</span>
                        <span className="wk-contacts-menu-item-count">{botCount}</span>
                        <span className="wk-contacts-menu-item-arrow">›</span>
                    </div>
                    <div className="wk-contacts-menu-item" onClick={() => {
                        this.setState({ currentView: 'groups' })
                    }}>
                        <span className="wk-contacts-menu-item-icon">👥</span>
                        <span className="wk-contacts-menu-item-label">我的群组</span>
                        <span className="wk-contacts-menu-item-arrow">›</span>
                    </div>
                </div>
            </div>
        )
    }

    renderListView() {
        const { indexList, currentView } = this.state
        const viewTitle = currentView === 'members' ? '联系人' : currentView === 'bots' ? 'Bot' : '我的群组'

        return (
            <>
                <div className="wk-contacts-list-back" onClick={() => this.setState({ currentView: 'menu', keyword: undefined })}>
                    <span>‹ 返回</span>
                </div>
                <div className="wk-contacts-content-header">
                    <Search placeholder={`搜索${viewTitle}`} onChange={(v) => {
                        this.setState({ keyword: v }, () => this.rebuildIndex())
                    }}></Search>
                </div>
                <div className="wk-contacts-content-contacts">
                    {indexList.map((indexName) => this.sectionUI(indexName))}
                </div>
            </>
        )
    }

    render() {
        const { currentView, currentSpace } = this.state
        const isMenuView = currentView === 'menu' && !!currentSpace

        return <WKBase onContext={(baseCtx) => {
            this.baseContext = baseCtx
        }}>
            <div className="wk-contacts">
                <WKNavMainHeader title={
                    isMenuView ? "通讯录" :
                    currentView === 'members' ? '联系人' :
                    currentView === 'bots' ? 'Bot' :
                    currentView === 'groups' ? '我的群组' : '联系人'
                }></WKNavMainHeader>
                <div className="wk-contacts-content">
                    {isMenuView ? this.renderMenuView() : this.renderListView()}
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
                                    card.vercode = selectedItem?.vercode||""
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
            </div>
        </WKBase>
    }
}