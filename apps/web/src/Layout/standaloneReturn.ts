import type { EnterpriseStandaloneHandler } from "virtual:octo-enterprise-modules";

// Keep the existing key so return targets written by @octo/docs on an expired
// standalone page are still consumed by the host login flow.
const STANDALONE_RETURN_KEY = "octo.docs.standaloneReturn";

const STANDALONE_DOC_PATH = /^\/d\/([A-Za-z0-9_-]+)\/?$/;
const STANDALONE_SUMMARY_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/;
const STANDALONE_SUMMARY_SHARE_PATH = /^\/s\/share\/([A-Za-z0-9_-]+)\/?$/;

// `/drive/s/:token` and `/drive/invite/:token` — drive share / space-invite landings
// (PR#1146 N2). Both require login: a signed-in user who opens the link while logged
// out is bounced back here after sign-in. Matches a SINGLE path segment before decode
// (no `/`, `?`, `#`); isSafeDriveLandingPath then decodes and re-checks the token so an
// encoded slash / control char / malformed %-escape / extra segment can't smuggle
// redirect structure past this allowlist. Narrow on purpose — never arbitrary `/drive/*`.
const STANDALONE_DRIVE_PATH = /^\/drive\/(?:s|invite)\/([^/?#]+)\/?$/;

function isSafeDriveLandingPath(pathname: string): boolean {
    const m = STANDALONE_DRIVE_PATH.exec(pathname);
    if (!m) return false;
    let token: string;
    try {
        token = decodeURIComponent(m[1]);
    } catch {
        return false;
    }
    if (token.length === 0) return false;
    // eslint-disable-next-line no-control-regex
    return !/[/\\?#\x00-\x1f\x7f]/.test(token);
}

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
    if (isSafeDriveLandingPath(url.pathname)) return true;
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

/**
 * Delete the stashed standalone return target without navigating or validating it.
 *
 * The R8 up-front stash (prepareDriveLandingReturn) fires for a VALID signed-in landing
 * render too, not just the expired/anonymous chain. Left in place, that residue outlives the
 * page: if the same tab later logs out and a DIFFERENT account signs in, onLogin's
 * consumeStandaloneReturn would replay the previous user's share/invite deep-link across
 * identities (an invite would even auto-accept). A landing page whose first real API call
 * succeeds has proven the current session is valid, so the stash is no longer needed to
 * recover from a 401 — clear it (PR#1146 R9 P1). Only removes the key; the anonymous/expired
 * chain never reaches an API success, so its stash survives to drive the post-login return.
 */
export function clearStandaloneReturn(): void {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.removeItem(STANDALONE_RETURN_KEY);
    } catch {
        // sessionStorage unavailable: nothing was stashed, nothing to clear.
    }
}

/**
 * Gate a drive share/invite standalone landing: stash the deep-link return target FIRST,
 * then report whether a session is available to render the landing page.
 *
 * Stashing up-front — not only in the anonymous fall-through — closes the expired-session
 * hole (PR#1146 R8 P1). An expired stored token still satisfies the caller's token check and
 * renders the landing, whose API then 401s → global logout → hard redirect to login; without
 * an up-front stash the deep-link was never saved and sign-in dropped the user at the app
 * root. A valid signed-in render stashes once more harmlessly: consumeStandaloneReturn
 * re-validates and deletes, and only the onLogin flow consumes it, so a plain render performs
 * no navigation (no redirect loop). persist runs before resolveSession so a throw/short-circuit
 * while resolving the session can never skip the stash.
 *
 * @param resolveSession Runs the branch's load→recover sequence; returns whether a token is
 *   now present (i.e. the landing page should render).
 * @param persist Injectable for tests; defaults to persistStandaloneReturn.
 */
export function prepareDriveLandingReturn(
    resolveSession: () => boolean,
    persist: () => void = persistStandaloneReturn,
): boolean {
    persist();
    return resolveSession();
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
