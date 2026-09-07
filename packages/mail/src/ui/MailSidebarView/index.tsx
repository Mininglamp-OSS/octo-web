import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Inbox,
  Mail,
  PenLine,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import Loading from "@octo/ui/components/Loading";
import type { AgentMailbox, MailIdentity, Mailbox } from "../../bridge/types";
import { inferMailboxRole } from "../../bridge/mailbox";
import "./index.css";

interface Translator {
  (key: string, options?: { values?: Record<string, unknown> }): string;
}

export interface MailSidebarViewProps {
  mailboxes: Mailbox[];
  agentMailboxes: AgentMailbox[];
  selectedAgentMailbox: AgentMailbox | null;
  identity: MailIdentity | null;
  identityUnavailable: boolean;
  selectedMailbox: string;
  addressManagementActive: boolean;
  loading: boolean;
  error: string;
  t: Translator;
  onCompose: () => void;
  onManageAddresses: () => void;
  onRefresh: () => void;
  onSelectMailbox: (mailbox: Mailbox) => void;
  onSelectAgentMailbox: (mailbox: AgentMailbox) => void;
}

const emptyMailboxNavigation: Mailbox[] = [
  { id: "empty-inbox", name: "Inbox", role: "inbox", total: 0, unread: 0 },
  {
    id: "empty-starred",
    name: "Starred",
    role: "starred",
    total: 0,
    unread: 0,
  },
  { id: "empty-drafts", name: "Drafts", role: "drafts", total: 0, unread: 0 },
  { id: "empty-sent", name: "Sent", role: "sent", total: 0, unread: 0 },
  { id: "empty-trash", name: "Trash", role: "trash", total: 0, unread: 0 },
  { id: "empty-junk", name: "Junk", role: "junk", total: 0, unread: 0 },
];

function mailboxIcon(mailbox: Mailbox) {
  switch (inferMailboxRole(mailbox)) {
    case "inbox":
      return <Inbox size={17} />;
    case "sent":
      return <Send size={17} />;
    case "starred":
      return <Star size={17} />;
    case "drafts":
      return <FileText size={17} />;
    case "trash":
      return <Trash2 size={17} />;
    default:
      return <Mail size={17} />;
  }
}

function mailboxLabel(mailbox: Mailbox, t: Translator): string {
  const role = inferMailboxRole(mailbox);
  if (role === "inbox") return t("mail.mailbox.inbox");
  if (role === "sent") return t("mail.mailbox.sent");
  if (role === "starred") return t("mail.mailbox.starred");
  if (role === "drafts") return t("mail.mailbox.drafts");
  if (role === "trash") return t("mail.mailbox.trash");
  if (role === "junk") return t("mail.mailbox.junk");
  return mailbox.name;
}

function agentLabel(mailbox: AgentMailbox | null, fallback: string) {
  return mailbox?.agentName || mailbox?.address || fallback;
}

export default function MailSidebarView(props: MailSidebarViewProps) {
  const { mailboxes, loading, error, t } = props;
  // Archive remains a server mailbox, but it is intentionally not part of the
  // current product navigation. Keeping the filter at the view boundary avoids
  // changing protocol data or making archived messages inaccessible to future
  // versions that re-enable the entry.
  const visibleMailboxes = mailboxes.filter(
    (mailbox) => inferMailboxRole(mailbox) !== "archive"
  );
  const showEmptyMailboxNavigation =
    !loading &&
    !error &&
    props.agentMailboxes.length === 0 &&
    visibleMailboxes.length === 0;
  const mailboxNavigation = showEmptyMailboxNavigation
    ? emptyMailboxNavigation
    : visibleMailboxes;
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const selectedAddress =
    props.selectedAgentMailbox?.address ||
    props.identity?.address ||
    t(
      props.identityUnavailable
        ? "mail.identity.unavailable"
        : "mail.identity.loading"
    );
  const selectedConnected =
    props.selectedAgentMailbox?.connectState === "connected";

  useEffect(() => {
    setAccountOpen(false);
  }, [props.selectedAgentMailbox?.id]);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const closeOutside = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [accountOpen]);

  return (
    <aside className="octo-mail-sidebar" aria-label={t("mail.header.title")}>
      <header className="octo-mail-sidebar__brand">
        <span className="octo-mail-sidebar__brand-mark">
          <Mail size={18} />
        </span>
        <strong>{t("mail.header.title")}</strong>
        <span className="octo-mail-sidebar__brand-beta">
          {t("mail.header.beta")}
        </span>
      </header>

      <div className="octo-mail-sidebar__body">
        <button
          className="octo-mail-compose"
          type="button"
          disabled={!props.selectedAgentMailbox}
          onClick={props.onCompose}
        >
          <PenLine size={17} />
          {t("mail.actions.compose")}
        </button>

        <div className="octo-mail-account-wrap" ref={accountRef}>
          <button
            className="octo-mail-account-button"
            type="button"
            aria-label={t("mail.identity.switchLabel")}
            aria-haspopup="listbox"
            aria-expanded={accountOpen}
            disabled={props.agentMailboxes.length === 0}
            onClick={() => setAccountOpen((current) => !current)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAccountOpen(false);
            }}
          >
            <span className="octo-mail-account-copy">
              <strong className="octo-mail-account-name">
                <span className="octo-mail-account-name__icon">
                  <Bot size={15} />
                </span>
                {agentLabel(props.selectedAgentMailbox, selectedAddress)}
              </strong>
              <span>
                <i className={selectedConnected ? "is-connected" : ""} />
                {selectedAddress} ·{" "}
                {selectedConnected
                  ? t("mail.agentMailboxes.connected")
                  : t("mail.agentMailboxes.unconnected")}
              </span>
            </span>
            <ChevronDown className={accountOpen ? "is-open" : ""} size={16} />
          </button>

          {accountOpen ? (
            <div
              className="octo-mail-account-popover"
              role="listbox"
              aria-label={t("mail.identity.switchLabel")}
            >
              <strong className="octo-mail-account-popover__title">
                {t("mail.identity.switchLabel")}
              </strong>
              {props.agentMailboxes.map((mailbox) => {
                const selected = mailbox.id === props.selectedAgentMailbox?.id;
                const connected = mailbox.connectState === "connected";
                return (
                  <button
                    className={`octo-mail-account-option${
                      selected ? " is-selected" : ""
                    }`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    key={mailbox.id}
                    onClick={() => {
                      props.onSelectAgentMailbox(mailbox);
                      setAccountOpen(false);
                    }}
                  >
                    <span className="octo-mail-account-copy">
                      <strong className="octo-mail-account-name">
                        <span className="octo-mail-account-name__icon">
                          <Bot size={14} />
                        </span>
                        {agentLabel(mailbox, mailbox.address)}
                      </strong>
                      <span>
                        <i className={connected ? "is-connected" : ""} />
                        {mailbox.address} ·{" "}
                        {connected
                          ? t("mail.agentMailboxes.connected")
                          : t("mail.agentMailboxes.unconnected")}
                      </span>
                    </span>
                    {selected ? <Check size={16} /> : <span />}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <button
          className={`octo-mail-address-management-entry${
            props.addressManagementActive ? " is-active" : ""
          }`}
          type="button"
          onClick={props.onManageAddresses}
        >
          <SlidersHorizontal size={16} />
          <span>{t("mail.addresses.manage")}</span>
          <ChevronRight size={16} />
        </button>

        <div className="octo-mail-sidebar__section-heading">
          <span>{t("mail.navigation.mailboxes")}</span>
          <button
            type="button"
            aria-label={t("mail.actions.refresh")}
            onClick={props.onRefresh}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <nav
          className="octo-mail-mailboxes"
          aria-label={t("mail.navigation.mailboxes")}
        >
          {loading ? (
            <div className="octo-mail-sidebar-state">
              <Loading size="sm" text={t("mail.status.loading")} />
            </div>
          ) : null}
          {!loading && error ? (
            <div className="octo-mail-sidebar-state is-error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          ) : null}
          {!loading && !error
            ? mailboxNavigation.map((mailbox) => (
                <button
                  key={mailbox.id}
                  type="button"
                  disabled={showEmptyMailboxNavigation}
                  className={
                    !props.addressManagementActive &&
                    mailbox.name === props.selectedMailbox
                      ? "is-active"
                      : ""
                  }
                  onClick={() => props.onSelectMailbox(mailbox)}
                >
                  <span className="octo-mail-mailboxes__icon">
                    {mailboxIcon(mailbox)}
                  </span>
                  <span className="octo-mail-mailboxes__label">
                    {mailboxLabel(mailbox, t)}
                  </span>
                  {mailbox.unread > 0 ? (
                    <span className="octo-mail-mailboxes__count">
                      {mailbox.unread}
                    </span>
                  ) : null}
                </button>
              ))
            : null}
        </nav>
      </div>
    </aside>
  );
}
