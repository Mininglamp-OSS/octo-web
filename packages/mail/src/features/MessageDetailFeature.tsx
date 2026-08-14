import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  Forward,
  LoaderCircle,
  Mail,
  MailOpen,
  Paperclip,
  Pencil,
  Reply,
  ReplyAll,
  RefreshCw,
  Star,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useI18n, wkConfirm, WKApp } from "@octo/base";
import MailService from "../Service/MailService";
import type {
  ComposeMode,
  DeliveryDetail,
  DeliveryStatus,
  MessageDetail,
  MessageSummary,
} from "../bridge/types";
import type { MailboxRole } from "../bridge/mailbox";
import {
  formatFileSize,
  formatMessageDate,
  downloadBlob,
  getErrorMessage,
  getInitial,
  getMessageText,
  hasKeyword,
} from "../utils";
import {
  isDraftMessage,
  resolveDraftId,
  resolveDraftPresentation,
} from "../bridge/draftPresentation";
import ComposerFeature from "./ComposerFeature";
import { isTransientMailPollError } from "../bridge/polling";
import "../ui/MailContent/index.css";

interface MessageDetailFeatureProps {
  mailboxContextId: string;
  mailboxAddress: string;
  messageId: string;
  initialMessage?: MessageSummary;
  mailboxRole?: MailboxRole;
  embedded?: boolean;
  onCompose?: (mode: ComposeMode, source?: MessageDetail) => void;
  onDeleted?: () => void;
  onDraftSent?: () => void;
}

const DELIVERY_POLL_DELAYS = [0, 1500, 3000, 5000, 8000, 12000, 15000];
const THREAD_DETAIL_CONCURRENCY = 5;
const THREAD_DETAIL_LIMIT = 20;
const KNOWN_DELIVERY_REASONS = new Set([
  "recipient_server_rejected",
  "delivery_timed_out",
  "recipient_suppressed",
  "delivery_failed",
]);

function deliveryIcon(status: DeliveryStatus, size = 16) {
  if (status === "delivered") return <CheckCircle2 size={size} />;
  if (status === "sending") return <Clock3 size={size} />;
  return <AlertTriangle size={size} />;
}

async function loadThreadDetails(
  mailboxContextId: string,
  current: MessageDetail,
  ids: string[]
): Promise<MessageDetail[]> {
  const otherIds = Array.from(
    new Set(ids.filter((id) => id !== current.id))
  ).slice(-(THREAD_DETAIL_LIMIT - 1));
  const orderedIds = [current.id, ...otherIds];
  const details = new Map<string, MessageDetail>([[current.id, current]]);
  const pendingIds = orderedIds.filter((id) => id !== current.id);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(THREAD_DETAIL_CONCURRENCY, pendingIds.length) },
    async () => {
      while (cursor < pendingIds.length) {
        const id = pendingIds[cursor++];
        try {
          details.set(id, await MailService.getMessage(mailboxContextId, id));
        } catch {
          // Keep the current message and any successfully loaded thread members.
        }
      }
    }
  );
  await Promise.all(workers);
  return orderedIds.flatMap((id) => {
    const detail = details.get(id);
    return detail ? [detail] : [];
  });
}

export default function MessageDetailFeature({
  mailboxContextId,
  mailboxAddress,
  messageId,
  mailboxRole,
  embedded = false,
  onCompose,
  onDeleted,
  onDraftSent,
}: MessageDetailFeatureProps) {
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<MessageDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryRevision, setDeliveryRevision] = useState(0);
  const [pollingComplete, setPollingComplete] = useState(false);
  const [downloadingAttachment, setDownloadingAttachment] = useState("");
  const [threadExpanded, setThreadExpanded] = useState(false);

  useEffect(() => {
    setThreadExpanded(false);
  }, [messageId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    const load = async () => {
      const current = await MailService.getMessage(mailboxContextId, messageId);
      const threadId = current.threadId || current.agentDraft?.threadId;
      if (!threadId) return [current];
      try {
        const thread = await MailService.getThread(mailboxContextId, threadId);
        return loadThreadDetails(
          mailboxContextId,
          current,
          thread.messages.map((message) => message.id)
        );
      } catch {
        return [current];
      }
    };

    void load()
      .then((nextMessages) => {
        if (!active) return;
        setMessages(nextMessages);
      })
      .catch((reason) => {
        if (active) setError(getErrorMessage(reason, t("mail.error.fallback")));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mailboxContextId, messageId, revision, t]);

  const current = useMemo(
    () =>
      messages.find((message) => message.id === messageId) ||
      messages[messages.length - 1],
    [messageId, messages]
  );
  const threadMessages = useMemo(
    () =>
      [...messages].sort(
        (left, right) =>
          new Date(left.receivedAt).getTime() -
          new Date(right.receivedAt).getTime()
      ),
    [messages]
  );
  const starred = current ? hasKeyword(current.keywords, "\\Flagged") : false;
  const { isDraft, policyReview, agentDraft } = resolveDraftPresentation(
    current,
    mailboxRole
  );
  const relatedThreadMessages = useMemo(
    () =>
      agentDraft?.draftType === "agent_reply_draft"
        ? threadMessages.filter((message) => message.id !== current?.id)
        : threadMessages,
    [agentDraft?.draftType, current?.id, threadMessages]
  );
  const memoizedMessageText = useMemo(() => {
    const cache = new WeakMap<MessageDetail, string>();
    return (message: MessageDetail) => {
      const cached = cache.get(message);
      if (cached !== undefined) return cached;
      const text = getMessageText(message);
      cache.set(message, text);
      return text;
    };
  }, [messages]);
  const tracksDelivery = Boolean(current?.delivery);

  useEffect(() => {
    if (!tracksDelivery) {
      setDelivery(null);
      setDeliveryError("");
      setPollingComplete(false);
      return undefined;
    }

    let active = true;
    let timer = 0;
    let pollIndex = 0;
    let lastStatus = current?.delivery?.status;
    setDeliveryError("");
    setPollingComplete(false);

    const loadDelivery = async () => {
      try {
        const next = await MailService.getMessageDelivery(
          mailboxContextId,
          messageId
        );
        if (!active) return;
        setDelivery(next);
        setDeliveryError("");
        if (lastStatus && next.status !== lastStatus) {
          WKApp.mittBus.emit("mail-refresh" as never);
        }
        lastStatus = next.status;
        if (next.status !== "sending") return;
        pollIndex += 1;
        if (pollIndex >= DELIVERY_POLL_DELAYS.length) {
          setPollingComplete(true);
          return;
        }
        timer = window.setTimeout(
          loadDelivery,
          DELIVERY_POLL_DELAYS[pollIndex]
        );
      } catch (reason) {
        if (!active) return;
        setDeliveryError(getErrorMessage(reason, t("mail.delivery.error")));
        if (!isTransientMailPollError(reason)) return;
        pollIndex += 1;
        if (pollIndex >= DELIVERY_POLL_DELAYS.length) {
          setPollingComplete(true);
          return;
        }
        timer = window.setTimeout(
          loadDelivery,
          DELIVERY_POLL_DELAYS[pollIndex]
        );
      }
    };

    timer = window.setTimeout(loadDelivery, DELIVERY_POLL_DELAYS[0]);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    current?.delivery?.status,
    deliveryRevision,
    mailboxContextId,
    messageId,
    t,
    tracksDelivery,
  ]);

  const openComposer = (mode: "reply" | "reply-all" | "forward") => {
    if (!current) return;
    if (onCompose) {
      onCompose(mode, current);
      return;
    }
    WKApp.routeRight.push(
      <ComposerFeature
        mode={mode}
        mailboxContextId={mailboxContextId}
        mailboxAddress={mailboxAddress}
        source={current}
      />
    );
  };

  const updateKeyword = async (add: string[], remove: string[]) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await MailService.updateKeywords(
        mailboxContextId,
        current.id,
        add,
        remove
      );
      WKApp.mittBus.emit("mail-refresh" as never);
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      setBusy(false);
    }
  };

  const deleteCurrent = () => {
    if (!current) return;
    wkConfirm({
      title: t("mail.confirm.deleteTitle"),
      content: t("mail.confirm.deleteContent"),
      okType: "danger",
      okText: t("mail.actions.delete"),
      onOk: async () => {
        try {
          await MailService.deleteMessage(mailboxContextId, current.id);
          WKApp.mittBus.emit("mail-refresh" as never);
          onDeleted?.();
          if (!embedded) WKApp.routeRight.pop();
        } catch (reason) {
          setError(getErrorMessage(reason, t("mail.error.fallback")));
          throw reason;
        }
      },
    });
  };

  const sendDraft = async () => {
    if (!current || busy) return;
    setBusy(true);
    setError("");
    try {
      await MailService.sendDraft(
        mailboxContextId,
        resolveDraftId(current),
        agentDraft?.draftVersion ?? policyReview?.draftVersion
      );
      WKApp.mittBus.emit("mail-refresh" as never);
      WKApp.mittBus.emit("mail-open-sent" as never);
      onDraftSent?.();
      if (!embedded) WKApp.routeRight.pop();
    } catch (reason) {
      setError(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      setBusy(false);
    }
  };

  const downloadRaw = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const blob = await MailService.getRawMessage(
        mailboxContextId,
        current.id
      );
      downloadBlob(blob, `${current.subject || "message"}.eml`);
    } catch (reason) {
      setError(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      setBusy(false);
    }
  };

  const downloadAttachment = async (
    message: MessageDetail,
    partId: string,
    filename: string
  ) => {
    const key = `${message.id}:${partId}`;
    if (downloadingAttachment) return;
    setDownloadingAttachment(key);
    setError("");
    try {
      const blob = await MailService.downloadAttachment(
        mailboxContextId,
        message.id,
        partId
      );
      downloadBlob(blob, filename || "attachment");
    } catch (reason) {
      setError(getErrorMessage(reason, t("mail.attachment.downloadError")));
    } finally {
      setDownloadingAttachment("");
    }
  };

  if (loading) {
    return (
      <div className="octo-mail-content">
        <div className="octo-mail-content-state">
          <LoaderCircle className="is-spinning" size={24} />
          <span>{t("mail.status.loading")}</span>
        </div>
      </div>
    );
  }

  if (error && !current) {
    return (
      <div className="octo-mail-content">
        <div className="octo-mail-content-state">
          <span className="octo-mail-content-state__mark">
            <MailOpen size={22} />
          </span>
          <strong>{t("mail.error.title")}</strong>
          <span>{error}</span>
          <button
            className="octo-mail-action octo-mail-action--bordered"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("mail.actions.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;
  return (
    <article className={`octo-mail-content${embedded ? " is-embedded" : ""}`}>
      <header className="octo-mail-content__toolbar">
        <div className="octo-mail-content__toolbar-group">
          {!embedded ? (
            <button
              className="octo-mail-action"
              type="button"
              aria-label={t("mail.actions.backToRecords")}
              title={t("mail.actions.backToRecords")}
              onClick={() => WKApp.routeRight.pop()}
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          {isDraft ? (
            <>
              <button
                className="octo-mail-action octo-mail-action--soft"
                type="button"
                disabled={Boolean(current.attachmentsTruncated)}
                title={
                  current.attachmentsTruncated
                    ? t("mail.attachment.incompleteDraft")
                    : undefined
                }
                onClick={() => {
                  if (onCompose) onCompose("edit-draft", current);
                  else {
                    WKApp.routeRight.push(
                      <ComposerFeature
                        mode="edit-draft"
                        mailboxContextId={mailboxContextId}
                        mailboxAddress={mailboxAddress}
                        source={current}
                      />
                    );
                  }
                }}
              >
                <Pencil size={16} />
                <span>{t("mail.actions.editDraft")}</span>
              </button>
              <button
                className="octo-mail-action octo-mail-action--primary"
                type="button"
                disabled={busy}
                onClick={() => void sendDraft()}
              >
                <Mail size={16} />
                <span>{t("mail.actions.sendDraft")}</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="octo-mail-action octo-mail-action--soft"
                type="button"
                onClick={() => openComposer("reply")}
              >
                <Reply size={16} />
                <span>{t("mail.actions.reply")}</span>
              </button>
              <button
                className="octo-mail-action octo-mail-action--soft"
                type="button"
                onClick={() => openComposer("reply-all")}
              >
                <ReplyAll size={16} />
                <span>{t("mail.actions.replyAll")}</span>
              </button>
              <button
                className="octo-mail-action octo-mail-action--soft"
                type="button"
                onClick={() => openComposer("forward")}
              >
                <Forward size={16} />
                <span>{t("mail.actions.forward")}</span>
              </button>
            </>
          )}
        </div>
        <div className="octo-mail-content__toolbar-group">
          <button
            className="octo-mail-action"
            type="button"
            title={starred ? t("mail.actions.unstar") : t("mail.actions.star")}
            aria-label={
              starred ? t("mail.actions.unstar") : t("mail.actions.star")
            }
            onClick={() =>
              updateKeyword(
                starred ? [] : ["\\Flagged"],
                starred ? ["\\Flagged"] : []
              )
            }
          >
            <Star size={16} fill={starred ? "currentColor" : "none"} />
          </button>
          <button
            className="octo-mail-action"
            type="button"
            title={t("mail.actions.downloadRaw")}
            aria-label={t("mail.actions.downloadRaw")}
            onClick={downloadRaw}
          >
            <Download size={16} />
          </button>
          <button
            className="octo-mail-action octo-mail-action--danger"
            type="button"
            title={t("mail.actions.delete")}
            aria-label={t("mail.actions.delete")}
            onClick={deleteCurrent}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className="octo-mail-reader-scroll">
        <div className="octo-mail-reader">
          <h1 className="octo-mail-reader__subject">
            {current.subject || t("mail.noSubject")}
          </h1>
          {error ? (
            <div className="octo-mail-reader__error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          ) : null}
          {policyReview ? (
            <section className="octo-mail-policy-review" role="status">
              <ShieldAlert size={20} />
              <span>
                <strong>{t("mail.policy.reviewRequired")}</strong>
                <small>
                  {t(
                    policyReview.source === "inbound_auto_reply"
                      ? "mail.policy.sourceAutoReply"
                      : "mail.policy.sourceOwnerRequest"
                  )}
                </small>
                {policyReview.reasons.map((reason) => (
                  <span
                    className="octo-mail-policy-review__reason"
                    key={reason.code}
                  >
                    <b>{reason.title}</b>
                    <small>{reason.description}</small>
                  </span>
                ))}
                <small>{t("mail.policy.ownerOverrideNote")}</small>
              </span>
            </section>
          ) : null}
          {tracksDelivery ? (
            <section
              className={`octo-mail-delivery-panel is-${
                delivery?.status || current.delivery?.status || "sending"
              }`}
            >
              <div className="octo-mail-delivery-panel__heading">
                <span className="octo-mail-delivery-panel__icon">
                  {deliveryIcon(
                    delivery?.status || current.delivery?.status || "sending",
                    18
                  )}
                </span>
                <span>
                  <strong>
                    {t(
                      `mail.delivery.status.${
                        delivery?.status ||
                        current.delivery?.status ||
                        "sending"
                      }`
                    )}
                  </strong>
                  <small>
                    {t(
                      `mail.delivery.summary.${
                        delivery?.status ||
                        current.delivery?.status ||
                        "sending"
                      }`,
                      {
                        values: {
                          delivered:
                            delivery?.delivered ??
                            current.delivery?.delivered ??
                            0,
                          total:
                            delivery?.total ?? current.delivery?.total ?? 0,
                        },
                      }
                    )}
                  </small>
                </span>
                {(delivery?.status === "sending" && pollingComplete) ||
                deliveryError ? (
                  <button
                    className="octo-mail-action"
                    type="button"
                    onClick={() => setDeliveryRevision((value) => value + 1)}
                  >
                    <RefreshCw size={14} />
                    <span>{t("mail.actions.refresh")}</span>
                  </button>
                ) : null}
              </div>
              {deliveryError ? (
                <p className="octo-mail-delivery-panel__error">
                  {deliveryError}
                </p>
              ) : null}
              {delivery?.recipients?.length ? (
                <div className="octo-mail-delivery-recipients">
                  {delivery.recipients.map((recipient) => {
                    const reason = KNOWN_DELIVERY_REASONS.has(
                      recipient.reasonCode || ""
                    )
                      ? recipient.reasonCode
                      : "delivery_failed";
                    return (
                      <div
                        className="octo-mail-delivery-recipient"
                        key={recipient.address}
                      >
                        <span
                          className={`octo-mail-delivery-recipient__state is-${recipient.status}`}
                        >
                          {deliveryIcon(recipient.status, 14)}
                        </span>
                        <span className="octo-mail-delivery-recipient__body">
                          <strong>{recipient.address}</strong>
                          <small>
                            {t(`mail.delivery.recipient.${recipient.status}`)}
                            {recipient.status === "not_delivered"
                              ? ` · ${t(`mail.delivery.reason.${reason}`)}`
                              : ""}
                          </small>
                          {recipient.technicalDetail ? (
                            <details>
                              <summary>
                                {t("mail.delivery.technicalDetails")}
                              </summary>
                              <code>{recipient.technicalDetail}</code>
                            </details>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <p className="octo-mail-delivery-panel__note">
                {t("mail.delivery.acceptedNote")}
              </p>
            </section>
          ) : null}
          <div className="octo-mail-thread">
            {[current].map((message) => (
              <section
                className={`octo-mail-thread-card${
                  message.id === messageId ? " is-current" : ""
                }`}
                key={message.id}
              >
                <div className="octo-mail-thread-card__sender">
                  <span className="octo-mail-thread-card__avatar">
                    {getInitial(message.originalFrom || message.from)}
                  </span>
                  <span className="octo-mail-thread-card__identity">
                    <strong>
                      {message.originalFrom ||
                        message.from ||
                        t("mail.unknownSender")}
                    </strong>
                    {isDraftMessage(
                      message,
                      message.id === current?.id ? mailboxRole : undefined
                    ) ? (
                      <em className="octo-mail-thread-card__draft-badge">
                        {t("mail.reader.draft")}
                      </em>
                    ) : null}
                    <span>
                      {message.sentBy
                        ? t("mail.reader.sentBy", {
                            values: { sender: message.sentBy },
                          })
                        : message.from}
                    </span>
                  </span>
                  <time className="octo-mail-thread-card__meta">
                    {formatMessageDate(message.receivedAt, locale)}
                  </time>
                </div>
                <div className="octo-mail-thread-card__recipients">
                  {t("mail.reader.to")}: {message.to.join(", ")}
                  {message.cc?.length ? (
                    <>
                      <br />
                      {t("mail.reader.cc")}: {message.cc.join(", ")}
                    </>
                  ) : null}
                </div>
                <p className="octo-mail-thread-card__body">
                  {memoizedMessageText(message)}
                </p>
                {message.attachments?.length ? (
                  <section
                    className="octo-mail-thread-card__attachments"
                    aria-label={t("mail.attachment.list")}
                  >
                    <strong>{t("mail.attachment.list")}</strong>
                    <div className="octo-mail-attachment-list">
                      {message.attachments.map((attachment) => {
                        const attachmentKey = `${message.id}:${attachment.partId}`;
                        const downloading =
                          downloadingAttachment === attachmentKey;
                        return (
                          <button
                            className="octo-mail-received-attachment"
                            type="button"
                            key={attachment.partId}
                            disabled={Boolean(downloadingAttachment)}
                            title={t("mail.attachment.download")}
                            onClick={() =>
                              void downloadAttachment(
                                message,
                                attachment.partId,
                                attachment.filename
                              )
                            }
                          >
                            <span className="octo-mail-received-attachment__mark">
                              {downloading ? (
                                <LoaderCircle
                                  className="is-spinning"
                                  size={16}
                                />
                              ) : (
                                <Paperclip size={16} />
                              )}
                            </span>
                            <span className="octo-mail-received-attachment__copy">
                              <b>{attachment.filename}</b>
                              <small>
                                {attachment.contentType} ·{" "}
                                {formatFileSize(attachment.size)}
                              </small>
                            </span>
                            <Download size={15} />
                          </button>
                        );
                      })}
                    </div>
                    {message.attachmentsTruncated ? (
                      <small className="octo-mail-thread-card__attachments-note">
                        {t("mail.attachment.truncated")}
                      </small>
                    ) : null}
                  </section>
                ) : null}
              </section>
            ))}
          </div>
          {relatedThreadMessages.length > 1 ||
          (agentDraft?.draftType === "agent_reply_draft" &&
            relatedThreadMessages.length > 0) ? (
            <section className="octo-mail-thread-summary">
              <button
                className="octo-mail-thread-toggle"
                type="button"
                aria-expanded={threadExpanded}
                onClick={() => setThreadExpanded((value) => !value)}
              >
                <span>{threadExpanded ? "⌄" : "›"}</span>
                {t("mail.reader.threadCount", {
                  values: { count: relatedThreadMessages.length },
                })}
              </button>
              {threadExpanded ? (
                <div className="octo-mail-thread-summary__list">
                  {relatedThreadMessages.map((message) => {
                    const sender =
                      message.originalFrom ||
                      message.from ||
                      t("mail.unknownSender");
                    const sentByAgent =
                      message.from.trim().toLowerCase() ===
                      mailboxAddress.trim().toLowerCase();
                    const draft = isDraftMessage(
                      message,
                      message.id === current?.id ? mailboxRole : undefined
                    );
                    return (
                      <article
                        className="octo-mail-thread-summary__item"
                        key={message.id}
                      >
                        <header>
                          <span className="octo-mail-thread-summary__identity">
                            <strong>{sender}</strong>
                            {sentByAgent ? (
                              <em>{t("mail.reader.bot")}</em>
                            ) : null}
                            {draft ? (
                              <em className="is-draft">
                                {t("mail.reader.draft")}
                              </em>
                            ) : null}
                            <small>
                              {t("mail.reader.to")} {message.to.join(", ")}
                            </small>
                          </span>
                          <time>
                            {formatMessageDate(message.receivedAt, locale)}
                          </time>
                        </header>
                        <p>{memoizedMessageText(message)}</p>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}
          <div className="octo-mail-raw-hint">
            <Paperclip size={15} />
            {t("mail.reader.rawHint")}
          </div>
        </div>
      </div>
    </article>
  );
}
