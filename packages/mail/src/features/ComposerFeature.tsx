import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { useI18n, modalConfirm, WKApp } from "@octo/base";
import MailService from "../Service/MailService";
import type {
  AttachmentInput,
  ComposeMode,
  MessageDetail,
} from "../bridge/types";
import {
  formatFileSize,
  getErrorMessage,
  getMessageText,
  splitAddresses,
} from "../utils";
import { registerAgentMailboxSwitchGuard } from "../bridge/mailboxContext";
import { hasComposerChanges } from "../bridge/composerState";
import { resolveDraftId } from "../bridge/draftPresentation";
import "../ui/MailContent/index.css";

interface ComposerFeatureProps {
  mode: ComposeMode;
  mailboxContextId: string;
  mailboxAddress: string;
  source?: MessageDetail;
  onClose?: () => void;
}

interface PendingAttachment extends AttachmentInput {
  size: number;
}

function attachmentFingerprint(attachments: PendingAttachment[]): string {
  return attachments
    .map(
      (attachment) =>
        `${attachment.filename}\u0000${attachment.contentType}\u0000${attachment.size}\u0000${attachment.content.length}`
    )
    .join("\u0001");
}

function isAmbiguousDraftSendFailure(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return true;
  const candidate = reason as {
    code?: unknown;
    status?: unknown;
    normalized?: { code?: unknown; httpStatus?: unknown };
  };
  const code = String(candidate.code ?? candidate.normalized?.code ?? "");
  if (
    code === "draft_send_result_unknown" ||
    code === "submission_result_unknown" ||
    code === "ECONNABORTED" ||
    code === "ERR_NETWORK"
  ) {
    return true;
  }
  const rawStatus = candidate.status ?? candidate.normalized?.httpStatus;
  if (rawStatus === undefined || rawStatus === null) return true;
  const status = Number(rawStatus);
  return !Number.isFinite(status) || status === 408 || status >= 500;
}

function fileToAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error || new Error("File read failed"));
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        content: value.includes(",")
          ? value.slice(value.indexOf(",") + 1)
          : value,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

function blobToAttachment(
  blob: Blob,
  filename: string,
  contentType: string
): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error || new Error("Attachment read failed"));
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve({
        filename,
        contentType: contentType || blob.type || "application/octet-stream",
        content: value.includes(",")
          ? value.slice(value.indexOf(",") + 1)
          : value,
        size: blob.size,
      });
    };
    reader.readAsDataURL(blob);
  });
}

export default function ComposerFeature({
  mode,
  mailboxContextId,
  mailboxAddress,
  source,
  onClose,
}: ComposerFeatureProps) {
  const { t } = useI18n();
  const editingDraft = mode === "edit-draft";
  const initialTo = editingDraft ? (source?.to || []).join(", ") : "";
  const initialCc = editingDraft ? (source?.cc || []).join(", ") : "";
  const initialBcc = editingDraft ? (source?.bcc || []).join(", ") : "";
  const initialSubject = mode === "new" ? "" : source?.subject || "";
  const initialBody = useMemo(
    () => (editingDraft && source ? getMessageText(source) : ""),
    [editingDraft, source]
  );
  const initialHtml = editingDraft ? source?.bodyHtml || "" : "";
  const attachmentListIncomplete =
    editingDraft && Boolean(source?.attachmentsTruncated);
  const [draftIdentity, setDraftIdentity] = useState(() => ({
    id: resolveDraftId(source),
    version: source?.agentDraft?.draftVersion ?? source?.policy?.draftVersion,
  }));
  const [draftPreparedForSend, setDraftPreparedForSend] = useState(false);
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState(initialCc);
  const [bcc, setBcc] = useState(initialBcc);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [showCcBcc, setShowCcBcc] = useState(
    editingDraft && Boolean(source?.cc?.length || source?.bcc?.length)
  );
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [initialAttachments, setInitialAttachments] = useState("");
  const [loadingAttachments, setLoadingAttachments] = useState(editingDraft);
  const [readingLocalAttachments, setReadingLocalAttachments] = useState(0);
  const [attachmentLoadFailed, setAttachmentLoadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [closing, setClosing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const readingLocalAttachmentsRef = useRef(0);
  const dirty = hasComposerChanges(
    {
      to,
      cc,
      bcc,
      subject,
      body,
      attachments: attachmentFingerprint(attachments),
    },
    {
      to: initialTo,
      cc: initialCc,
      bcc: initialBcc,
      subject: initialSubject,
      body: initialBody,
      attachments: initialAttachments,
    }
  );

  useEffect(() => {
    setAttachmentLoadFailed(false);
    if (!editingDraft || !source) {
      setLoadingAttachments(false);
      return undefined;
    }
    if (attachmentListIncomplete) {
      setLoadingAttachments(false);
      setIsError(true);
      setFeedback(t("mail.attachment.incompleteDraft"));
      return undefined;
    }
    let active = true;
    const existing = source.attachments || [];
    if (existing.length === 0) {
      setLoadingAttachments(false);
      return undefined;
    }
    setLoadingAttachments(true);
    void Promise.all(
      existing.map(async (attachment) => {
        const blob = await MailService.downloadAttachment(
          mailboxContextId,
          source.id,
          attachment.partId
        );
        return blobToAttachment(
          blob,
          attachment.filename,
          attachment.contentType
        );
      })
    )
      .then((loaded) => {
        if (active) {
          setAttachments(loaded);
          setInitialAttachments(attachmentFingerprint(loaded));
        }
      })
      .catch((reason) => {
        if (!active) return;
        setAttachmentLoadFailed(true);
        setIsError(true);
        setFeedback(
          getErrorMessage(reason, t("mail.attachment.downloadError"))
        );
      })
      .finally(() => {
        if (active) setLoadingAttachments(false);
      });
    return () => {
      active = false;
    };
  }, [attachmentListIncomplete, editingDraft, mailboxContextId, source, t]);

  const title = useMemo(() => {
    if (mode === "reply") return t("mail.compose.replyTitle");
    if (mode === "reply-all") return t("mail.compose.replyAllTitle");
    if (mode === "forward") return t("mail.compose.forwardTitle");
    if (mode === "edit-draft") return t("mail.compose.editDraftTitle");
    return t("mail.compose.title");
  }, [mode, t]);

  const forceClose = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    WKApp.routeRight.pop();
  }, [onClose]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  const saveDraft = useCallback(
    async (afterSave?: () => void) => {
      if (
        loadingAttachments ||
        readingLocalAttachmentsRef.current > 0 ||
        attachmentLoadFailed ||
        attachmentListIncomplete ||
        draftPreparedForSend ||
        sending ||
        savingDraft ||
        closing
      ) {
        const reason = new Error(
          loadingAttachments
            ? t("mail.attachment.loading")
            : readingLocalAttachmentsRef.current > 0
            ? t("mail.attachment.loading")
            : attachmentListIncomplete
            ? t("mail.attachment.incompleteDraft")
            : attachmentLoadFailed
            ? t("mail.attachment.downloadError")
            : t("mail.error.fallback")
        );
        setIsError(true);
        setFeedback(reason.message);
        throw reason;
      }
      setSavingDraft(true);
      setIsError(false);
      setFeedback(t("mail.status.savingDraft"));
      const attachmentPayload = attachments.map(
        ({ size: _size, ...attachment }) => attachment
      );
      try {
        const input = {
          to: splitAddresses(to),
          cc: splitAddresses(cc),
          bcc: splitAddresses(bcc),
          subject,
          text: body,
          html: editingDraft && body === initialBody ? initialHtml : "",
          attachments: attachmentPayload,
        };
        if (editingDraft && source) {
          const updated = await MailService.updateDraft(
            mailboxContextId,
            draftIdentity.id,
            {
              ...input,
              draftVersion: draftIdentity.version,
            }
          );
          setDraftIdentity({
            id: updated.id,
            version: updated.draftVersion ?? draftIdentity.version,
          });
        } else {
          await MailService.createDraft(mailboxContextId, input);
        }
        WKApp.mittBus.emit("mail-open-drafts" as never);
        WKApp.mittBus.emit("mail-refresh" as never);
        (afterSave ?? forceClose)();
      } catch (reason) {
        setIsError(true);
        setFeedback(getErrorMessage(reason, t("mail.error.fallback")));
        throw reason;
      } finally {
        setSavingDraft(false);
      }
    },
    [
      attachments,
      attachmentLoadFailed,
      attachmentListIncomplete,
      bcc,
      body,
      cc,
      closing,
      editingDraft,
      draftIdentity,
      draftPreparedForSend,
      forceClose,
      loadingAttachments,
      readingLocalAttachments,
      initialBody,
      initialHtml,
      mailboxContextId,
      savingDraft,
      sending,
      source,
      subject,
      t,
      to,
    ]
  );

  const attachmentUnavailable =
    loadingAttachments ||
    readingLocalAttachments > 0 ||
    attachmentLoadFailed ||
    attachmentListIncomplete;
  const draftLocked = editingDraft && draftPreparedForSend;
  const operationInFlight = sending || savingDraft || closing;

  const confirmAttachmentDiscard = useCallback(
    (onDiscard: () => void) => {
      modalConfirm({
        title: t("mail.confirm.attachmentUnavailableTitle"),
        content: t(
          attachmentListIncomplete
            ? "mail.attachment.incompleteDraft"
            : loadingAttachments || readingLocalAttachments > 0
            ? "mail.confirm.attachmentLoadingContent"
            : "mail.confirm.attachmentFailedContent"
        ),
        cancelText: t("mail.actions.continueEditing"),
        okText: t("mail.actions.discard"),
        okType: "danger",
        closeOnEsc: false,
        maskClosable: false,
        onOk: onDiscard,
      });
    },
    [attachmentListIncomplete, loadingAttachments, readingLocalAttachments, t]
  );

  const requestClose = () => {
    if (attachmentUnavailable && !sending && !savingDraft && !closing) {
      confirmAttachmentDiscard(forceClose);
      return;
    }
    if (!dirty || sending || savingDraft || closing) {
      if (!sending && !savingDraft && !closing) forceClose();
      return;
    }
    if (mode !== "new") {
      modalConfirm({
        title: t("mail.confirm.discardChangesTitle"),
        content: t("mail.confirm.discardChangesContent"),
        cancelText: t("mail.actions.continueEditing"),
        okText: t("mail.actions.discard"),
        okType: "danger",
        onOk: forceClose,
      });
      return;
    }
    modalConfirm({
      title: t("mail.confirm.saveDraftTitle"),
      content: t("mail.confirm.saveDraftContent"),
      cancelText: t("mail.actions.discard"),
      okText: t("mail.actions.saveDraft"),
      closeOnEsc: false,
      maskClosable: false,
      onCancel: forceClose,
      onOk: () => saveDraft(),
    });
  };

  useEffect(() => {
    if (!dirty && !attachmentUnavailable && !operationInFlight)
      return undefined;
    return registerAgentMailboxSwitchGuard((proceed) => {
      if (operationInFlight) return false;
      if (attachmentUnavailable) {
        confirmAttachmentDiscard(proceed);
        return false;
      }
      if ((mode === "new" || editingDraft) && !draftLocked) {
        modalConfirm({
          title: t("mail.confirm.saveDraftTitle"),
          content: t("mail.confirm.saveDraftContent"),
          cancelText: t("mail.actions.discard"),
          okText: t("mail.actions.saveDraft"),
          closeOnEsc: false,
          maskClosable: false,
          onCancel: proceed,
          onOk: () => saveDraft(proceed),
        });
      } else {
        modalConfirm({
          title: t("mail.confirm.discardChangesTitle"),
          content: t("mail.confirm.discardChangesContent"),
          cancelText: t("mail.actions.continueEditing"),
          okText: t("mail.actions.discard"),
          okType: "danger",
          onOk: proceed,
        });
      }
      return false;
    });
  }, [
    attachmentUnavailable,
    confirmAttachmentDiscard,
    dirty,
    draftLocked,
    editingDraft,
    mode,
    operationInFlight,
    saveDraft,
    t,
  ]);

  const addFiles = async (files: FileList | null) => {
    if (
      attachmentUnavailable ||
      operationInFlight ||
      draftLocked ||
      !files?.length
    )
      return;
    readingLocalAttachmentsRef.current += 1;
    setReadingLocalAttachments((current) => current + 1);
    try {
      const next = await Promise.all(Array.from(files).map(fileToAttachment));
      setAttachments((current) => [...current, ...next]);
    } catch (reason) {
      setIsError(true);
      setFeedback(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      readingLocalAttachmentsRef.current = Math.max(
        0,
        readingLocalAttachmentsRef.current - 1
      );
      setReadingLocalAttachments((current) => Math.max(0, current - 1));
    }
  };

  const submit = async () => {
    if (
      attachmentUnavailable ||
      readingLocalAttachmentsRef.current > 0 ||
      sending ||
      savingDraft ||
      closing
    ) {
      setIsError(true);
      if (attachmentUnavailable) {
        setFeedback(
          loadingAttachments || readingLocalAttachmentsRef.current > 0
            ? t("mail.attachment.loading")
            : attachmentListIncomplete
            ? t("mail.attachment.incompleteDraft")
            : t("mail.attachment.downloadError")
        );
      }
      return;
    }
    const recipients = splitAddresses(to);
    if (
      (mode === "new" || mode === "forward" || editingDraft) &&
      recipients.length === 0
    ) {
      setIsError(true);
      setFeedback(t("mail.compose.validationRecipient"));
      return;
    }
    if (!body.trim()) {
      setIsError(true);
      setFeedback(t("mail.compose.validationBody"));
      return;
    }

    setSending(true);
    setIsError(false);
    setFeedback(t("mail.status.sending"));
    const attachmentPayload = attachments.map(
      ({ size: _size, ...attachment }) => attachment
    );
    const html = editingDraft && body === initialBody ? initialHtml : "";
    let preparedDraftForThisAttempt = draftPreparedForSend;
    try {
      if (editingDraft && source) {
        let nextDraftIdentity = draftIdentity;
        if (!draftPreparedForSend) {
          const updated = await MailService.updateDraft(
            mailboxContextId,
            draftIdentity.id,
            {
              to: recipients,
              cc: splitAddresses(cc),
              bcc: splitAddresses(bcc),
              subject,
              text: body,
              html,
              attachments: attachmentPayload,
              draftVersion: draftIdentity.version,
            }
          );
          nextDraftIdentity = {
            id: updated.id,
            version: updated.draftVersion,
          };
          setDraftIdentity(nextDraftIdentity);
          // Retrying must submit this exact immutable Draft. Replacing it again
          // would bypass octo-mail's retained ambiguous-send claim.
          setDraftPreparedForSend(true);
          preparedDraftForThisAttempt = true;
        }
        await MailService.sendDraft(
          mailboxContextId,
          nextDraftIdentity.id,
          nextDraftIdentity.version
        );
      } else if (mode === "new") {
        await MailService.sendMessage(mailboxContextId, {
          to: recipients,
          cc: splitAddresses(cc),
          bcc: splitAddresses(bcc),
          subject,
          text: body,
          html,
          attachments: attachmentPayload,
        });
      } else if (mode === "forward" && source) {
        await MailService.forward(mailboxContextId, source.id, {
          to: recipients,
          text: body,
          html,
          attachments: attachmentPayload,
        });
      } else if (mode === "reply-all" && source) {
        await MailService.replyAll(mailboxContextId, source.id, {
          text: body,
          html,
          attachments: attachmentPayload,
        });
      } else if (source) {
        await MailService.reply(mailboxContextId, source.id, {
          text: body,
          html,
          attachments: attachmentPayload,
        });
      }
      setFeedback(t("mail.status.sent"));
      WKApp.mittBus.emit("mail-refresh" as never);
      if (mode === "new" || editingDraft) {
        WKApp.mittBus.emit("mail-open-sent" as never);
      }
      setClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        forceClose();
      }, 450);
    } catch (reason) {
      if (
        editingDraft &&
        preparedDraftForThisAttempt &&
        !isAmbiguousDraftSendFailure(reason)
      ) {
        setDraftPreparedForSend(false);
      }
      setIsError(true);
      setFeedback(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      setSending(false);
    }
  };

  const showRecipient = mode === "new" || mode === "forward" || editingDraft;

  return (
    <section className="octo-mail-content">
      <header className="octo-mail-content__toolbar">
        <strong>{title}</strong>
        <button
          className="octo-mail-action"
          type="button"
          aria-label={t("mail.actions.cancel")}
          onClick={requestClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="octo-mail-reader-scroll">
        <div className="octo-mail-composer">
          <h1 className="octo-mail-composer__title">{title}</h1>
          <div className="octo-mail-composer__field">
            <label>{t("mail.compose.from")}</label>
            <strong className="octo-mail-composer__from">
              {mailboxAddress}
            </strong>
          </div>
          {showRecipient ? (
            <div className="octo-mail-composer__field">
              <label htmlFor="octo-mail-to">{t("mail.compose.to")}</label>
              <input
                id="octo-mail-to"
                value={to}
                placeholder={t("mail.compose.toPlaceholder")}
                onChange={(event) => setTo(event.target.value)}
                disabled={draftLocked}
                autoFocus
              />
            </div>
          ) : null}
          {(mode === "new" || editingDraft) && !showCcBcc ? (
            <button
              className="octo-mail-action"
              type="button"
              onClick={() => setShowCcBcc(true)}
              disabled={draftLocked}
            >
              {t("mail.actions.addCcBcc")}
            </button>
          ) : null}
          {(mode === "new" || editingDraft) && showCcBcc ? (
            <>
              <div className="octo-mail-composer__field">
                <label htmlFor="octo-mail-cc">{t("mail.compose.cc")}</label>
                <input
                  id="octo-mail-cc"
                  value={cc}
                  disabled={draftLocked}
                  onChange={(event) => setCc(event.target.value)}
                />
              </div>
              <div className="octo-mail-composer__field">
                <label htmlFor="octo-mail-bcc">{t("mail.compose.bcc")}</label>
                <input
                  id="octo-mail-bcc"
                  value={bcc}
                  disabled={draftLocked}
                  onChange={(event) => setBcc(event.target.value)}
                />
              </div>
            </>
          ) : null}
          <div className="octo-mail-composer__field">
            <label htmlFor="octo-mail-subject">
              {t("mail.compose.subject")}
            </label>
            <input
              id="octo-mail-subject"
              value={subject}
              placeholder={t("mail.compose.subjectPlaceholder")}
              onChange={(event) => setSubject(event.target.value)}
              disabled={(mode !== "new" && !editingDraft) || draftLocked}
            />
          </div>
          <textarea
            className="octo-mail-composer__body"
            value={body}
            aria-label={t("mail.compose.body")}
            placeholder={t("mail.compose.bodyPlaceholder")}
            onChange={(event) => setBody(event.target.value)}
            disabled={draftLocked}
            autoFocus={!showRecipient}
          />
          <div className="octo-mail-composer__extras">
            <div className="octo-mail-composer__attachments">
              {attachments.map((attachment, index) => (
                <span
                  className="octo-mail-attachment-chip"
                  key={`${attachment.filename}-${index}`}
                >
                  <Paperclip size={12} />
                  <span>
                    {attachment.filename} · {formatFileSize(attachment.size)}
                  </span>
                  <button
                    type="button"
                    aria-label={t("mail.actions.delete")}
                    disabled={
                      attachmentUnavailable || operationInFlight || draftLocked
                    }
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <label className="octo-mail-file-input">
              <Paperclip size={15} />
              {t("mail.actions.attach")}
              <input
                type="file"
                multiple
                disabled={
                  attachmentUnavailable || operationInFlight || draftLocked
                }
                onChange={(event) => {
                  const input = event.currentTarget;
                  void addFiles(input.files).finally(() => {
                    input.value = "";
                  });
                }}
              />
            </label>
          </div>
          <footer className="octo-mail-composer__footer">
            <span
              className={`octo-mail-composer__feedback${
                isError ? " is-error" : ""
              }`}
            >
              {feedback}
            </span>
            <div className="octo-mail-composer__footer-actions">
              <button
                className="octo-mail-action octo-mail-action--bordered"
                type="button"
                disabled={sending || savingDraft || closing}
                onClick={requestClose}
              >
                {t("mail.actions.cancel")}
              </button>
              {editingDraft ? (
                <button
                  className="octo-mail-action octo-mail-action--bordered"
                  type="button"
                  disabled={
                    sending ||
                    savingDraft ||
                    closing ||
                    attachmentUnavailable ||
                    draftLocked
                  }
                  onClick={() => void saveDraft()}
                >
                  {savingDraft ? (
                    <LoaderCircle className="is-spinning" size={16} />
                  ) : null}
                  <span>{t("mail.actions.save")}</span>
                </button>
              ) : null}
              <button
                className="octo-mail-action octo-mail-action--primary"
                type="button"
                disabled={
                  sending || savingDraft || closing || attachmentUnavailable
                }
                onClick={() => void submit()}
              >
                {sending ? (
                  <LoaderCircle className="is-spinning" size={16} />
                ) : (
                  <Send size={16} />
                )}
                <span>
                  {t(
                    editingDraft && source?.policy
                      ? "mail.actions.confirmAndSend"
                      : "mail.actions.send"
                  )}
                </span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}
