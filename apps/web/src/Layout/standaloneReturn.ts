export const STANDALONE_RETURN_KEY = "octo.docs.standaloneReturn";

const STANDALONE_DOC_PATH = /^\/d\/([A-Za-z0-9_-]+)\/?$/;
const STANDALONE_SUMMARY_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/;

function parseStandaloneDocId(pathname: string): string | null {
    if (typeof pathname !== "string") return null;
    const match = STANDALONE_DOC_PATH.exec(pathname);
    return match ? match[1] : null;
}

export function persistStandaloneReturn(): void {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(
            STANDALONE_RETURN_KEY,
            window.location.pathname + window.location.search,
        );
    } catch {
        // sessionStorage unavailable: the deep-link still works, but login cannot auto-return.
    }
}

function isSafeReturnPath(path: string | null): path is string {
    if (typeof path !== "string" || path.length === 0) return false;
    if (path[0] !== "/") return false;
    // Reject control characters before URL parsing, because the URL parser can normalize them.
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
    return parseStandaloneDocId(url.pathname) !== null || STANDALONE_SUMMARY_PATH.test(url.pathname);
}

export function consumeStandaloneReturn(): string | null {
    if (typeof window === "undefined") return null;

    let raw: string | null = null;
    try {
        raw = window.sessionStorage.getItem(STANDALONE_RETURN_KEY);
        window.sessionStorage.removeItem(STANDALONE_RETURN_KEY);
    } catch {
        return null;
    }

    return isSafeReturnPath(raw) ? raw : null;
}
