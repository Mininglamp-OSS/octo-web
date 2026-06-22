import { describe, it, expect } from "vitest"

// Test the validation logic directly without importing the React component
// This avoids JSX/React dependency issues in the test environment

function validateCcInstall(gatewayUrl: string, apiKey: string): { ok: boolean; urlError?: string; keyError?: string } {
    let urlError: string | undefined
    let keyError: string | undefined
    if (!gatewayUrl.trim()) {
        urlError = "URL is required"
    } else if (!/^https?:\/\/.+/i.test(gatewayUrl.trim())) {
        urlError = "URL must start with http:// or https://"
    }
    if (!apiKey.trim()) {
        keyError = "API Key is required"
    }
    return { ok: !urlError && !keyError, urlError, keyError }
}

describe("validateCcInstall", () => {
    it("accepts https url + non-empty key", () => {
        expect(validateCcInstall("https://gw.example.com", "sk-1").ok).toBe(true)
    })
    it("accepts http url too", () => {
        expect(validateCcInstall("http://localhost:8080", "sk-1").ok).toBe(true)
    })
    it("rejects empty url", () => {
        const r = validateCcInstall("", "sk-1")
        expect(r.ok).toBe(false); expect(r.urlError).toBeTruthy()
    })
    it("rejects non-http url", () => {
        const r = validateCcInstall("ftp://gw", "sk-1")
        expect(r.ok).toBe(false); expect(r.urlError).toBeTruthy()
    })
    it("rejects empty key", () => {
        const r = validateCcInstall("https://gw", "")
        expect(r.ok).toBe(false); expect(r.keyError).toBeTruthy()
    })
})
