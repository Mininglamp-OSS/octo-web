import {
  EndpointCategory,
  IconListItem,
  IModule,
  WKApp,
  ThemeMode,
} from "@octo/base";
import React from "react";
import ReactDOM from "react-dom";
import Blacklist from "./Blacklist";
import { FriendAdd } from "./FriendAdd";
import GroupSave from "./GroupSave";
import { NewFriend } from "./NewFriend";
import { ContactsListManager } from "./Service/ContactsListManager";
import { OrganizationalGroupNew, OrganizationalGroupNewAction } from "./Organizational/GroupNew/index";

export default class ContactsModule implements IModule {
  id(): string {
    return "ContactsModule";
  }
  init(): void {

    WKApp.endpointManager.setMethod(
      "contacts.friendapply.change",
      () => {
        ContactsListManager.shared.refreshList();
      },
      {
        category: EndpointCategory.friendApplyDataChange,
      }
    );

    WKApp.endpoints.registerContactsHeader("friends.new", (param: any) => {
      return (
        <IconListItem
          badge={ WKApp.shared.getFriendApplysUnreadCount() }
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
        icon: isDark ? new URL("./assets/popmenus_friendadd_dark.png", import.meta.url).href : new URL("./assets/popmenus_friendadd.png", import.meta.url).href,
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

    WKApp.endpoints.registerOrganizationalTool(
      "contacts.organizational.group.add",
      (param) => {
        const channel = param.channel as any;
        return (
          <OrganizationalGroupNew channel={channel} render={param.render} action={OrganizationalGroupNewAction.AddMember} />
        );
      }
    );

    WKApp.endpoints.registerOrganizationalLayer(
      "contacts.organizational.layer",
      (param) => {
        const channel = param.channel as any;
        const defaultCategoryId = param.defaultCategoryId as string | undefined;
        const onSuccess = param.onSuccess as (() => void) | undefined;
        const div = document.createElement("div");
        document.body.appendChild(div);

        const remove = () => {
          ReactDOM.unmountComponentAtNode(div);
          document.body.removeChild(div);
        };

        ReactDOM.render(
          <OrganizationalGroupNew
            channel={channel}
            remove={remove}
            action={OrganizationalGroupNewAction.createGroup}
            autoShow={true}
            defaultCategoryId={defaultCategoryId}
            onSuccess={onSuccess}
          />,
          div
        );
      }
    );
  }
}