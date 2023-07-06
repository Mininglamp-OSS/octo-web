import { EndpointCategory, IconListItem, IModule, WKApp, ThemeMode } from "@tsdaodao/base"
import React from "react"
import Blacklist from "./Blacklist"
import { FriendAdd } from "./FriendAdd"
import GroupSave from "./GroupSave"
import { NewFriend } from "./NewFriend"
import { ContactsListManager } from "./Service/ContactsListManager"


export default class ContactsModule implements IModule {

    id(): string {
        return "ContactsModule"
    }
    init(): void {
        console.log("【ContactsModule】初始化")


        WKApp.endpointManager.setMethod("contacts.friendapply.change", () => {
           ContactsListManager.shared.refreshList()
        }, {
            category: EndpointCategory.friendApplyDataChange,
        })

        WKApp.endpoints.registerContactsHeader("friends.new", (param: any) => {
            return <IconListItem badge={WKApp.shared.getFriendApplysUnreadCount()} title="新朋友" icon={require("./assets/friend_new.png").default} backgroudColor={"var(--wk-color-secondary)"} onClick={() => {
                WKApp.routeLeft.push(<NewFriend></NewFriend>)
            }} ></IconListItem>
        })

        WKApp.endpoints.registerContactsHeader("groups.save", (param: any) => {
            return <IconListItem title="保存的群" icon={require("./assets/icon_group_save.png").default} backgroudColor={"var(--wk-color-secondary)"} onClick={() => {
                WKApp.routeLeft.push(<GroupSave></GroupSave>)
            }}></IconListItem>
        })

        WKApp.endpoints.registerContactsHeader("contacts.blacklist", (param: any) => {
            return <IconListItem title="黑名单" icon={require("./assets/blacklist.png").default} backgroudColor={"var(--wk-color-secondary)"} onClick={() => {
                WKApp.routeLeft.push(<Blacklist></Blacklist>)
            }}></IconListItem>
        })

        WKApp.shared.chatMenusRegister("chatmenus.addfriend",(param)=>{
            const isDark = WKApp.config.themeMode === ThemeMode.dark 
            return {
                title: "添加朋友",
                icon: require(`${isDark?"./assets/popmenus_friendadd_dark.png":"./assets/popmenus_friendadd.png"}`).default,
                onClick:()=>{
                    WKApp.routeLeft.push(<FriendAdd onBack={()=>{
                        WKApp.routeLeft.pop()
                    }}></FriendAdd>)
                }
            }
        })

    }
}