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

export class ContactsState {
    indexList: string[] = []
    indexItemMap: Map<string, Contacts[]> = new Map()
    keyword?: string
    selectedItem?: Contacts // 被选中的联系人
    currentSpace?: Space
    spaceMembers: SpaceMember[] = []
    botDetailUid?: string // Bot 详情弹窗
    botDetailVisible: boolean = false
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
        const { keyword } = this.state
        const filtered = members.filter((m) => {
            if (!keyword || keyword === "") return true
            return m.name.indexOf(keyword) !== -1
        })
        const contacts: Contacts[] = filtered.map((m) => {
            const c = new Contacts()
            c.uid = m.uid
            c.name = m.name
            c.avatar = m.avatar
            c.follow = 1
            c.robot = false
            ;(c as any)._spaceRole = m.role
            return c
        })
        this.buildIndex(contacts)
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
        const { indexItemMap } = this.state
        const { canSelect } = this.props
        const items = indexItemMap.get(indexName)

        return <div key={indexName} className="wk-contacts-section">
            <div className="wk-contacts-section-list">
                {
                    items?.map((item, i) => {
                        let name = item.name
                        if (item.remark && item.remark !== "") {
                            name = item.remark
                        }
                        return <div key={item.uid} className={classnames("wk-contacts-section-item", WKApp.shared.openChannel?.channelType === ChannelTypePerson && WKApp.shared.openChannel?.channelID === item.uid ? "wk-contacts-section-item-selected" : undefined)} onClick={() => {
                            if (item.robot) {
                                // Bot: 弹出详情弹窗
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
                                {i === 0 ? indexName : ""}
                            </div>
                            <div className="wk-contacts-section-item-avatar">
                                <WKAvatar channel={new Channel(item.uid, ChannelTypePerson)}></WKAvatar>
                            </div>
                            <div className="wk-contacts-section-item-name">
                                {name}
                                {item.robot && <AiBadge />}
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
    render() {
        const { indexList } = this.state
        return <WKBase onContext={(baseCtx) => {
            this.baseContext = baseCtx
        }}>
            <div className="wk-contacts">
                <WKNavMainHeader title={this.state.currentSpace ? `${this.state.currentSpace.name} - 成员` : "联系人"}></WKNavMainHeader>
                <div className="wk-contacts-content">
                    <div className="wk-contacts-content-header">
                        <Search placeholder="搜索" onChange={(v) => {
                            this.setState({
                                keyword: v
                            }, () => {
                                this.rebuildIndex()
                            })
                        }}></Search>
                    </div>
                    {!this.state.currentSpace && <div className="wk-contacts-content-fnc">
                        {
                            WKApp.endpoints.contactsHeaders().map((view, i) => {
                                return <div key={i}>{view}</div>
                            })
                        }
                    </div>}
                    <div className="wk-contacts-content-contacts">
                        {
                            indexList.map((indexName) => {
                                return this.sectionUI(indexName)
                            })
                        }
                    </div>
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