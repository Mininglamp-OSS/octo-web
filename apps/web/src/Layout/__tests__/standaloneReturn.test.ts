import { afterEach, describe, expect, it } from "vitest";
import { consumeStandaloneReturn, persistStandaloneReturn } from "../standaloneReturn";

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
