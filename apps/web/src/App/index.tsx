import { ChatPage, EndpointCategory, WKApp, Menus } from '@tsdaodao/base';
import { ContactsList } from '@tsdaodao/contacts';
import React from 'react';
import './index.css';
import AppLayout from '../Layout';
import { WKSDK } from 'wukongimjssdk';
function App() {
  registerMenus()
  return (
    <AppLayout />
  );
}

function registerMenus() {

  WKSDK.shared().conversationManager.addConversationListener(() => {
    WKApp.menus.refresh()
  })

  WKApp.endpointManager.setMethod("menus.friendapply.change", () => {
    WKApp.menus.refresh()
  }, {
    category: EndpointCategory.friendApplyDataChange,
  })

  WKApp.menus.register("chat", (context) => {
    const m = new Menus("chat", "/", "会话",
      <img alt='会话' src={require("./assets/HomeTab.svg").default}></img>,
      <img alt='会话' src={require("./assets/HomeTabSelected.svg").default}></img>)
    let badge = 0
    for (const conversation of WKSDK.shared().conversationManager.conversations) {
      if (!conversation.channelInfo?.mute) {
        badge += conversation.unread
      }
    }
    m.badge = badge
    return m
  },1000)

  WKApp.menus.register("contacts", (param) => {
    const m = new Menus("contacts", "/contacts", "通讯录",
      <img alt='通讯录' src={require("./assets/ContactsTab.svg").default}></img>,
      <img alt='通讯录' src={require("./assets/ContactsTabSelected.svg").default}></img>)

    m.badge = WKApp.shared.getFriendApplysUnreadCount()
    return m
  },2000)


  WKApp.route.register("/", () => {
    return <ChatPage></ChatPage>
  })

  WKApp.route.register("/contacts", () => {
    return <ContactsList></ContactsList>
  })
}

export default App;

