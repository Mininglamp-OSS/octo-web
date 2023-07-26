import React from "react";
import { Component } from "react";
import { Contacts, ContactsChangeListener, ContextMenus, ContextMenusContext, WKApp, WKBase, WKBaseContext, WKNavMainHeader, Search, UserRelation } from "@tsdaodao/base"
import "./index.css"
import { toSimplized } from "@tsdaodao/base";
import { getPinyin } from "@tsdaodao/base";
import classnames from "classnames";
import { Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk";
import { ContactsListManager } from "../Service/ContactsListManager";
import { Card } from "@tsdaodao/base/src/Messages/Card";




export class ContactsState {
    indexList: string[] = []
    indexItemMap: Map<string, Contacts[]> = new Map()
    keyword?: string
    selectedItem?: Contacts // 被选中的联系人
}

export default class ContactsList extends Component<any, ContactsState> {
    contactsChangeListener!: ContactsChangeListener
    contextMenusContext!: ContextMenusContext
    baseContext!: WKBaseContext
    constructor(props: any) {
        super(props)

        this.state = {
            indexList: [],
            indexItemMap: new Map()
        }
    }
    componentDidMount() {

        this.contactsChangeListener = () => {
            this.rebuildIndex()
        }

        WKApp.dataSource.addContactsChangeListener(this.contactsChangeListener)

        this.rebuildIndex()

        ContactsListManager.shared.setRefreshList = () => {
            this.setState({})
        }
    }

    rebuildIndex() {
        console.log("rebuildIndex---->")
        this.buildIndex(this.contactsList())
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

    componentWillUnmount() {

        WKApp.dataSource.removeContactsChangeListener(this.contactsChangeListener)
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
                            const channel = new Channel(item.uid, ChannelTypePerson)
                            WKApp.endpoints.showConversation(channel)
                            this.setState({})
                        }} onContextMenu={(e) => {
                            this._handleContextMenu(item, e)
                        }}>
                            <div className="wk-contacts-section-item-index">
                                {i === 0 ? indexName : ""}
                            </div>
                            <div className="wk-contacts-section-item-avatar">
                                <img src={item.avatar}></img>
                            </div>
                            <div className="wk-contacts-section-item-name">
                                {name}
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
                <WKNavMainHeader title="联系人"></WKNavMainHeader>
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
                    <div className="wk-contacts-content-fnc">
                        {
                            WKApp.endpoints.contactsHeaders().map((view, i) => {
                                return <div key={i}>{view}</div>
                            })
                        }
                    </div>
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
            </div>
        </WKBase>
    }
}