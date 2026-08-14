import React from "react";
import { Mail } from "lucide-react";
import { ChatPage, i18n, Menus, t as translate, WKApp } from "@octo/base";
import type { IModule } from "@octo/base";
import MailSidebar from "./features/MailSidebar";
import MailRecordsFeature from "./features/MailRecordsFeature";
import MailAuthorizationPage from "./features/MailAuthorizationPage";
import {
  getMailAuthorizationSessionStorage,
  isMailAuthorizePath,
  MAIL_AUTHORIZE_PATH,
  resolveMailAuthorizeSearch,
} from "./authorizationSession";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import { requestMailWorkspaceSwitch } from "./bridge/mailboxContext";

let initialized = false;
let authorizationInitialSearch = "";
const mailHostShell = () => <ChatPage />;

interface MailAuthorizationRouteParams {
  onSessionExpired?: () => void;
}

function MailMenuIcon({ active }: { active?: boolean }) {
  return (
    <Mail
      size={22}
      strokeWidth={2}
      color={active ? "var(--wk-brand-primary)" : "currentColor"}
    />
  );
}

export default class MailModule implements IModule {
  id(): string {
    return "MailModule";
  }

  init(): void {
    if (initialized) return;
    initialized = true;

    i18n.registerNamespace("mail", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    if (
      typeof window !== "undefined" &&
      isMailAuthorizePath(window.location.pathname)
    ) {
      authorizationInitialSearch = resolveMailAuthorizeSearch(
        window.location.pathname,
        window.location.search,
        getMailAuthorizationSessionStorage()
      );
    }

    WKApp.route.register("/mail", () => <MailSidebar />, {
      hostShell: mailHostShell,
    });
    const renderAuthorization = (params?: MailAuthorizationRouteParams) => (
      <MailAuthorizationPage
        initialSearch={authorizationInitialSearch}
        onSessionExpired={params?.onSessionExpired}
      />
    );
    WKApp.route.register(MAIL_AUTHORIZE_PATH, renderAuthorization);
    WKApp.route.register(`${MAIL_AUTHORIZE_PATH}/`, renderAuthorization);
    WKApp.menus.register(
      "mail",
      () => {
        const menu = new Menus(
          "mail",
          "/mail",
          translate("mail.menu.title"),
          <MailMenuIcon />,
          <MailMenuIcon active />
        );
        menu.onPress = () => {
          requestMailWorkspaceSwitch(() => {
            WKApp.routeLeft.popToRoot();
            WKApp.routeRight.replaceToRoot(
              <MailRecordsFeature initialRole="inbox" />
            );
            WKApp.mittBus.emit("mail-open-inbox" as never);
          });
        };
        return menu;
      },
      4005
    );
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    initialized = false;
  });
}
