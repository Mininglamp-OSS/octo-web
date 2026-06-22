import { describe, it, expect } from "vitest"
import { validateCcInstall } from "./ccInstallValidate"

describe("validateCcInstall", () => {
    it("accepts https url + non-empty key", () => {
        const r = validateCcInstall("https://gw.example.com", "sk-1")
        expect(r.ok).toBe(true)
        expect(r.urlError).toBeUndefined()
        expect(r.keyError).toBeUndefined()
    })

    it("accepts https any host (including 127.0.0.1)", () => {
        const r = validateCcInstall("https://127.0.0.1:8443", "sk-1")
        expect(r.ok).toBe(true)
        expect(r.urlError).toBeUndefined()
    })

    it("accepts http localhost url", () => {
        const r = validateCcInstall("http://localhost:8080", "sk-1")
        expect(r.ok).toBe(true)
        expect(r.urlError).toBeUndefined()
    })

    it("accepts http 127.0.0.1 without port", () => {
        const r = validateCcInstall("http://127.0.0.1", "sk-1")
        expect(r.ok).toBe(true)
        expect(r.urlError).toBeUndefined()
    })

    it("rejects empty url with url_required", () => {
        const r = validateCcInstall("", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_required")
        expect(r.keyError).toBeUndefined()
    })

    it("rejects whitespace-only url with url_required", () => {
        const r = validateCcInstall("   ", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_required")
    })

    it("rejects non-local http url with url_invalid", () => {
        const r = validateCcInstall("http://example.com", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects ftp url with url_invalid", () => {
        const r = validateCcInstall("ftp://x", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects malformed url (no host) with url_invalid", () => {
        const r = validateCcInstall("https://", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects plain string as url_invalid", () => {
        const r = validateCcInstall("notaurl", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects empty key with key_required", () => {
        const r = validateCcInstall("https://gw", "")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBeUndefined()
        expect(r.keyError).toBe("key_required")
    })

    it("rejects both empty with both errors", () => {
        const r = validateCcInstall("", "")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_required")
        expect(r.keyError).toBe("key_required")
    })
})
