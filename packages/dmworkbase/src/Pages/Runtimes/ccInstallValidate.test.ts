import { describe, it, expect } from "vitest"
import { validateCcInstall, normalizeGatewayUrl } from "./ccInstallValidate"

describe("normalizeGatewayUrl", () => {
    it("strips a trailing /v1 or /v1/", () => {
        expect(normalizeGatewayUrl("https://gw.test/v1")).toBe("https://gw.test")
        expect(normalizeGatewayUrl("https://gw.test/v1/")).toBe("https://gw.test")
    })
    it("trims and leaves a bare host or non-version path intact", () => {
        expect(normalizeGatewayUrl("  https://gw.test  ")).toBe("https://gw.test")
        expect(normalizeGatewayUrl("https://gw.test/api")).toBe("https://gw.test/api")
    })
    it("does not strip a mid-path v1", () => {
        expect(normalizeGatewayUrl("https://gw.test/v1/foo")).toBe("https://gw.test/v1/foo")
    })
    it("strips a trailing /v1 before a query or fragment, case-insensitively", () => {
        expect(normalizeGatewayUrl("https://gw.test/v1?foo=1")).toBe("https://gw.test?foo=1")
        expect(normalizeGatewayUrl("https://gw.test/v1/#frag")).toBe("https://gw.test#frag")
        expect(normalizeGatewayUrl("https://gw.test/V1")).toBe("https://gw.test")
    })
})

describe("validateCcInstall", () => {
    it("accepts https url + non-empty key", () => {
        const r = validateCcInstall("https://gw.example.com", "sk-1")
        expect(r.ok).toBe(true)
        expect(r.urlError).toBeUndefined()
        expect(r.keyError).toBeUndefined()
    })

    it("rejects https to loopback IPv4 (127.0.0.1) with url_invalid", () => {
        const r = validateCcInstall("https://127.0.0.1:8443", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects https to 0.0.0.0/8 (0.0.0.0 routes to localhost on Linux) with url_invalid", () => {
        const r = validateCcInstall("https://0.0.0.0:8443", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects https to private IPv4 (10.x) with url_invalid", () => {
        const r = validateCcInstall("https://10.1.2.3", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects https to private IPv4 (192.168.x) with url_invalid", () => {
        const r = validateCcInstall("https://192.168.1.1", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects https to private IPv4 (172.16-31.x) with url_invalid", () => {
        const r = validateCcInstall("https://172.16.0.1", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects https to link-local IPv4 (169.254.x) with url_invalid", () => {
        const r = validateCcInstall("https://169.254.169.254", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects https to IPv6 loopback [::1] with url_invalid", () => {
        const r = validateCcInstall("https://[::1]", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("rejects https to IPv6 ULA [fc00::1] / link-local [fe80::1] with url_invalid", () => {
        expect(validateCcInstall("https://[fc00::1]", "sk-1").urlError).toBe("url_invalid")
        expect(validateCcInstall("https://[fd12:3456::1]", "sk-1").urlError).toBe("url_invalid")
        expect(validateCcInstall("https://[fe80::1]", "sk-1").urlError).toBe("url_invalid")
    })

    it("rejects https to IPv4-mapped IPv6 loopback [::ffff:127.0.0.1] with url_invalid", () => {
        const r = validateCcInstall("https://[::ffff:127.0.0.1]", "sk-1")
        expect(r.ok).toBe(false)
        expect(r.urlError).toBe("url_invalid")
    })

    it("accepts https to a public IPv6 literal", () => {
        const r = validateCcInstall("https://[2001:db8::1]", "sk-1")
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
