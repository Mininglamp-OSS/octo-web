export const LOOP_CLI_AUTHORIZE_PATH = "/loop/cli-authorize";

const PENDING_SEARCH_KEY = "octo.loop.cli-authorize.pending-search";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function isLoopCliAuthorizePath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === LOOP_CLI_AUTHORIZE_PATH;
}

/**
 * Preserve the CLI callback while Octo's RouteManager replaces the live query
 * string with a sid-only URL. The pending value also survives the full reload
 * performed after an interactive login.
 */
export function resolveLoopCliAuthorizeSearch(
  pathname: string,
  search: string,
  sessionStore: SessionStorageLike
): string {
  if (!isLoopCliAuthorizePath(pathname)) return search;

  const params = new URLSearchParams(search);
  if (params.get("cli_callback")) {
    try {
      sessionStore.setItem(PENDING_SEARCH_KEY, search);
    } catch {
      // Session storage may be unavailable in hardened browser contexts.
    }
    return search;
  }

  try {
    return sessionStore.getItem(PENDING_SEARCH_KEY) || search;
  } catch {
    return search;
  }
}

export function clearPendingLoopCliAuthorizeSearch(
  sessionStore: SessionStorageLike
): void {
  try {
    sessionStore.removeItem(PENDING_SEARCH_KEY);
  } catch {
    // Best-effort cleanup; redirecting to the loopback callback remains safe.
  }
}

export function visibleLoopCliAuthorizeSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("cli_callback");
  params.delete("cli_state");
  const visible = params.toString();
  return visible ? `?${visible}` : "";
}
