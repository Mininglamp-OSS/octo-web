import { describe, it, expect } from "vitest"
import { validateCcInstall } from "./ccInstallValidate"

describe("validateCcInstall", () => {
    it("accepts https url + non-empty key", () => {
        const r = validateCcInstall("https://gw.example.com", "sk-1")
        expect(r.ok).toBe(true)
        expect(r.urlError).toBeUndefined()
        expect(r.keyError).toBeUndefined()
    })

    it("accepts http localhost url", () => {
        const r = validateCcInstall("http://localhost:8080", "sk-1")
        expect(r.ok).toBe(true)
        expect(r.urlError).toBeUndefined()
    })

    it("accepts http 127.0.0.1 url", () => {
        const r = validateCcInstall("http://127.0.0.1:8080/api", "sk-1")
        expect(r.ok).toBe(true)
        expect(r.urlError).toBeUndefined()
    })

    it("rejects empty url with url_required", () => {
        const r = validateCcInstall("", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_required")
        expect(r.keyError).toBeUndefined()
    })

    it("rejects non-local http url with url_invalid", () => {
        const r = validateCcInstall("http://example.com", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects ftp url with url_invalid", () => {
        const r = validateCcInstall("ftp://gw", "sk-1")
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
