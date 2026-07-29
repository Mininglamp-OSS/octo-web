import type { EnterpriseStandaloneHandler } from "virtual:octo-enterprise-modules";

// Keep the existing key so return targets written by @octo/docs on an expired
// standalone page are still consumed by the host login flow.
const STANDALONE_RETURN_KEY = "octo.docs.standaloneReturn";

const STANDALONE_DOC_PATH = /^\/d\/([A-Za-z0-9_-]+)\/?$/;
const STANDALONE_SUMMARY_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/;
const STANDALONE_SUMMARY_SHARE_PATH = /^\/s\/share\/([A-Za-z0-9_-]+)\/?$/;

type ReturnHandler = Pick<EnterpriseStandaloneHandler, "match" | "persistReturnOnAnonymous">;

function isSafeReturnPath(path: string | null, handlers: readonly ReturnHandler[]): path is string {
    if (typeof path !== "string" || path.length === 0) return false;
    if (path[0] !== "/") return false;
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(path)) return false;
    if (typeof window === "undefined") return false;

    const origin = window.location.origin;
    let url: URL;
    try {
        url = new URL(path, origin);
    } catch {
        return false;
    }
    if (url.origin !== origin) return false;

    if (STANDALONE_DOC_PATH.test(url.pathname)) return true;
    if (STANDALONE_SUMMARY_PATH.test(url.pathname)) return true;
    if (STANDALONE_SUMMARY_SHARE_PATH.test(url.pathname)) return true;
    return handlers.some((handler) => handler.persistReturnOnAnonymous && handler.match(url.pathname));
}

export function persistStandaloneReturn(): void {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(
            STANDALONE_RETURN_KEY,
            window.location.pathname + window.location.search
        );
    } catch {
        // sessionStorage unavailable: the deep-link still stays on the login page, but cannot
        // auto-return after authentication.
    }
}

export function consumeStandaloneReturn(
    handlers: readonly ReturnHandler[] = []
): string | null {
    if (typeof window === "undefined") return null;
    let raw: string | null = null;
    try {
        raw = window.sessionStorage.getItem(STANDALONE_RETURN_KEY);
        window.sessionStorage.removeItem(STANDALONE_RETURN_KEY);
    } catch {
        return null;
    }
    return isSafeReturnPath(raw, handlers) ? raw : null;
}
