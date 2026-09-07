import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Mail,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import Loading from "@octo/ui/components/Loading";
import type {
  DeliveryStatus,
  Mailbox,
  MessageSummary,
} from "../../bridge/types";
import { inferMailboxRole } from "../../bridge/mailbox";
import { formatMessageDate } from "../../utils";
import { hasKeyword } from "../../utils";
import "./index.css";

interface Translator {
  (key: string, options?: { values?: Record<string, unknown> }): string;
}

export interface MailRecordsViewProps {
  mailboxes: Mailbox[];
  selectedMailbox: string;
  selectedMessageId: string;
  messages: MessageSummary[];
  total: number;
  page: number;
  pageCount: number;
  search: string;
  unreadOnly: boolean;
  loading: boolean;
  error: string;
  starringMessageIds: string[];
  locale: string;
  t: Translator;
  onRefresh: () => void;
  onSearch: (value: string) => void;
  onUnreadOnlyChange: (value: boolean) => void;
  onSelectMessage: (message: MessageSummary) => void;
  onToggleStar: (message: MessageSummary) => void;
  onPage: (page: number) => void;
}

function statusIcon(status: DeliveryStatus) {
  if (status === "delivered") return <CheckCircle2 size={12} />;
  if (status === "sending") return <Clock3 size={12} />;
  return <AlertCircle size={12} />;
}

function DeliveryBadge({
  message,
  t,
}: {
  message: MessageSummary;
  t: Translator;
}) {
  if (!message.delivery) return null;
  return (
    <span className={`octo-mail-record-status is-${message.delivery.status}`}>
      {statusIcon(message.delivery.status)}
      {t(`mail.delivery.status.${message.delivery.status}`)}
    </span>
  );
}

function mailboxTitle(mailbox: Mailbox | undefined, t: Translator) {
  const role = mailbox ? inferMailboxRole(mailbox) : undefined;
  if (role === "inbox") return t("mail.mailbox.inbox");
  if (role === "sent") return t("mail.mailbox.sent");
  if (role === "starred") return t("mail.mailbox.starred");
  if (role === "drafts") return t("mail.mailbox.drafts");
  if (role === "trash") return t("mail.mailbox.trash");
  if (role === "junk") return t("mail.mailbox.junk");
  if (role === "archive") return t("mail.mailbox.archive");
  return mailbox?.name || t("mail.records.received");
}

export default function MailRecordsView(props: MailRecordsViewProps) {
  const { mailboxes, messages, t } = props;
  const activeMailbox = mailboxes.find(
    (mailbox) => mailbox.name === props.selectedMailbox
  );
  const activeRole = activeMailbox
    ? inferMailboxRole(activeMailbox)
    : undefined;
  const outboundView = activeRole === "sent" || activeRole === "drafts";
  const sentView = activeRole === "sent";
  const visibleMessages = messages;

  return (
    <section className="octo-mail-records">
      <header className="octo-mail-records__header">
        <span className="octo-mail-records__heading">
          <strong>{mailboxTitle(activeMailbox, t)}</strong>
          <small>
            {t("mail.list.count", { values: { count: props.total } })}
          </small>
        </span>
        <button
          className="octo-mail-record-icon-button"
          type="button"
          aria-label={t("mail.actions.refresh")}
          title={t("mail.actions.refresh")}
          onClick={props.onRefresh}
        >
          <RefreshCw size={15} />
        </button>
      </header>

      <div className="octo-mail-record-tools">
        <label className="octo-mail-record-search">
          <Search size={15} />
          <input
            type="search"
            value={props.search}
            placeholder={t("mail.actions.search")}
            onChange={(event) => props.onSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="octo-mail-record-bulkbar">
        <button
          className={props.unreadOnly ? "is-active" : ""}
          type="button"
          aria-pressed={props.unreadOnly}
          onClick={() => props.onUnreadOnlyChange(!props.unreadOnly)}
        >
          {t("mail.status.unread")}
        </button>
      </div>

      <div className="octo-mail-record-list">
        {props.loading ? (
          <div className="octo-mail-record-state">
            <Loading text={t("mail.status.loading")} layout="vertical" />
          </div>
        ) : null}
        {!props.loading && props.error ? (
          <div className="octo-mail-record-state is-error">
            <AlertCircle size={24} />
            <strong>{t("mail.error.title")}</strong>
            <span>{props.error}</span>
            <button type="button" onClick={props.onRefresh}>
              {t("mail.actions.retry")}
            </button>
          </div>
        ) : null}
        {!props.loading && !props.error && visibleMessages.length === 0 ? (
          <div className="octo-mail-record-state">
            <Mail size={26} />
            <strong>{t("mail.empty.title")}</strong>
            <span>{t("mail.empty.description")}</span>
          </div>
        ) : null}
        {!props.loading && !props.error
          ? visibleMessages.map((message) => {
              const contact = outboundView
                ? message.to.join(", ") || t("mail.unknownRecipient")
                : message.from || t("mail.unknownSender");
              const selected = message.id === props.selectedMessageId;
              const starred = hasKeyword(message.keywords, "\\Flagged");
              const starring = props.starringMessageIds.includes(message.id);
              return (
                <div
                  className={`octo-mail-record-row${
                    message.unread ? " is-unread" : ""
                  }${selected ? " is-selected" : ""}`}
                  key={message.id}
                >
                  <button
                    className={`octo-mail-record-row__star${
                      starred ? " is-starred" : ""
                    }`}
                    type="button"
                    disabled={starring}
                    aria-pressed={starred}
                    aria-label={
                      starred ? t("mail.actions.unstar") : t("mail.actions.star")
                    }
                    title={
                      starred ? t("mail.actions.unstar") : t("mail.actions.star")
                    }
                    onClick={() => props.onToggleStar(message)}
                  >
                    <Star size={15} fill={starred ? "currentColor" : "none"} />
                  </button>
                  <button
                    className="octo-mail-record-row__button"
                    type="button"
                    aria-pressed={selected}
                    onClick={() => props.onSelectMessage(message)}
                  >
                    <span className="octo-mail-record-row__topline">
                      <strong>{contact}</strong>
                      <span className="octo-mail-record-row__time">
                        {message.unread ? (
                          <i aria-label={t("mail.status.unread")} />
                        ) : null}
                        <time>
                          {formatMessageDate(message.receivedAt, props.locale)}
                        </time>
                      </span>
                    </span>
                    <span className="octo-mail-record-row__subject">
                      {message.subject || t("mail.noSubject")}
                    </span>
                    <span className="octo-mail-record-row__meta-line">
                      <span className="octo-mail-record-row__preview">
                        {message.preview}
                      </span>
                      {sentView && message.delivery ? (
                        <DeliveryBadge message={message} t={t} />
                      ) : null}
                    </span>
                  </button>
                </div>
              );
            })
          : null}
      </div>

      <footer className="octo-mail-record-pagination">
        <span>{t("mail.list.page", { values: { page: props.page } })}</span>
        <div>
          <button
            type="button"
            aria-label={t("mail.actions.previous")}
            disabled={props.page <= 1 || props.loading}
            onClick={() => props.onPage(props.page - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {props.page} / {props.pageCount}
          </span>
          <button
            type="button"
            aria-label={t("mail.actions.next")}
            disabled={props.page >= props.pageCount || props.loading}
            onClick={() => props.onPage(props.page + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>
    </section>
  );
}
