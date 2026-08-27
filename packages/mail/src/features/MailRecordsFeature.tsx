import React, { useCallback, useEffect, useState } from "react";
import { useI18n, WKApp } from "@octo/base";
import useMailWorkspace from "../bridge/useMailWorkspace";
import { findMailbox, inferMailboxRole } from "../bridge/mailbox";
import type { MailboxRole } from "../bridge/mailbox";
import type {
  ComposeMode,
  Mailbox,
  MessageDetail,
  MessageSummary,
} from "../bridge/types";
import { requestMailWorkspaceSwitch } from "../bridge/mailboxContext";
import MailRecordsView from "../ui/MailRecordsView";
import ComposerFeature from "./ComposerFeature";
import MessageDetailFeature from "./MessageDetailFeature";
import MailReaderEmpty from "./MailReaderEmpty";
import "../ui/MailWorkbench/index.css";

interface MailRecordsFeatureProps {
  initialRole?: MailboxRole;
  initialMailbox?: string;
  initialCompose?: boolean;
  onMailboxChange?: (mailbox: Mailbox) => void;
}

interface ComposerState {
  mode: ComposeMode;
  source?: MessageDetail;
}

export default function MailRecordsFeature({
  initialRole = "inbox",
  initialMailbox,
  initialCompose = false,
  onMailboxChange,
}: MailRecordsFeatureProps) {
  const { t, locale } = useI18n();
  const workspace = useMailWorkspace(t("mail.error.fallback"));
  const [requestedRole, setRequestedRole] = useState<MailboxRole | undefined>(
    initialRole
  );
  const [requestedMailbox, setRequestedMailbox] = useState(initialMailbox);
  const [composer, setComposer] = useState<ComposerState | null>(
    initialCompose ? { mode: "new" } : null
  );
  const [removedMessageId, setRemovedMessageId] = useState("");

  useEffect(() => {
    setRequestedRole(initialRole);
    setRequestedMailbox(initialMailbox);
  }, [initialMailbox, initialRole]);

  useEffect(() => {
    setRemovedMessageId("");
  }, [workspace.mailboxContextId, workspace.selectedMailbox]);

  const selectTarget = useCallback(
    (role?: MailboxRole, name?: string) => {
      setRequestedRole(role);
      setRequestedMailbox(name);
      const mailbox = findMailbox(workspace.mailboxes, role, name);
      if (mailbox) workspace.selectMailbox(mailbox.name);
    },
    [workspace.mailboxes, workspace.selectMailbox]
  );

  useEffect(() => {
    const mailbox = findMailbox(
      workspace.mailboxes,
      requestedRole,
      requestedMailbox
    );
    if (mailbox && mailbox.name !== workspace.selectedMailbox) {
      workspace.selectMailbox(mailbox.name);
    }
  }, [
    requestedMailbox,
    requestedRole,
    workspace.mailboxes,
    workspace.selectedMailbox,
    workspace.selectMailbox,
  ]);

  useEffect(() => {
    const mailbox = workspace.mailboxes.find(
      (item) => item.name === workspace.selectedMailbox
    );
    if (mailbox) onMailboxChange?.(mailbox);
  }, [onMailboxChange, workspace.mailboxes, workspace.selectedMailbox]);

  useEffect(() => {
    const openSent = () => selectTarget("sent");
    const openDrafts = () => selectTarget("drafts");
    WKApp.mittBus.on("mail-open-sent" as never, openSent);
    WKApp.mittBus.on("mail-open-drafts" as never, openDrafts);
    return () => {
      WKApp.mittBus.off("mail-open-sent" as never, openSent);
      WKApp.mittBus.off("mail-open-drafts" as never, openDrafts);
    };
  }, [selectTarget]);

  useEffect(() => {
    const openCompose = () =>
      requestMailWorkspaceSwitch(() => setComposer({ mode: "new" }));
    WKApp.mittBus.on("mail-compose" as never, openCompose);
    return () => WKApp.mittBus.off("mail-compose" as never, openCompose);
  }, []);

  useEffect(() => {
    if (
      removedMessageId &&
      !workspace.messages.some((message) => message.id === removedMessageId)
    ) {
      setRemovedMessageId("");
    }
    const first = workspace.messages.find(
      (message) => message.id !== removedMessageId
    );
    if (!first) return;
    if (!workspace.selectedMessageId) {
      workspace.selectMessage(first.id);
    }
  }, [
    workspace.messages,
    removedMessageId,
    workspace.selectMessage,
    workspace.selectedMessageId,
  ]);

  const openMessage = (message: MessageSummary) => {
    if (!workspace.mailboxContextId) return;
    workspace.selectMessage(message.id);
    workspace.markMessageRead(message);
  };

  const selectedMessageInList = workspace.messages.find(
    (message) =>
      message.id === workspace.selectedMessageId &&
      message.id !== removedMessageId
  );
  const [selectedMessageCache, setSelectedMessageCache] =
    useState<MessageSummary | null>(null);
  useEffect(() => {
    if (selectedMessageInList) {
      setSelectedMessageCache(selectedMessageInList);
    } else if (!workspace.selectedMessageId) {
      setSelectedMessageCache(null);
    }
  }, [selectedMessageInList, workspace.selectedMessageId]);
  const selectedMessage =
    selectedMessageInList ||
    (selectedMessageCache?.id === workspace.selectedMessageId
      ? selectedMessageCache
      : undefined);
  const selectedMailbox = workspace.mailboxes.find(
    (mailbox) => mailbox.name === workspace.selectedMailbox
  );
  const selectedMailboxRole = selectedMailbox
    ? inferMailboxRole(selectedMailbox)
    : undefined;

  const openComposer = (mode: ComposeMode, source?: MessageDetail) => {
    if (!workspace.mailboxContextId) return;
    requestMailWorkspaceSwitch(() => setComposer({ mode, source }));
  };

  return (
    <main className="octo-mail-workbench">
      <section className="octo-mail-workbench__list">
        <MailRecordsView
          {...workspace}
          locale={locale}
          t={t}
          onRefresh={workspace.reload}
          onSearch={workspace.setSearch}
          onUnreadOnlyChange={workspace.setUnreadOnly}
          onSelectMessage={openMessage}
          onToggleStar={workspace.toggleStar}
          onPage={workspace.setPage}
        />
      </section>
      <section className="octo-mail-workbench__reader">
        {selectedMessage && workspace.mailboxContextId ? (
          <MessageDetailFeature
            key={`${workspace.mailboxContextId}:${selectedMessage.id}`}
            embedded
            mailboxContextId={workspace.mailboxContextId}
            mailboxAddress={workspace.identity?.address || ""}
            messageId={selectedMessage.id}
            initialMessage={selectedMessage}
            mailboxRole={selectedMailboxRole}
            onCompose={openComposer}
            onDeleted={() => {
              setRemovedMessageId(selectedMessage.id);
              const nextMessage = workspace.messages.find(
                (message) => message.id !== selectedMessage.id
              );
              workspace.selectMessage(nextMessage?.id || "");
              workspace.reload();
            }}
            onRestoredFromJunk={() => {
              setRemovedMessageId(selectedMessage.id);
              const nextMessage = workspace.messages.find(
                (message) => message.id !== selectedMessage.id
              );
              workspace.selectMessage(nextMessage?.id || "");
              workspace.reload();
            }}
            onDraftSent={() => {
              workspace.selectMessage("");
              selectTarget("sent");
              workspace.reload();
            }}
          />
        ) : (
          <MailReaderEmpty />
        )}
      </section>
      {composer && workspace.mailboxContextId ? (
        <div className="octo-mail-composer-layer" role="presentation">
          <div
            className="octo-mail-composer-dialog"
            role="dialog"
            aria-modal="true"
          >
            <ComposerFeature
              key={`${workspace.mailboxContextId}:${composer.mode}:${
                composer.source?.id ?? "new"
              }`}
              mode={composer.mode}
              mailboxContextId={workspace.mailboxContextId}
              mailboxAddress={workspace.identity?.address || ""}
              source={composer.source}
              onClose={() => setComposer(null)}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
