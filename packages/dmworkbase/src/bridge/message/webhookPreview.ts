import type React from "react";
import type { MessageWrap } from "../../Service/Model";
import { webhookFromOfMessage } from "../../Service/IncomingWebhook";
import { isSafeUrl } from "../../Utils/security";

export interface WebhookIssuePreviewTarget {
  workspaceSlug: string;
  issueIdentifier: string;
  sourceUrl: string;
}

const FLEET_PREVIEW_HOSTS = new Set(["im.deepminer.com.cn"]);

function isTrustedFleetHost(url: URL, baseUrl: string): boolean {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  return url.origin === base.origin || FLEET_PREVIEW_HOSTS.has(url.hostname);
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

/**
 * 只把 Fleet issue 深链交给任务预览面板。这里不加载链接页面，因此允许生产域链接
 * 在本地开发环境中命中；协议仍严格限制为 http/https。
 */
export function parseWebhookIssuePreviewTarget(
  rawUrl: string,
  baseUrl = typeof window === "undefined"
    ? "https://octo.invalid"
    : window.location.href
): WebhookIssuePreviewTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }
  if (!isSafeUrl(url.href) || !isTrustedFleetHost(url, baseUrl)) return null;
  const segments = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (
    segments.length !== 4 ||
    segments[0] !== "fleet" ||
    segments[2] !== "issues"
  ) {
    return null;
  }
  const workspaceSlug = decodePathSegment(segments[1] || "");
  const issueIdentifier = decodePathSegment(segments[3] || "");
  if (!workspaceSlug || !issueIdentifier) return null;
  return { workspaceSlug, issueIdentifier, sourceUrl: url.href };
}

export function webhookPreviewClickHandler(
  message: MessageWrap,
  openPreview?: (target: WebhookIssuePreviewTarget) => void
): ((event: React.MouseEvent) => void) | undefined {
  if (!openPreview || !webhookFromOfMessage(message)) return undefined;
  return (event) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    const target = parseWebhookIssuePreviewTarget(anchor.href);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    openPreview(target);
  };
}
