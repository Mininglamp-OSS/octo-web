export type UrlErrorCode = "url_required" | "url_invalid";
export type KeyErrorCode = "key_required";

export interface CcInstallValidationResult {
    ok: boolean;
    urlError?: UrlErrorCode;
    keyError?: KeyErrorCode;
}

/**
 * Validate cc adapter plugin installation inputs.
 * Pure function — no React, no i18n dependencies.
 *
 * URL policy (aligned with backend isAllowedApiUrl):
 * - Accept https://* (any HTTPS URL)
 * - Accept http://localhost or http://127.0.0.1 (with optional port/path)
 * - Reject everything else (empty → url_required, present-but-not-allowed → url_invalid)
 */
export function validateCcInstall(gatewayUrl: string, apiKey: string): CcInstallValidationResult {
    let urlError: UrlErrorCode | undefined;
    let keyError: KeyErrorCode | undefined;

    const trimmed = gatewayUrl.trim();
    if (!trimmed) {
        urlError = "url_required";
    } else {
        const isHttps = /^https:\/\//i.test(trimmed);
        const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(trimmed);
        if (!isHttps && !isLocalHttp) {
            urlError = "url_invalid";
        }
    }

    if (!apiKey.trim()) {
        keyError = "key_required";
    }

    return { ok: !urlError && !keyError, urlError, keyError };
}
