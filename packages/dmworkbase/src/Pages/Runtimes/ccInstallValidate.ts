export type UrlErrorCode = "url_required" | "url_invalid";
export type KeyErrorCode = "key_required";

export interface CcInstallValidationResult {
    ok: boolean;
    urlError?: UrlErrorCode;
    keyError?: KeyErrorCode;
}

/**
 * Check whether a parsed URL's protocol + hostname pass the backend gateway
 * allowlist (isAllowedApiUrl / fleet isAllowedGatewayURL).
 *
 * Rule:
 *   - https: → always allowed (any host)
 *   - http:  → allowed only for localhost or 127.0.0.1
 *   - anything else → rejected
 */
function isAllowedApiUrl(url: URL): boolean {
    const protocol = url.protocol.toLowerCase();
    if (protocol === "https:") {
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
