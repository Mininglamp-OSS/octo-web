import type React from "react";
import { isSafeUrl } from "../../Utils/security";
import APIClient from "../../Service/APIClient";
import { EndpointManager } from "../../Service/Module";
import { EndpointCategory } from "../../Service/Const";
import {
  getElectronIpcBridge,
  getElectronLinksBridge,
  isElectronPowered,
} from "../../electron/desktopBridge";
import { IPC_ASK_TRUST_FLEET_HOST } from "../../../../../apps/web/src-election/shared/ipc-channels";
import { resolveWebOrigin } from "../../Utils/webOrigin";

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

/**
 * RFC 3986 unreserved characters plus ~ — the only characters we accept in
 * a decoded fleet segment. Anything else (encoded separators like %2F/%5C,
 * CR/LF, .., whitespace) means the decoded value is NOT the same segment the
 * shape gate matched, so the link is rejected: without this, a crafted
 * /fleet/a%2F..%2Fb/issues/c%0D%0Ad would pass the 4-segment shape check and
 * decode into path separators / traversal afterwards.
 */
const SAFE_FLEET_SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;

function decodePathSegment(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return SAFE_FLEET_SEGMENT_RE.test(decoded) ? decoded : null;
}

/**
 * Lazily resolve the trusted fleet origins: the static set plus the origin
 * host (hostname[:port]) of the API the client is talking to (VITE_API_URL at
 * build time). Desktop clients load over file:// where same-origin comparison
 * against window.location is impossible (the origin is not a web origin —
 * Chromium reports "file://", older specs/jsdom "null"), so the API host is
 * the only
 * reliable per-deployment baseline; on-prem customers get previews for their
 * own server without hard-coding every customer domain.
 *
 * Trust keys are `URL.host` values (hostname + non-default port). WHATWG URL
 * normalizes an explicit default port away (`https://x:443/` → host "x"), so
 * the key for an origin is stable whether or not the port was spelled out,
 * and a non-default port (on-prem `:8443`) is part of the identity: trusting
 * `x:8443` must never trust `x` or `x:9999`.
 */
export function trustedFleetHosts(): Set<string> {
  const hosts = new Set(FLEET_PREVIEW_HOSTS);
  try {
    const apiURL = APIClient.shared?.config?.apiURL;
    if (apiURL) hosts.add(new URL(apiURL).host);
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
  // Same-origin comparison also works across the http/https boundary (on-prem
  // deployments reached externally via HTTPS while the backend emits HTTP
  // Fleet URLs). Both clauses compare full `URL.host` values (hostname +
  // non-default port), so a trusted origin cannot be re-pointed at a
  // different port on the same hostname — the port is part of the key.
  if (url.host === base.host) return true;
  return trustedFleetHosts().has(url.host);
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
  // Reject embedded userinfo (https://evil@trusted-host/…): the host
  // comparison below would match the trusted host while the serialized
  // href still carries the userinfo into the preview panel / fallback link.
  // Userinfo is deprecated in URLs and never legitimate on a fleet link.
  if (url.username !== "" || url.password !== "") return null;
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
 * Open a fleet link in the system browser / new tab as the explicit fallback
 * for a rejected trust prompt. On desktop this goes through the
 * IPC_OPEN_EXTERNAL_URL bridge (sender-checked, http(s)-only, activation-
 * independent — window.open after an await has lost user activation and may
 * be suppressed by popup blockers); on web it falls back to window.open.
 * Exported so tests can observe the fallback without fighting jsdom's
 * non-configurable window.open.
 */
export function openFleetLinkExternal(href: string): void {
  const linksBridge = getElectronLinksBridge();
  if (linksBridge) {
    void linksBridge.openExternal(href).catch(() => {
      // best-effort: the default action was already cancelled; failing to
      // re-open must not throw
    });
    return;
  }
  try {
    window.open(href, "_blank", "noopener,noreferrer");
  } catch {
    // noop: caller has already cancelled the default action; failing to
    // re-open must not break the click
  }
}

/**
 * Origin of the API the client is talking to (VITE_API_URL at build time),
 * or "" when unset/malformed. Desktop shells load over file:// where
 * window.location.origin is not a web origin, so renderer code that builds
 * absolute URLs for the system browser (doc /d/ links, …) resolves against
 * this. Thin wrapper over Utils/webOrigin (doc origin when http(s), API
 * origin otherwise).
 */
export function apiUrlOrigin(): string {
  return resolveWebOrigin(
    typeof window === "undefined" ? undefined : window.location?.origin,
    APIClient.shared?.config?.apiURL,
  );
}

/**
 * The fleet preview panel needs a registered renderer (the enterprise Loop
 * module registers `chatWebhookIssuePreview`). Without one the click would
 * open a dead "unavailable" panel instead of the link — so in OSS builds the
 * handler is disabled entirely and fleet links keep their default behaviour
 * (system browser on desktop / new tab on web). Kept as a function so tests
 * can control the outcome via EndpointManager.
 */
export function isFleetPreviewSupported(): boolean {
  return (
    (EndpointManager.shared.getWithCategory(EndpointCategory.chatWebhookIssuePreview)
      ?.length ?? 0) > 0
  );
}

/**
 * Module-scoped in-flight guard shared by every handler instance. A
 * per-handler Set (created in the render factory) is rebuilt on each
 * re-render, which lets a re-render between the click and the trust prompt
 * resolve re-enter the prompt path and fan out a duplicate preview/fallback.
 * Keyed on sourceUrl, so the guard is naturally per-link across messages.
 * A stale entry (IPC never settles, e.g. a wedged dialog) would lock the
 * link forever, so entries time out after FLEET_PROMPT_TIMEOUT_MS.
 */
const pendingFleetPrompts = new Map<string, number>();
const FLEET_PROMPT_TIMEOUT_MS = 30_000;

function isPendingFleetPrompt(sourceUrl: string): boolean {
  const startedAt = pendingFleetPrompts.get(sourceUrl);
  if (startedAt === undefined) return false;
  if (Date.now() - startedAt > FLEET_PROMPT_TIMEOUT_MS) {
    pendingFleetPrompts.delete(sourceUrl);
    return false;
  }
  return true;
}

/**
 * Route message-body clicks on Fleet issue deep links to the in-app task
 * preview panel — for BOTH webhook messages and plain user messages. One
 * shared handler covers left-click (`click`, button 0) and middle-click
 * (`auxclick`, button 1); the trust model is:
 * - statically trusted origin (same origin / static set / current API host)
 *   → open the preview immediately, fully synchronously;
 * - unknown origin on desktop → cancel the default action synchronously,
 *   resolve trust via the native prompt, and on rejection explicitly re-open
 *   the link (the default action is already cancelled, it cannot "fall
 *   through" on its own);
 * - unknown origin on web → no prompt bridge exists, so the link is left to
 *   the browser's default action (new tab) without preventDefault, which
 *   keeps popup-blocker heuristics (Safari) on our side.
 */
export function fleetPreviewClickHandler(
  openPreview?: (target: WebhookIssuePreviewTarget) => void,
  onRejectedFallback: (href: string) => void = openFleetLinkExternal,
): ((event: React.MouseEvent) => void) | undefined {
  if (!openPreview) return undefined;
  // OSS / any build without a registered preview renderer must not
  // intercept fleet links (see isFleetPreviewSupported), BUT the handler
  // must still exist: MessageRow renders its hit-area wrapper only when a
  // body handler is present, and webhook messages always had that wrapper
  // before this PR. Returning undefined here would strip the wrapper from
  // every message in OSS builds (regression). The handler therefore stays
  // mounted and simply never intercepts — links fall through to their
  // default behaviour.
  const previewSupported = isFleetPreviewSupported();
  return (event) => {
    // Filter by event type AND button: `click` must be the primary button (0),
    // `auxclick` must be the middle button (1). Firefox dispatches BOTH
    // click(button=1) and auxclick(button=1) for one middle click — without
    // the type split the shared handler would run twice per gesture. The
    // secondary button (2, right click) is never intercepted: its intent is
    // the context menu (copy link address etc.).
    const isAuxClick = event.type === "auxclick";
    if (isAuxClick ? event.button !== 1 : event.button !== 0) return;
    // Modifier-key clicks are deliberate browser-navigation gestures
    // (Cmd/Ctrl-click → new tab, Shift-click → new window, Alt-click →
    // download): the user explicitly opted out of in-app handling, so the
    // link must keep its default behaviour untouched.
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    const baseUrl =
      typeof window === "undefined" ? "https://octo.invalid" : window.location.href;
    // Decide the candidate synchronously. Non-fleet links are never touched.
    const target = parseFleetIssueLinkShape(anchor.href, baseUrl);
    if (!target) return;
    // OSS / no preview renderer: the handler stays mounted (keeps the
    // hit-area wrapper) but never intercepts — fleet links fall through to
    // their default behaviour (system browser / new tab).
    if (!previewSupported) return;
    const staticallyTrusted =
      parseWebhookIssuePreviewTarget(anchor.href, baseUrl) !== null;
    // Web has no trust prompt: an unknown-origin fleet link goes to the
    // browser default (new tab) untouched. preventDefault here would leave
    // the fallback window.open() at the mercy of popup blockers.
    if (!staticallyTrusted && !isElectronPowered()) return;
    // Cancel the default action NOW, synchronously: preventDefault after an
    // await would be a no-op (the anchor already navigated / opened a tab).
    event.preventDefault();
    event.stopPropagation();
    if (staticallyTrusted) {
      openPreview(target);
      return;
    }
    void (async () => {
      if (isPendingFleetPrompt(target.sourceUrl)) return;
      pendingFleetPrompts.set(target.sourceUrl, Date.now());
      try {
        const trusted = await askTrustFleetHost(target.sourceUrl);
        // Explicit fallback rather than "relying on the default action": the
        // default action was already cancelled above. Routed through the
        // onRejectedFallback parameter (not a direct module-internal call) so
        // tests can inject an observer; ESM internal bindings bypass the
        // module namespace, making them invisible to vi.spyOn.
        if (!trusted) {
          onRejectedFallback(target.sourceUrl);
          return;
        }
        openPreview(target);
      } finally {
        pendingFleetPrompts.delete(target.sourceUrl);
      }
    })();
  };
}
