export type UrlErrorCode = "url_required" | "url_invalid";
export type KeyErrorCode = "key_required";

export interface CcInstallValidationResult {
    ok: boolean;
    urlError?: UrlErrorCode;
    keyError?: KeyErrorCode;
}

/**
 * Mirror cc-channel-octo's normalizeGatewayUrl: strip a trailing `/v1` (with or
 * without a trailing slash, case-insensitive) so the SDK's appended
 * `/v1/messages` doesn't double into `/v1/v1/messages` (a 404 that gets
 * misreported as a model error). Splits off any `?query`/`#fragment` first so a
 * trailing `/v1` is still stripped when one follows (e.g. `…/v1?foo=1`), then
 * reattaches them — no URL re-serialization, so bare-host/`/api` inputs are
 * returned byte-for-byte.
 */
export function normalizeGatewayUrl(raw: string): string {
    const trimmed = raw.trim();
    const sepIdx = ((): number => {
        const q = trimmed.indexOf("?");
        const h = trimmed.indexOf("#");
        if (q === -1) return h;
        if (h === -1) return q;
        return Math.min(q, h);
    })();
    const path = sepIdx === -1 ? trimmed : trimmed.slice(0, sepIdx);
    const suffix = sepIdx === -1 ? "" : trimmed.slice(sepIdx);
    return path.replace(/\/v1\/?$/i, "") + suffix;
}

/**
 * Detect whether a hostname is a private/loopback IPv4 literal.
 * Checks common RFC1918 and special-use ranges:
 *   - 127.0.0.0/8 (loopback)
 *   - 10.0.0.0/8
 *   - 192.168.0.0/16
 *   - 169.254.0.0/16 (link-local)
 *   - 172.16.0.0/12
 *   - 100.64.0.0/10 (shared address space)
 *
 * Only matches dotted-quad IPv4 literals — does NOT resolve DNS names.
 * Fast-fail UX check; authoritative SSRF policy is enforced by
 * cc-channel-octo's isAllowedApiUrl at consumption.
 */
function isPrivateIPv4(hostname: string): boolean {
    // Quick reject: must look like an IPv4 literal
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return false;
    }
    const parts = hostname.split(".").map(Number);
    if (parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
        return false;
    }

    const [a, b] = parts;

    // 0.0.0.0/8 ("this host" — on Linux 0.0.0.0 routes to localhost)
    if (a === 0) return true;
    // 127.0.0.0/8
    if (a === 127) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (172.16–172.31)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 100.64.0.0/10 (100.64–100.127)
    if (a === 100 && b >= 64 && b <= 127) return true;

    return false;
}

/**
 * Detect whether a hostname is a private/loopback/link-local IPv6 literal.
 * Handles the common cases (the authoritative full matrix — NAT64, hex
 * v4-mapped, etc. — stays in cc-channel-octo's isAllowedApiUrl at consumption):
 *   - ::1 (loopback), :: (unspecified)
 *   - fc00::/7 ULA (fc/fd prefix)
 *   - fe80::/10 link-local
 *   - ::ffff:a.b.c.d IPv4-mapped → checked against isPrivateIPv4
 * url.hostname may include surrounding brackets for IPv6 literals; strip them.
 */
function isPrivateOrLoopbackIPv6(hostname: string): boolean {
    let h = hostname.toLowerCase();
    if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
    if (!h.includes(":")) return false; // not an IPv6 literal
    if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true; // loopback
    if (h === "::" || h === "0:0:0:0:0:0:0:0") return true; // unspecified
    if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
    if (h.startsWith("fe80")) return true; // link-local fe80::/10
    // IPv4-mapped ::ffff:a.b.c.d → checked against isPrivateIPv4
    const mappedDotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
    // IPv4-mapped hex form (the WHATWG URL parser normalizes ::ffff:127.0.0.1 →
    // ::ffff:7f00:1): reconstruct the embedded IPv4 from the two hextets.
    const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16);
        const lo = parseInt(mappedHex[2], 16);
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateIPv4(v4);
    }
    return false;
}

/**
 * Check whether a parsed URL's protocol + hostname pass the backend gateway
 * allowlist (isAllowedApiUrl / fleet isAllowedGatewayURL).
 *
 * Rule:
 *   - https: → allowed UNLESS hostname is a private/loopback IPv4 or IPv6 literal
 *   - http:  → allowed only for localhost or 127.0.0.1
 *   - anything else → rejected
 *
 * Fast-fail UX check; authoritative SSRF policy is enforced by
 * cc-channel-octo's isAllowedApiUrl at consumption.
 */
function isAllowedApiUrl(url: URL): boolean {
    const protocol = url.protocol.toLowerCase();
    if (protocol === "https:") {
        const hostname = url.hostname.toLowerCase();
        if (isPrivateIPv4(hostname) || isPrivateOrLoopbackIPv6(hostname)) {
            return false;
        }
        return true;
    }
    if (protocol === "http:") {
        const host = url.hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1") {
            return true;
        }
    }
    return false;
}

/**
 * Validate cc adapter plugin installation inputs.
 * Pure function — no React, no i18n dependencies.
 *
 * Uses the native URL constructor so the check mirrors the backend
 * (cc-channel-octo configure / fleet isAllowedGatewayURL) exactly.
 *
 * Error codes:
 *   - empty / whitespace-only URL → url_required
 *   - malformed or disallowed URL → url_invalid
 *   - empty API key → key_required
 */
export function validateCcInstall(gatewayUrl: string, apiKey: string): CcInstallValidationResult {
    let urlError: UrlErrorCode | undefined;
    let keyError: KeyErrorCode | undefined;

    const trimmed = gatewayUrl.trim();
    if (!trimmed) {
        urlError = "url_required";
    } else {
        try {
            const url = new URL(trimmed);
            if (!isAllowedApiUrl(url)) {
                urlError = "url_invalid";
            }
        } catch {
            // Not a valid absolute URL (bad protocol, missing host, etc.)
            urlError = "url_invalid";
        }
    }

    if (!apiKey.trim()) {
        keyError = "key_required";
    }

    return { ok: !urlError && !keyError, urlError, keyError };
}
