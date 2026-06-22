export type UrlErrorCode = "url_required" | "url_invalid";
export type KeyErrorCode = "key_required";

export interface CcInstallValidationResult {
    ok: boolean;
    urlError?: UrlErrorCode;
    keyError?: KeyErrorCode;
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
 * Check whether a parsed URL's protocol + hostname pass the backend gateway
 * allowlist (isAllowedApiUrl / fleet isAllowedGatewayURL).
 *
 * Rule:
 *   - https: → allowed UNLESS hostname is a private/loopback IPv4 literal
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
        if (isPrivateIPv4(hostname)) {
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
