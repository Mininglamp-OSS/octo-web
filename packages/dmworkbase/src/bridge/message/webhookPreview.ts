import type React from "react";
import type { MessageWrap } from "../../Service/Model";
import { webhookFromOfMessage } from "../../Service/IncomingWebhook";
import { isSafeUrl } from "../../Utils/security";
import APIClient from "../../Service/APIClient";
import {
  getElectronIpcBridge,
  isElectronPowered,
} from "../../electron/desktopBridge";
import { IPC_ASK_TRUST_FLEET_HOST } from "../../../../../apps/web/src-election/shared/ipc-channels";

export interface WebhookIssuePreviewTarget {
  workspaceSlug: string;
  issueIdentifier: string;
  sourceUrl: string;
}

/**
 * Static fallback hosts. Kept for compatibility with deployments that are
 * reachable under a known canonical host; the authoritative trusted host is
 * the API origin the client is currently logged into (see trustedFleetHosts).
 */
const FLEET_PREVIEW_HOSTS = new Set(["im.deepminer.com.cn"]);

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

/**
 * Lazily resolve the trusted fleet hosts: the static set plus the host of the
 * API the client is talking to (VITE_API_URL at build time). Desktop clients
 * load over file:// where same-origin comparison against window.location is
 * impossible ("null"), so the API host is the only reliable per-deployment
 * baseline; on-prem customers get previews for their own server without
 * hard-coding every customer domain.
 */
export function trustedFleetHosts(): Set<string> {
  const hosts = new Set(FLEET_PREVIEW_HOSTS);
  try {
    const apiURL = APIClient.shared?.config?.apiURL;
    if (apiURL) hosts.add(new URL(apiURL).hostname);
  } catch {
    // ignore malformed apiURL
  }
  return hosts;
}

function isTrustedFleetHost(url: URL, baseUrl: string): boolean {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  // Same-host comparison also works across the http/https boundary (on-prem
  // deployments reached externally via HTTPS while the backend emits HTTP
  // Fleet URLs). Explicit ports are rejected because host excludes them.
  return (
    url.host === base.host || trustedFleetHosts().has(url.hostname)
  );
}

function isFleetIssuePathname(url: URL): boolean {
  const segments = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  return (
    segments.length === 4 &&
    segments[0] === "fleet" &&
    segments[2] === "issues"
  );
}

/**
 * Ask the Electron main process to confirm trusting an unknown fleet host
 * (modal + optional "never ask again" persisted in userData). Non-Electron
 * renderers (web) have no dialog bridge and fall back to rejecting.
 */
export async function askTrustFleetHost(
  sourceUrl: string,
  host: string,
): Promise<boolean> {
  if (!isElectronPowered()) return false;
  const ipc = getElectronIpcBridge();
  if (!ipc) return false;
  try {
    const result = (await ipc.invoke(IPC_ASK_TRUST_FLEET_HOST, sourceUrl, host)) as
      | { trusted: boolean }
      | undefined;
    return result?.trusted === true;
  } catch {
    return false;
  }
}

/**
 * Trust decision for a click. Static/same-host trust wins immediately; for a
 * well-formed fleet link on an unknown host the user is asked once (Electron),
 * and the answer is remembered when they checked "never ask again".
 */
async function isTrustedFleetHostAllowPrompt(
  url: URL,
  baseUrl: string,
): Promise<boolean> {
  if (isTrustedFleetHost(url, baseUrl)) return true;
  if (!isFleetIssuePathname(url)) return false; // non-fleet links never prompt
  return askTrustFleetHost(url.href, url.hostname);
}

/**
 * 只把 Fleet issue 深链交给任务预览面板。这里不加载链接页面，因此允许生产域链接
 * 在本地开发环境中命中；协议仍严格限制为 http/https。结构解析与信任判定分离：
 * 结构合法但 host 未知的链接由 webhookPreviewClickHandler 走异步确认弹窗。
 */
export function parseWebhookIssuePreviewTarget(
  rawUrl: string,
  baseUrl = typeof window === "undefined"
    ? "https://octo.invalid"
    : window.location.href,
): WebhookIssuePreviewTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }
  if (!isSafeUrl(url.href) || !isFleetIssuePathname(url)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const workspaceSlug = decodePathSegment(segments[1] || "");
  const issueIdentifier = decodePathSegment(segments[3] || "");
  if (!workspaceSlug || !issueIdentifier) return null;
  return { workspaceSlug, issueIdentifier, sourceUrl: url.href };
}

export function webhookPreviewClickHandler(
  message: MessageWrap,
  openPreview?: (target: WebhookIssuePreviewTarget) => void,
): ((event: React.MouseEvent) => void) | undefined {
  if (!openPreview || !webhookFromOfMessage(message)) return undefined;
  return (event) => {
    // Handles BOTH left-click (click) and middle-click (auxclick, button === 1).
    // Desktop users often middle-click a link expecting a new tab; for a fleet
    // preview link that would bypass the in-app panel and open a raw window /
    // browser navigation. Intercepting auxclick keeps the preview semantics:
    // the fleet link opens the embedded task preview just like a left click.
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    void (async () => {
      const target = parseWebhookIssuePreviewTarget(anchor.href);
      if (!target) return;
      const trusted = await isTrustedFleetHostAllowPrompt(
        new URL(anchor.href),
        typeof window === "undefined" ? "https://octo.invalid" : window.location.href,
      );
      if (!trusted) return; // fall through to the default link behavior
      event.preventDefault();
      event.stopPropagation();
      openPreview(target);
    })();
  };
}