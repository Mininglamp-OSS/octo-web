import { afterEach, describe, expect, it } from "vitest";
import { isMailAuthorizePath } from "../../../../../packages/mail/src/authorizationSession";
import { consumeStandaloneReturn, persistStandaloneReturn } from "../standaloneReturn";

const KEY = "octo.docs.standaloneReturn";

afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
});

describe("standalone return target", () => {
    it("persists the current path, query, and hash", () => {
        window.history.replaceState(null, "", "/loop/cli-authorize?code=abc#resume");

        persistStandaloneReturn();

        expect(window.sessionStorage.getItem(KEY)).toBe("/loop/cli-authorize?code=abc#resume");
    });

    it("keeps built-in summary return targets valid", () => {
        window.sessionStorage.setItem(KEY, "/s/TN_abc?sp=space1");
        expect(consumeStandaloneReturn()).toBe("/s/TN_abc?sp=space1");

        window.sessionStorage.setItem(KEY, "/s/share/share_abc?sp=space1");
        expect(consumeStandaloneReturn()).toBe("/s/share/share_abc?sp=space1");
    });

    it("returns an anonymous Mail authorization deep link after off-path login", () => {
        const target = "/mail/authorize?code=ABCD-1234&mailbox=bot%40mail.imocto.cn&space_id=space-a";
        window.history.replaceState(null, "", target);
        persistStandaloneReturn();

        window.history.replaceState(null, "", "/login");

        expect(consumeStandaloneReturn([{
            match: isMailAuthorizePath,
            persistReturnOnAnonymous: true,
        }])).toBe(target);
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

    it("requires enterprise handlers for removed feature return targets", () => {
        window.sessionStorage.setItem(KEY, "/d/d_abc?sp=space1");
        expect(consumeStandaloneReturn()).toBeNull();

        window.sessionStorage.setItem(KEY, "/d/d_abc?sp=space1");
        expect(
            consumeStandaloneReturn([
                {
                    match: (pathname) => pathname === "/d/d_abc",
                    persistReturnOnAnonymous: true,
                },
            ])
        ).toBe("/d/d_abc?sp=space1");
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
