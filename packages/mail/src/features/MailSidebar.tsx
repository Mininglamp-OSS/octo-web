import React, { useCallback, useEffect, useState } from "react";
import { useI18n, WKApp } from "@octo/base";
import useMailNavigation from "../bridge/useMailNavigation";
import { findMailbox, inferMailboxRole } from "../bridge/mailbox";
import type { Mailbox } from "../bridge/types";
import { shouldHandleMailSpaceChange } from "../bridge/mailNavigation";
import { requestMailWorkspaceSwitch } from "../bridge/mailboxContext";
import MailSidebarView from "../ui/MailSidebarView";
import MailRecordsFeature from "./MailRecordsFeature";
import MailAddressManagementFeature from "./MailAddressManagementFeature";

export default function MailSidebar() {
  const { t } = useI18n();
  const navigation = useMailNavigation(t("mail.error.fallback"));
  const [selectedMailbox, setSelectedMailbox] = useState("");
  const [addressManagementActive, setAddressManagementActive] = useState(false);
  const syncSelectedMailbox = useCallback((mailbox: Mailbox) => {
    setSelectedMailbox(mailbox.name);
    setAddressManagementActive(false);
  }, []);

  useEffect(() => {
    const setPreferredWidth = (active: boolean) => {
      window.dispatchEvent(
        new CustomEvent("wk:layout-left-width", {
          detail: { width: active ? 250 : null },
        })
      );
    };
    setPreferredWidth(true);
    const handleMenuActivated = (payload: { menuId?: string }) => {
      setPreferredWidth(payload?.menuId === "mail");
    };
    WKApp.mittBus.on("wk:nav-menu-activated", handleMenuActivated);
    WKApp.mittBus.on("wk:active-menu-changed", handleMenuActivated);
    return () => {
      WKApp.mittBus.off("wk:nav-menu-activated", handleMenuActivated);
      WKApp.mittBus.off("wk:active-menu-changed", handleMenuActivated);
      setPreferredWidth(false);
    };
  }, []);

  useEffect(() => {
    WKApp.routeRight.replaceToRoot(
      <MailRecordsFeature
        initialRole="inbox"
        onMailboxChange={syncSelectedMailbox}
      />
    );
  }, [syncSelectedMailbox]);

  useEffect(() => {
    if (selectedMailbox || navigation.mailboxes.length === 0) return;
    const initial =
      findMailbox(navigation.mailboxes, "inbox") || navigation.mailboxes[0];
    if (initial) setSelectedMailbox(initial.name);
  }, [navigation.mailboxes, selectedMailbox]);

  useEffect(() => {
    const openInbox = () => {
      setAddressManagementActive(false);
      const inbox = findMailbox(navigation.mailboxes, "inbox");
      if (inbox) setSelectedMailbox(inbox.name);
    };
    WKApp.mittBus.on("mail-open-inbox" as never, openInbox);
    return () => WKApp.mittBus.off("mail-open-inbox" as never, openInbox);
  }, [navigation.mailboxes]);

  useEffect(() => {
    const handleSpaceChanged = () => {
      if (!shouldHandleMailSpaceChange(WKApp.currentMenuId)) return;
      setSelectedMailbox("");
      setAddressManagementActive(false);
      WKApp.routeRight.replaceToRoot(
        <MailRecordsFeature
          initialRole="inbox"
          onMailboxChange={syncSelectedMailbox}
        />
      );
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", handleSpaceChanged);
  }, [syncSelectedMailbox]);

  const openMailbox = (mailbox: Mailbox) => {
    requestMailWorkspaceSwitch(() => {
      setSelectedMailbox(mailbox.name);
      setAddressManagementActive(false);
      WKApp.routeRight.replaceToRoot(
        <MailRecordsFeature
          key={mailbox.id}
          initialRole={inferMailboxRole(mailbox)}
          initialMailbox={mailbox.name}
          onMailboxChange={syncSelectedMailbox}
        />
      );
    });
  };

  const openAddressManagement = () => {
    requestMailWorkspaceSwitch(() => {
      setAddressManagementActive(true);
      WKApp.routeRight.replaceToRoot(<MailAddressManagementFeature />);
    });
  };

  const switchAgentMailbox = (
    mailbox: (typeof navigation.agentMailboxes)[number]
  ) => {
    navigation.selectAgentMailbox(mailbox, () => {
      setSelectedMailbox("");
      setAddressManagementActive(false);
      WKApp.routeRight.replaceToRoot(
        <MailRecordsFeature
          key={mailbox.id}
          initialRole="inbox"
          onMailboxChange={syncSelectedMailbox}
        />
      );
    });
  };

  const openComposer = () => {
    if (!navigation.selectedAgentMailbox) return;
    if (addressManagementActive) {
      const mailbox = navigation.mailboxes.find(
        (item) => item.name === selectedMailbox
      );
      setAddressManagementActive(false);
      WKApp.routeRight.replaceToRoot(
        <MailRecordsFeature
          key={navigation.selectedAgentMailbox.id}
          initialRole={mailbox ? inferMailboxRole(mailbox) : "inbox"}
          initialMailbox={mailbox?.name}
          initialCompose
          onMailboxChange={syncSelectedMailbox}
        />
      );
      return;
    }
    WKApp.mittBus.emit("mail-compose" as never);
  };

  return (
    <MailSidebarView
      {...navigation}
      selectedMailbox={selectedMailbox}
      addressManagementActive={addressManagementActive}
      t={t}
      onCompose={openComposer}
      onManageAddresses={openAddressManagement}
      onRefresh={navigation.reload}
      onSelectMailbox={openMailbox}
      onSelectAgentMailbox={switchAgentMailbox}
    />
  );
}
