import { describe, it, expect } from "vitest"
import { validateCcInstall } from "./CcInstallModal"

describe("validateCcInstall", () => {
    it("accepts https url + non-empty key", () => {
        expect(validateCcInstall("https://gw.example.com", "sk-1").ok).toBe(true)
    })
    it("accepts http localhost url", () => {
        expect(validateCcInstall("http://localhost:8080", "sk-1").ok).toBe(true)
    })
    it("accepts http 127.0.0.1 url", () => {
        expect(validateCcInstall("http://127.0.0.1:8080/api", "sk-1").ok).toBe(true)
    })
    it("rejects empty url", () => {
        const r = validateCcInstall("", "sk-1")
        expect(r.ok).toBe(false); expect(r.urlError).toBeTruthy()
    })
    it("rejects non-http url", () => {
        const r = validateCcInstall("ftp://gw", "sk-1")
        expect(r.ok).toBe(false); expect(r.urlError).toBeTruthy()
    })
    it("rejects non-local http url", () => {
        const r = validateCcInstall("http://example.com", "sk-1")
        expect(r.ok).toBe(false); expect(r.urlError).toBeTruthy()
    })
    it("rejects empty key", () => {
        const r = validateCcInstall("https://gw", "")
        expect(r.ok).toBe(false); expect(r.keyError).toBeTruthy()
    })
})
