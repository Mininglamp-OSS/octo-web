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

/**
 * Port policy for trusted hosts: a trusted hostname only matches on its
 * default port (no explicit port, or the well-known http/https ports). Any
 * other port, e.g. https://im-test.deepminer.com.cn:9999/..., is treated as
 * untrusted so a trusted host cannot be re-pointed at an attacker service.
 */
function isDefaultPort(url: URL): boolean {
  const port = url.port;
  if (port === "") return true;
  if (url.protocol === "http:" && port === "80") return true;
  if (url.protocol === "https:" && port === "443") return true;
  return false;
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
  // Fleet URLs). Explicit ports are rejected: url.host includes the port, so
  // a non-default port already fails this first clause; the trusted-host
  // clause below additionally requires a default port.
  if (url.host === base.host) return true;
  return trustedFleetHosts().has(url.hostname) && isDefaultPort(url);
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
 * Pure structural parsing: protocol safety + fleet path shape + slug/ident
 * extraction. Does NOT make a trust decision; callers decide trust (sync
 * parseWebhookIssuePreviewTarget or the async prompt in the click handler).
 */
export function parseFleetIssueLinkShape(
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

/**
 * Full gate for synchronous callers (webhook adaptive-card Action.OpenUrl):
 * structure + static trust (same host / static set / current API host). This
 * keeps the host allowlist enforced on every path that opens a preview
 * without an async user prompt. Unknown hosts return null here so the caller
 * falls through to its own default (open the URL externally).
 */
export function parseWebhookIssuePreviewTarget(
  rawUrl: string,
  baseUrl = typeof window === "undefined"
    ? "https://octo.invalid"
    : window.location.href,
): WebhookIssuePreviewTarget | null {
  const target = parseFleetIssueLinkShape(rawUrl, baseUrl);
  if (!target) return null;
  let url: URL;
  try {
    url = new URL(target.sourceUrl, baseUrl);
  } catch {
    return null;
  }
  if (!isTrustedFleetHost(url, baseUrl)) return null;
  return target;
}

/**
 * Ask the Electron main process to confirm trusting an unknown fleet host
 * (modal + optional "never ask again" persisted in userData). Non-Electron
 * renderers (web) have no dialog bridge and fall back to rejecting.
 */
export async function askTrustFleetHost(sourceUrl: string): Promise<boolean> {
  if (!isElectronPowered()) return false;
  const ipc = getElectronIpcBridge();
  if (!ipc) return false;
  try {
    const result = (await ipc.invoke(IPC_ASK_TRUST_FLEET_HOST, sourceUrl)) as
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
  return askTrustFleetHost(url.href);
}

/**
 * Open a fleet link in the system browser / new tab as the explicit fallback
 * for a rejected trust prompt. Exported so tests can observe the fallback
 * without fighting jsdom's non-configurable window.open.
 */
export function openFleetLinkExternal(href: string): void {
  try {
    window.open(href, "_blank", "noopener,noreferrer");
  } catch {
    // noop: caller has already cancelled the default action; failing to
    // re-open must not break the click
  }
}

/**
 * Only give Fleet issue deep links to the task preview panel. Structural
 * parsing (parseFleetIssueLinkShape) is sync; the trust decision is async
 * (static trust is sync-fast, an unknown host prompts on desktop).
 */
export function webhookPreviewClickHandler(
  message: MessageWrap,
  openPreview?: (target: WebhookIssuePreviewTarget) => void,
  onRejectedFallback: (href: string) => void = openFleetLinkExternal,
): ((event: React.MouseEvent) => void) | undefined {
  if (!openPreview || !webhookFromOfMessage(message)) return undefined;
  return (event) => {
    // Handles BOTH left-click (click) and middle-click (auxclick, button === 1)
    // with one shared handler: click carries button 0, a middle-click auxclick
    // carries button 1. Desktop users often middle-click a link expecting a
    // new tab; for a fleet preview link that would bypass the in-app panel and
    // open a raw window / browser navigation, so intercepting auxclick keeps
    // the preview semantics. auxclick ALSO fires for the secondary button
    // (button 2, right click): its intent is the context menu (copy link
    // address etc.) and must fall through untouched, so anything other than
    // button 0/1 returns early.
    if (event.button !== 0 && event.button !== 1) return;
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    const baseUrl =
      typeof window === "undefined" ? "https://octo.invalid" : window.location.href;
    // Decide the candidate synchronously and cancel the default action NOW:
    // preventDefault after an await would be a no-op (the anchor already
    // started navigating / opening a new tab), which is why the async trust
    // resolution below must not be in charge of the first interception.
    const target = parseFleetIssueLinkShape(anchor.href, baseUrl);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      const trusted = await isTrustedFleetHostAllowPrompt(
        new URL(anchor.href),
        baseUrl,
      );
      // Explicit fallback rather than "relying on the default action": the
      // default action was already cancelled above. Routed through the
      // onRejectedFallback parameter (not a direct module-internal call) so
      // tests can inject an observer; ESM internal bindings bypass the
      // module namespace, making them invisible to vi.spyOn.
      if (!trusted) {
        onRejectedFallback(anchor.href);
        return;
      }
      openPreview(target);
    })();
  };
}
