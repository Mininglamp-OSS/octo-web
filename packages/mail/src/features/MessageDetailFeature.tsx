import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DOMPurify from "dompurify";
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

const EMAIL_HTML_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
].join("; ");

const EMAIL_HTML_MIN_HEIGHT = 80;
const EMAIL_HTML_MAX_HEIGHT = 20_000;
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const EMAIL_SVG_PAINT_SELECTOR =
  "circle, ellipse, line, path, polygon, polyline, rect, text";

interface SanitizedEmailHtml {
  bodyAttributes: Array<[string, string]>;
  bodyHtml: string;
  headHtml: string;
  htmlAttributes: Array<[string, string]>;
}

function sanitizeEmailHtml(html: string) {
  const sanitized = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "area",
      "base",
      "button",
      "embed",
      "form",
      "iframe",
      "input",
      "link",
      "map",
      "meta",
      "object",
      "script",
      "select",
      "textarea",
    ],
  });
  const sanitizedDocument = new DOMParser().parseFromString(
    sanitized,
    "text/html"
  );
  const visibilityBody = sanitizedDocument.body.cloneNode(true) as HTMLElement;
  visibilityBody.querySelectorAll("style").forEach((style) => style.remove());
  const hasRenderableImage = Array.from(
    visibilityBody.querySelectorAll<HTMLImageElement>("img[src]")
  ).some((image) =>
    /^(data|blob):/i.test((image.getAttribute("src") || "").trim())
  );
  const hasPotentiallyVisibleContent =
    Boolean(visibilityBody.textContent?.trim()) ||
    hasRenderableImage ||
    Boolean(visibilityBody.querySelector(EMAIL_SVG_PAINT_SELECTOR));
  if (!hasPotentiallyVisibleContent) return null;

  sanitizedDocument.querySelectorAll("a").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    const xlinkHref = anchor.getAttributeNS(XLINK_NAMESPACE, "href");
    if (href === null && xlinkHref === null) return;
    if (xlinkHref !== null) {
      anchor.removeAttributeNS(XLINK_NAMESPACE, "href");
      if (href === null) anchor.setAttribute("href", xlinkHref);
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  return {
    bodyAttributes: Array.from(
      sanitizedDocument.body.attributes,
      (attribute) => [attribute.name, attribute.value]
    ),
    bodyHtml: sanitizedDocument.body.innerHTML,
    headHtml: sanitizedDocument.head.innerHTML,
    htmlAttributes: ["dir", "lang"].flatMap((name) => {
      const value = sanitizedDocument.documentElement.getAttribute(name);
      return value === null ? [] : [[name, value]];
    }),
  } satisfies SanitizedEmailHtml;
}

function hasZeroOpacity(style: CSSStyleDeclaration) {
  const opacity = Number.parseFloat(style.opacity);
  return Number.isFinite(opacity) && opacity === 0;
}

function hasTransparentColor(style: CSSStyleDeclaration) {
  const color = style.color.trim().toLowerCase();
  return (
    color === "transparent" ||
    /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color) ||
    /\/\s*0(?:\.0+)?\s*\)$/.test(color)
  );
}

function isClippedToNothing(element: Element, style: CSSStyleDeclaration) {
  const clipsOverflow = [style.overflow, style.overflowX, style.overflowY].some(
    (value) => value === "hidden" || value === "clip"
  );
  if (!clipsOverflow) return false;
  const rect = element.getBoundingClientRect();
  return rect.width <= 0 || rect.height <= 0;
}

function hasVisibleAncestors(element: Element) {
  const view = element.ownerDocument.defaultView;
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const style = view?.getComputedStyle(current);
    if (!style) continue;
    if (
      style.display === "none" ||
      hasZeroOpacity(style) ||
      isClippedToNothing(current, style)
    ) {
      return false;
    }
  }
  return true;
}

function isRenderedElement(element: Element) {
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (
    !style ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    !hasVisibleAncestors(element)
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isRenderedTextNode(node: Text) {
  const parent = node.parentElement;
  const view = node.ownerDocument.defaultView;
  const style = parent && view?.getComputedStyle(parent);
  if (
    !node.textContent?.trim() ||
    !parent ||
    !style ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    Number.parseFloat(style.fontSize) === 0 ||
    hasTransparentColor(style) ||
    !hasVisibleAncestors(parent)
  ) {
    return false;
  }
  return true;
}

function hasRenderedText(body: HTMLElement) {
  const showText = body.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = body.ownerDocument.createTreeWalker(body, showText);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isRenderedTextNode(node as Text)) return true;
  }
  return false;
}

function hasRenderedEmailContent(frameDocument: Document) {
  const body = frameDocument.body;
  if (!body) return false;
  if (hasRenderedText(body)) return true;

  const hasLoadedImage = Array.from(
    body.querySelectorAll<HTMLImageElement>("img[src]")
  ).some(
    (image) =>
      image.complete &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0 &&
      isRenderedElement(image)
  );
  if (hasLoadedImage) return true;

  return Array.from(body.querySelectorAll(EMAIL_SVG_PAINT_SELECTOR)).some(
    isRenderedElement
  );
}

function buildEmailFrameSource(html: SanitizedEmailHtml) {
  const frameDocument = new DOMParser().parseFromString(
    "<!doctype html><html><head></head><body></body></html>",
    "text/html"
  );
  html.htmlAttributes.forEach(([name, value]) =>
    frameDocument.documentElement.setAttribute(name, value)
  );
  html.bodyAttributes.forEach(([name, value]) =>
    frameDocument.body.setAttribute(name, value)
  );
  frameDocument.body.setAttribute("data-octo-mail-body", "");
  frameDocument.body.innerHTML = html.bodyHtml;

  const base = frameDocument.createElement("base");
  base.href = "about:blank";
  base.target = "_blank";
  const charset = frameDocument.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const csp = frameDocument.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = EMAIL_HTML_CSP;
  const defaults = frameDocument.createElement("style");
  defaults.textContent =
    'html{color-scheme:only light;background:Canvas}html,body{margin:0;padding:0}body{color:CanvasText;background:Canvas;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}img,table{max-width:100%}img{height:auto}';
  frameDocument.head.append(base, charset, csp, defaults);
  frameDocument.head.insertAdjacentHTML("beforeend", html.headHtml);
  return `<!doctype html>${frameDocument.documentElement.outerHTML}`;
}

function EmailMessageBody({
  html,
  title,
  onEmpty,
}: {
  html: SanitizedEmailHtml;
  title: string;
  onEmpty: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const source = useMemo(() => buildEmailFrameSource(html), [html]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    let active = true;
    let widthObserver: ResizeObserver | undefined;
    const mediaCleanups: Array<() => void> = [];
    const resize = () => {
      const frameDocument = iframe.contentDocument;
      if (!frameDocument) return;
      iframe.style.height = `${EMAIL_HTML_MIN_HEIGHT}px`;
      const measured = Math.max(
        EMAIL_HTML_MIN_HEIGHT,
        frameDocument.documentElement.scrollHeight,
        frameDocument.body.scrollHeight
      );
      iframe.style.height = `${Math.min(measured, EMAIL_HTML_MAX_HEIGHT)}px`;
    };
    const refresh = () => {
      const frameDocument = iframe.contentDocument;
      if (!frameDocument?.body.hasAttribute("data-octo-mail-body")) {
        return false;
      }
      if (iframe.clientWidth <= 0) return true;
      if (!hasRenderedEmailContent(frameDocument)) {
        onEmpty();
        return false;
      }
      resize();
      return true;
    };
    const loaded = () => {
      widthObserver?.disconnect();
      while (mediaCleanups.length > 0) mediaCleanups.pop()?.();
      const frameDocument = iframe.contentDocument;
      if (!frameDocument?.body.hasAttribute("data-octo-mail-body")) return;
      if (!refresh()) return;

      frameDocument.querySelectorAll("img").forEach((image) => {
        const handleImageSettled = () => {
          if (active) refresh();
        };
        image.addEventListener("load", handleImageSettled);
        image.addEventListener("error", handleImageSettled);
        mediaCleanups.push(() => {
          image.removeEventListener("load", handleImageSettled);
          image.removeEventListener("error", handleImageSettled);
        });
      });
      void frameDocument.fonts?.ready.then(() => {
        if (active) refresh();
      });

      if (typeof ResizeObserver !== "undefined") {
        let width = iframe.clientWidth;
        widthObserver = new ResizeObserver((entries) => {
          const nextWidth = entries[0]?.contentRect.width ?? iframe.clientWidth;
          if (nextWidth === width) return;
          width = nextWidth;
          refresh();
        });
        widthObserver.observe(iframe);
      }
    };
    iframe.addEventListener("load", loaded);
    if (iframe.contentDocument?.readyState === "complete") loaded();
    return () => {
      active = false;
      iframe.removeEventListener("load", loaded);
      widthObserver?.disconnect();
      while (mediaCleanups.length > 0) mediaCleanups.pop()?.();
    };
  }, [onEmpty, source]);

  return (
    <iframe
      ref={iframeRef}
      className="octo-mail-thread-card__html-body"
      srcDoc={source}
      // Keep scripts disabled. allow-same-origin is required only for auto-sizing.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      title={title}
    />
  );
}

function EmailMessageContent({
  html,
  text,
  title,
}: {
  html?: string;
  text: string;
  title: string;
}) {
  const sanitized = useMemo(() => sanitizeEmailHtml(html || ""), [html]);
  const [emptyHtml, setEmptyHtml] = useState<SanitizedEmailHtml | null>(null);
  const useTextFallback = !sanitized || emptyHtml === sanitized;
  const handleEmpty = useCallback(() => setEmptyHtml(sanitized), [sanitized]);
  return !useTextFallback ? (
    <EmailMessageBody html={sanitized} title={title} onEmpty={handleEmpty} />
  ) : (
    <p className="octo-mail-thread-card__body">{text}</p>
  );
}

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
                {message.bodyTruncated ? (
                  <div className="octo-mail-body-truncated" role="status">
                    <AlertTriangle size={16} />
                    <span>{t("mail.reader.bodyTruncated")}</span>
                    <button
                      className="octo-mail-action octo-mail-action--bordered"
                      type="button"
                      disabled={busy}
                      onClick={() => void downloadRaw()}
                    >
                      <Download size={15} />
                      <span>{t("mail.actions.downloadRaw")}</span>
                    </button>
                  </div>
                ) : null}
                <EmailMessageContent
                  html={message.bodyHtml}
                  text={memoizedMessageText(message)}
                  title={t("mail.reader.htmlBody")}
                />
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
