import {
  EndpointCategory,
  IconListItem,
  IModule,
  WKApp,
  ThemeMode,
} from "@tsdaodao/base";
import React from "react";
import ReactDOM from "react-dom";
import Blacklist from "./Blacklist";
import { FriendAdd } from "./FriendAdd";
import GroupSave from "./GroupSave";
import { NewFriend } from "./NewFriend";
import { ContactsListManager } from "./Service/ContactsListManager";
import { OrganizationalGroupNew } from "./Organizational/GroupNew/index";

export default class ContactsModule implements IModule {
  id(): string {
    return "ContactsModule";
  }
  init(): void {
    console.log("【ContactsModule】初始化");

    WKApp.endpointManager.setMethod(
      "contacts.friendapply.change",
      () => {
        ContactsListManager.shared.refreshList();
      },
      {
        category: EndpointCategory.friendApplyDataChange,
      }
    );

    // 获取好友未申请添加数量
    // let unreadCount = 0;
    // if(WKApp.loginInfo.isLogined()){
    //   WKApp.apiClient.get(`/user/reddot/friendApply`).then(res=>{
    //     unreadCount = res.count;
    //     console.log('====', unreadCount)
    //     WKApp.mittBus.emit('friend-applys-unread-count', unreadCount)
    //     WKApp.menus.refresh();
    //   })
    // }

    WKApp.endpoints.registerContactsHeader("friends.new", (param: any) => {
      return (
        <IconListItem
          badge={WKApp.shared.getFriendApplysUnreadCount()}
          title="新朋友"
          icon={require("./assets/friend_new.png")}
          backgroudColor={"var(--wk-color-secondary)"}
          onClick={() => {
            WKApp.routeLeft.push(<NewFriend></NewFriend>);
          }}
        ></IconListItem>
      );
    });

    WKApp.endpoints.registerContactsHeader("groups.save", (param: any) => {
      return (
        <IconListItem
          title="保存的群"
          icon={require("./assets/icon_group_save.png")}
          backgroudColor={"var(--wk-color-secondary)"}
          onClick={() => {
            WKApp.routeLeft.push(<GroupSave></GroupSave>);
          }}
        ></IconListItem>
      );
    });

    WKApp.endpoints.registerContactsHeader(
      "contacts.blacklist",
      (param: any) => {
        return (
          <IconListItem
            title="黑名单"
            icon={require("./assets/blacklist.png")}
            backgroudColor={"var(--wk-color-secondary)"}
            onClick={() => {
              WKApp.routeLeft.push(<Blacklist></Blacklist>);
            }}
          ></IconListItem>
        );
      }
    );

    WKApp.shared.chatMenusRegister("chatmenus.addfriend", (param) => {
      const isDark = WKApp.config.themeMode === ThemeMode.dark;
      return {
        title: "添加朋友",
        icon: require(`${
          isDark
            ? "./assets/popmenus_friendadd_dark.png"
            : "./assets/popmenus_friendadd.png"
        }`),
        onClick: () => {
          WKApp.routeLeft.push(
            <FriendAdd
              onBack={() => {
                WKApp.routeLeft.pop();
              }}
            ></FriendAdd>
          );
        },
      };
    });
    // this.registerOrganizational();

    WKApp.endpoints.registerOrganizationalTool(
      "contacts.organizational.group.add",
      (param) => {
        const channel = param.channel as any;
        const disableSelectList = param.disableSelectList as
          | string[]
          | undefined;
        return (
          <OrganizationalGroupNew
            channel={channel}
            disableSelectList={disableSelectList}
            render={param.render}
          />
        );
      }
    );

    WKApp.endpoints.registerOrganizationalLayer(
      "contacts.organizational.layer",
      (param) => {
        const channel = param.channel as any;
        const disableSelectList = param.disableSelectList as
          | string[]
          | undefined;
        const div = document.createElement("div");
        const ref: any = React.createRef();
        document.body.appendChild(div);

        const remove = () => {
          if (!ref.current) return;
          ReactDOM.unmountComponentAtNode(div);
          document.body.removeChild(div);
        };

        ReactDOM.render(
          <OrganizationalGroupNew
            ref={ref}
            channel={channel}
            disableSelectList={disableSelectList}
            remove={remove}
          />,
          div
        );

        ref.current.onShowModal();
      }
    );
  }
}
