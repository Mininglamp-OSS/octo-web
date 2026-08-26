import { extractErrorMsg } from "@octo/base/src/Service/APIClient";
import type { MessageDetail } from "./bridge/types";

export const agentMailboxLocalpartMinLength = 5;
export const agentMailboxLocalpartMaxLength = 64;

const agentMailboxLocalpartPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const reservedAgentMailboxLocalparts = new Set([
  "abuse",
  "admin",
  "administrator",
  "hostmaster",
  "mailer-daemon",
  "noc",
  "postmaster",
  "root",
  "security",
  "webmaster",
]);

export function isValidAgentMailboxLocalpart(value: string): boolean {
  const localpart = value.trim().toLowerCase();
  return (
    localpart.length >= agentMailboxLocalpartMinLength &&
    localpart.length <= agentMailboxLocalpartMaxLength &&
    agentMailboxLocalpartPattern.test(localpart) &&
    !localpart.includes("..") &&
    !reservedAgentMailboxLocalparts.has(localpart)
  );
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return extractErrorMsg(error) || fallback;
}

export function splitAddresses(value: string): string[] {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const messageBlockTags = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "dt",
  "dd",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "textarea",
  "tr",
  "td",
  "th",
  "ul",
]);

const ignoredMessageTags = new Set([
  "head",
  "noscript",
  "script",
  "style",
  "template",
]);

// HTML parsing replaces NUL characters from the source, so these internal
// markers cannot collide with untrusted message text.
const messageBlockBoundary = "\0octo-mail-block\0";
const messageLineBreak = "\0octo-mail-br\0";

function preformattedPlaceholder(index: number): string {
  return `\0octo-mail-pre-${index}\0`;
}

const preformattedPlaceholderPattern = /\u0000octo-mail-pre-(\d+)\u0000/g;

type MessageWhitespaceMode = "normal" | "preserve" | "preserve-breaks";
type MessageVisibility = "visible" | "hidden";

function resolveMessageWhitespaceMode(
  element: Element,
  inherited: MessageWhitespaceMode
): MessageWhitespaceMode {
  // Only inline whitespace declarations are recoverable here. Message style
  // elements are intentionally ignored and this detached document has no
  // reliable computed style.
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  switch (style?.whiteSpace?.trim().toLowerCase()) {
    case "normal":
    case "nowrap":
      return "normal";
    case "pre-line":
      return "preserve-breaks";
    case "pre":
    case "pre-wrap":
    case "break-spaces":
      return "preserve";
    default:
      return element.tagName.toLowerCase() === "pre" ||
        element.tagName.toLowerCase() === "textarea"
        ? "preserve"
        : inherited;
  }
}

function normalizeWhitespaceForMode(
  value: string,
  mode: MessageWhitespaceMode
): string {
  if (mode === "preserve") return value;
  if (mode === "preserve-breaks") {
    return value.replace(/[\t\f\v ]+/g, " ");
  }
  return value.replace(/[\t\f\v\n ]+/g, " ");
}

function trimSyntheticBlockBoundaries(value: string): string {
  let trimmed = value;
  while (trimmed.startsWith(messageBlockBoundary)) {
    trimmed = trimmed.slice(messageBlockBoundary.length);
  }
  while (trimmed.endsWith(messageBlockBoundary)) {
    trimmed = trimmed.slice(0, -messageBlockBoundary.length);
  }
  return trimmed;
}

function normalizePreservedBlockBoundaries(value: string): string {
  return value.replace(
    /(?:\u0000octo-mail-block\u0000)+/g,
    (sequence, offset: number, source: string) => {
      const previous = source[offset - 1];
      const next = source[offset + sequence.length];
      return previous === "\n" || next === "\n" ? "" : "\n";
    }
  );
}

function extractMessageNodeText(
  node: Node,
  preformattedBlocks: string[],
  inheritedMode: MessageWhitespaceMode = "normal",
  inheritedVisibility: MessageVisibility = "visible"
): string {
  if (node.nodeType === 3) {
    if (inheritedVisibility === "hidden") return "";
    const value = (node.nodeValue || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n");
    return normalizeWhitespaceForMode(value, inheritedMode);
  }
  if (node.nodeType !== 1) return "";

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (ignoredMessageTags.has(tag)) return "";
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const display = style?.display?.trim().toLowerCase();
  if (element.hasAttribute("hidden") || display === "none") return "";
  const declaredVisibility = style?.visibility?.trim().toLowerCase();
  const visibility: MessageVisibility =
    declaredVisibility === "visible"
      ? "visible"
      : declaredVisibility === "hidden" || declaredVisibility === "collapse"
      ? "hidden"
      : inheritedVisibility;
  if (tag === "br") return visibility === "visible" ? messageLineBreak : "";

  const mode = resolveMessageWhitespaceMode(element, inheritedMode);

  let content = Array.from(node.childNodes)
    .map((child) =>
      extractMessageNodeText(child, preformattedBlocks, mode, visibility)
    )
    .join("");

  if (mode !== inheritedMode) {
    if (mode === "normal") {
      content = normalizeMessageSeparators(content).replace(/[\t\f\v ]+/g, " ");
      if (messageBlockTags.has(tag)) content = content.trim();
    } else {
      const normalized = normalizeWhitespaceForMode(
        normalizeMessageSeparators(
          normalizePreservedBlockBoundaries(
            trimSyntheticBlockBoundaries(content)
          )
        ),
        mode
      );
      if (!normalized) {
        content = "";
      } else {
        const index = preformattedBlocks.push(normalized) - 1;
        content = preformattedPlaceholder(index);
      }
    }
  }

  return messageBlockTags.has(tag)
    ? `${messageBlockBoundary}${content}${messageBlockBoundary}`
    : content;
}

function normalizeMessageSeparators(value: string): string {
  return value.replace(
    /(?:(?:\u0000octo-mail-block\u0000|\u0000octo-mail-br\u0000)[\t\f\v ]*)+/g,
    (sequence) => {
      const explicitLineBreaks =
        sequence.match(/\u0000octo-mail-br\u0000/g)?.length ?? 0;
      return "\n".repeat(Math.max(1, explicitLineBreaks));
    }
  );
}

export function getMessageText(message: MessageDetail): string {
  if (message.bodyText?.trim()) return message.bodyText;
  if (!message.bodyHtml) return message.preview || "";
  if (typeof DOMParser === "undefined") return message.preview || "";

  const document = new DOMParser().parseFromString(
    message.bodyHtml,
    "text/html"
  );
  document
    .querySelectorAll("head, noscript, script, style, template")
    .forEach((element) => element.remove());
  const preformattedBlocks: string[] = [];

  let text = normalizeMessageSeparators(
    extractMessageNodeText(document.body, preformattedBlocks).replace(
      /\r\n?/g,
      "\n"
    )
  )
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const resolvedPreformattedBlocks: string[] = [];
  for (const block of preformattedBlocks) {
    resolvedPreformattedBlocks.push(
      block.replace(
        preformattedPlaceholderPattern,
        (placeholder, rawIndex: string) =>
          resolvedPreformattedBlocks[Number(rawIndex)] ?? placeholder
      )
    );
  }
  text = text.replace(
    preformattedPlaceholderPattern,
    (placeholder, rawIndex: string) =>
      resolvedPreformattedBlocks[Number(rawIndex)] ?? placeholder
  );
  return text.trim() ? text : message.preview || "";
}

export function hasKeyword(keywords: string[], keyword: string): boolean {
  return keywords.some((item) => item.toLowerCase() === keyword.toLowerCase());
}

export function formatMessageDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function getInitial(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized[0].toUpperCase() : "?";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
