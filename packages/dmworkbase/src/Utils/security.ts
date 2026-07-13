/**
 * URL protocol validation to prevent XSS attacks
 * Only allows http: and https: protocols
 */
export function isSafeUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
}

/**
 * Stricter check for image-like surfaces rendered inside HTTPS web pages.
 *
 * `isSafeUrl` allows both http and https, which is fine for link clicks
 * (opened in a new context). But `http://` images/backgrounds embedded in an
 * HTTPS page are mixed content: browsers either auto-upgrade (and blank out on
 * failure) or block them outright. To avoid silent broken images, image-like
 * surfaces must gate on https-only and fall back to a visible placeholder for
 * `http`. Do NOT auto-upgrade http to https.
 */
export function isHttpsUrl(url: string): boolean {
    try {
        return new URL(url).protocol === 'https:';
    } catch {
        return false;
    }
}
