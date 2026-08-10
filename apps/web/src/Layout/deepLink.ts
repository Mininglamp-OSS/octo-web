// Renderer-side receiver for the `deep-link` IPC channel wired in
// src-election/main/index.ts. The main process buffers the URL until
// did-finish-load, so the listener attached here always sees every
// dmwork:// entry — cold-boot (process.argv), second-instance argv, or
// macOS open-url after the app is running.
//
// The routing convention matches BindModule.init(): reload the shell
// with `__octo_route=<path>&<remaining query>` so the module reads the
// route via URLSearchParams and picks it up on the fresh document load.
// This works uniformly under file:// (packaged) and http(s):// (dev) —
// changing pathname directly would fail on file:// with SecurityError.

const CALLBACK_SCHEME = "dmwork:";

interface OctoIpc {
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

  const shellUrl = new URL(currentHref);
  shellUrl.searchParams.set("__octo_route", routePath);
  for (const [key, value] of parsed.searchParams) {
    // Never let a deep-link overwrite the trusted sid captured by main.ts
    // when it loaded the shell — deep-links from a compromised browser
    // could otherwise reroute applyLoginResp().save() to an attacker
    // storage bucket. sid is only writable via the loadFile query.
    if (key === "sid") continue;
    shellUrl.searchParams.set(key, value);
  }
  return shellUrl.toString();
}

/**
 * Attach the `deep-link` listener. Returns a disposer for callers that
 * unmount (Layout in the React tree). Safe to call in non-Electron
 * environments — becomes a no-op when window.ipc is absent.
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
  return () => {
    ipc.removeListener("deep-link", handler);
  };
}
