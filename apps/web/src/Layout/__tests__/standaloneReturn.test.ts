import { afterEach, describe, expect, it } from "vitest";
import { clearStandaloneReturn, consumeStandaloneReturn, persistStandaloneReturn } from "../standaloneReturn";

const KEY = "octo.docs.standaloneReturn";

afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
});

describe("standalone return target", () => {
    it("persists the current path and query", () => {
        window.history.replaceState(null, "", "/loop/cli-authorize?code=abc");

        persistStandaloneReturn();

        expect(window.sessionStorage.getItem(KEY)).toBe("/loop/cli-authorize?code=abc");
    });

    it("keeps existing docs and summary return targets valid", () => {
        window.sessionStorage.setItem(KEY, "/d/d_abc?sp=space1");
        expect(consumeStandaloneReturn()).toBe("/d/d_abc?sp=space1");

        window.sessionStorage.setItem(KEY, "/s/TN_abc?sp=space1");
        expect(consumeStandaloneReturn()).toBe("/s/TN_abc?sp=space1");

        window.sessionStorage.setItem(KEY, "/s/share/share_abc?sp=space1");
        expect(consumeStandaloneReturn()).toBe("/s/share/share_abc?sp=space1");
    });

    it("accepts the exact drive share / invite landing shapes (PR#1146 N2)", () => {
        for (const good of [
            "/drive/s/sh_abc",
            "/drive/s/sh_abc/",
            "/drive/invite/tok-9_x",
            "/drive/invite/tok_1?foo=bar",
        ]) {
            window.sessionStorage.setItem(KEY, good);
            expect(consumeStandaloneReturn()).toBe(good);
        }
    });

    it("rejects drive paths that smuggle structure or miss the exact s/invite shape (N2)", () => {
        for (const bad of [
            "/drive/invite/a/b", // extra path segment
            "/drive/s/a%2Fb", // encoded slash → decodes to a/b
            "/drive/s/a%5Cb", // encoded backslash
            "/drive/s/%", // malformed %-escape
            "/drive/s/%zz", // malformed %-escape
            "/drive/s/", // empty token
            "/drive/s", // no token segment
            "/drive/foo/x", // wrong action
            "/drive", // namespace root
            "/drive/s/a/../../settings", // traversal
        ]) {
            window.sessionStorage.setItem(KEY, bad);
            expect(consumeStandaloneReturn()).toBeNull();
            expect(window.sessionStorage.getItem(KEY)).toBeNull();
        }
    });

    it("accepts enterprise return targets only when a persistent handler owns the path", () => {
        window.sessionStorage.setItem(KEY, "/loop/cli-authorize?code=abc");
        expect(
            consumeStandaloneReturn([
                {
                    match: (pathname) => pathname === "/loop/cli-authorize",
                    persistReturnOnAnonymous: true,
                },
            ])
        ).toBe("/loop/cli-authorize?code=abc");

        window.sessionStorage.setItem(KEY, "/loop/cli-authorize?code=abc");
        expect(
            consumeStandaloneReturn([
                {
                    match: (pathname) => pathname === "/loop/cli-authorize",
                },
            ])
        ).toBeNull();
    });

    it("clearStandaloneReturn deletes the key without navigating or consuming (R9 P1)", () => {
        const href = window.location.href;
        window.sessionStorage.setItem(KEY, "/drive/invite/tok_1");

        clearStandaloneReturn();

        expect(window.sessionStorage.getItem(KEY)).toBeNull(); // key gone
        expect(window.location.href).toBe(href); // no navigation
        // Idempotent: a second clear (or clearing when nothing is stashed) is a harmless no-op.
        expect(() => clearStandaloneReturn()).not.toThrow();
        expect(consumeStandaloneReturn()).toBeNull(); // nothing left for onLogin to replay
    });

    it("rejects off-origin and control-character return targets", () => {
        for (const bad of [
            "https://evil.example.com/loop/cli-authorize",
            "//evil.example.com/loop/cli-authorize",
            "/\n/evil.example.com",
            "loop/cli-authorize",
        ]) {
            window.sessionStorage.setItem(KEY, bad);
            expect(
                consumeStandaloneReturn([
                    {
                        match: (pathname) => pathname === "/loop/cli-authorize",
                        persistReturnOnAnonymous: true,
                    },
                ])
            ).toBeNull();
            expect(window.sessionStorage.getItem(KEY)).toBeNull();
        }
    });
});
