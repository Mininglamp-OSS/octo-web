// Renderer-side receiver for the `deep-link` IPC channel wired in
// src-election/main/index.ts. The main process buffers URLs and waits for
// the `deep-link-ready` signal before flushing, so the listener attached
// here is guaranteed to see every dmwork:// entry — cold-boot
// (process.argv), second-instance argv, or macOS open-url after the app
// is running.
//
// The routing convention matches BindModule.init(): reload the shell
// with `__octo_route=<path>&<remaining query>` so the module reads the
// route via URLSearchParams and picks it up on the fresh document load.
// This works uniformly under file:// (packaged) and http(s):// (dev) —
// changing pathname directly would fail on file:// with SecurityError.

import { consumePendingBindIfMatches } from "@octo/login";

const CALLBACK_SCHEME = "dmwork:";
const IPC_DEEP_LINK_READY = "deep-link-ready";
const BIND_ROUTE = "/oidc/bind";

interface OctoIpc {
  send?: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  removeListener: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void
  ) => void;
}

function getIpc(): OctoIpc | undefined {
  const w = window as unknown as { ipc?: OctoIpc };
  return w.ipc;
}

/**
 * Convert `dmwork://oidc/bind?token=abc&sid=xyz` into a reload URL that
 * BindModule.init() will accept:
 *   file:///.../index.html?__octo_route=/oidc/bind&token=abc&sid=xyz
 *
 * Any keys the deep-link supplies overwrite the shell's current query,
 * matching how OIDC callbacks replace the pre-existing search string.
 *
 * The `/oidc/bind` route is only accepted when this client has recently
 * called startOidcLogin() — the persisted pending-bind marker proves the
 * flow originated in this app. Without that check, registering `dmwork://`
 * as an OS-level scheme handler would let any web page trigger the bind
 * page against a signed-in victim by simply navigating to
 * `dmwork://oidc/bind?token=ATTACKER_BIND_TOKEN` (see review round 5 P1-2).
 */
export function buildShellUrlForDeepLink(
  deepLinkUrl: string,
  currentHref: string,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(deepLinkUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== CALLBACK_SCHEME) return null;

  // `dmwork://oidc/bind` → host=oidc, pathname=/bind → route=/oidc/bind.
  // Trailing slash is stripped so `dmwork://oidc/bind/` still matches
  // BindModule.init()'s exact-equality check on `__octo_route`.
  const host = parsed.host.replace(/\/+$/, "");
  const path = parsed.pathname.replace(/^\/+/, "/");
  const routePath =
    "/" +
    [host, path.replace(/^\/+/, "")]
      .filter(Boolean)
      .join("/")
      .replace(/\/+$/, "");

  if (
    routePath === BIND_ROUTE &&
    !consumePendingBindIfMatches({
      providerId: parsed.searchParams.get("provider") ?? undefined,
      authcode: parsed.searchParams.get("authcode") ?? undefined,
    })
  ) {
    // No locally-initiated OIDC flow in the last OIDC_AUTHCODE_TTL_MS.
    // Reject rather than silently strand the user on the bind page with an
    // attacker-supplied token.
    return null;
  }

  const shellUrl = new URL(currentHref);
  shellUrl.searchParams.set("__octo_route", routePath);
  for (const [key, value] of parsed.searchParams) {
    // Never let a deep-link overwrite the trusted sid captured by main.ts
    // when it loaded the shell — deep-links from a compromised browser
    // could otherwise reroute applyLoginResp().save() to an attacker
    // storage bucket. sid is only writable via the loadFile query.
    // The route is derived from the validated protocol host/path above. Do
    // not let a query parameter replace that trusted value (for example
    // `dmwork://oidc/bind?__octo_route=/login`).
    if (key === "sid" || key === "__octo_route") continue;
    shellUrl.searchParams.set(key, value);
  }
  return shellUrl.toString();
}

/**
 * Attach the `deep-link` listener and announce readiness to the main
 * process so any buffered URLs are flushed. Returns a disposer for
 * callers that unmount (Layout in the React tree). Safe to call in
 * non-Electron environments — becomes a no-op when window.ipc is absent.
 */
export function registerDeepLinkHandler(): () => void {
  const ipc = getIpc();
  if (!ipc) return () => undefined;

  const handler = (_event: unknown, ...args: unknown[]) => {
    const url = typeof args[0] === "string" ? args[0] : "";
    if (!url) return;
    const next = buildShellUrlForDeepLink(url, window.location.href);
    if (!next) return;
    window.location.replace(next);
  };

  ipc.on("deep-link", handler);
  // Tell main it can flush the buffer now. Main resets its readiness flag
  // on every `did-start-loading`, so this must run after every mount —
  // including after an OIDC-callback shell reload.
  try {
    ipc.send?.(IPC_DEEP_LINK_READY);
  } catch {
    // Preload not attached / channel not allowed: leave the buffer with
    // main; it will flush on the next navigation if the environment
    // recovers.
  }
  return () => {
    ipc.removeListener("deep-link", handler);
  };
}
