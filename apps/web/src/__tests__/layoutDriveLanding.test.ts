/**
 * PR#1146 — drive share/invite standalone landing return-target behavior.
 *
 * Behavioral coverage of the Layout gate (prepareDriveLandingReturn) that both drive
 * branches use, exercised against the REAL persist/consume return-path store (jsdom
 * sessionStorage) instead of grepping the Layout source. The core R8 P1 fix is that the
 * deep-link return target is stashed BEFORE the session/token check, so an expired stored
 * token — which still renders the landing, whose API then 401s → global logout → hard
 * redirect to login — no longer loses the deep-link. The open-redirect allowlist for the
 * drive shapes is covered by standaloneReturn.test.ts and not duplicated here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    clearStandaloneReturn,
    consumeStandaloneReturn,
    prepareDriveLandingReturn,
} from "../Layout/standaloneReturn";

const KEY = "octo.docs.standaloneReturn";

function openPath(pathAndQuery: string): void {
    window.history.replaceState(null, "", pathAndQuery);
}

afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
});

describe("drive landing return-target gate (prepareDriveLandingReturn)", () => {
    it("anonymous visitor: stashes the return target and reports no session (→ login)", () => {
        openPath("/drive/s/sh_abc");

        const rendered = prepareDriveLandingReturn(() => false);

        expect(rendered).toBe(false); // fall through to the login screen
        expect(window.sessionStorage.getItem(KEY)).toBe("/drive/s/sh_abc");
    });

    it("expired stored token: still stashes up-front, then renders — login consume recovers the deep-link", () => {
        openPath("/drive/s/sh_abc?x=1");

        // Stale/expired token passes the caller's token check → resolveSession returns true,
        // so the landing renders. The fix is that persist already ran BEFORE that check.
        const rendered = prepareDriveLandingReturn(() => true);
        expect(rendered).toBe(true);
        expect(window.sessionStorage.getItem(KEY)).toBe("/drive/s/sh_abc?x=1");

        // Landing API 401 → global logout → hard redirect to login → onLogin consumes.
        expect(consumeStandaloneReturn()).toBe("/drive/s/sh_abc?x=1");
        expect(window.sessionStorage.getItem(KEY)).toBeNull(); // consumed exactly once
    });

    it("invite path round-trips through the real allowlist", () => {
        openPath("/drive/invite/tok_1?foo=bar");

        expect(prepareDriveLandingReturn(() => true)).toBe(true);
        expect(consumeStandaloneReturn()).toBe("/drive/invite/tok_1?foo=bar");
    });

    it("persists REGARDLESS of session outcome (stash sits before the token gate)", () => {
        const persist = vi.fn();

        prepareDriveLandingReturn(() => true, persist);
        prepareDriveLandingReturn(() => false, persist);

        expect(persist).toHaveBeenCalledTimes(2); // both the render and the login path stash
    });

    it("runs persist before resolveSession so a resolve throw cannot skip the stash", () => {
        const order: string[] = [];
        const persist = vi.fn(() => order.push("persist"));
        const resolve = vi.fn(() => {
            order.push("resolve");
            throw new Error("session recovery blew up");
        });

        expect(() => prepareDriveLandingReturn(resolve, persist)).toThrow();
        expect(order).toEqual(["persist", "resolve"]);
    });

    it("valid signed-in render performs no navigation (no redirect loop)", () => {
        openPath("/drive/s/sh_abc");
        const href = window.location.href;

        // A logged-in user simply rendering the landing: resolveSession true, key gets
        // written, but the gate itself never navigates. onLogin is the only consumer, and
        // it does not fire on a plain render, so the stash cannot bounce the current view.
        prepareDriveLandingReturn(() => true);

        expect(window.location.href).toBe(href); // unchanged: no assign/reload/redirect
    });
});

/**
 * R9 P1: the up-front stash also fires for a VALID signed-in render, so the landing page's
 * onSessionConfirmed callback (wired in Layout to clearStandaloneReturn) must drop that
 * residue once the API confirms the session — otherwise the next account on the same tab
 * replays the previous user's share/invite deep-link (an invite would auto-accept).
 * The wiring under test is `onSessionConfirmed={clearStandaloneReturn}`; here we drive the
 * same persist → (callback) → consume sequence against the real store.
 */
describe("drive landing session-confirmed cleanup (R9 P1)", () => {
    it("valid share access success: onSessionConfirmed clears the stash → later login consumes null", () => {
        openPath("/drive/s/sh_abc");

        // Landing renders (valid session) and stashes up-front.
        expect(prepareDriveLandingReturn(() => true)).toBe(true);
        expect(window.sessionStorage.getItem(KEY)).toBe("/drive/s/sh_abc");

        // accessShare succeeds → ShareLandingPage fires onSessionConfirmed (= clearStandaloneReturn).
        clearStandaloneReturn();

        // A later logout + different-account login on the same tab finds nothing to replay.
        expect(consumeStandaloneReturn()).toBeNull();
    });

    it("valid invite accept success: cleared stash cannot auto-replay the invite under a new account", () => {
        openPath("/drive/invite/tok_1");

        expect(prepareDriveLandingReturn(() => true)).toBe(true);
        expect(window.sessionStorage.getItem(KEY)).toBe("/drive/invite/tok_1");

        // acceptInvite succeeds → InviteLandingPage fires onSessionConfirmed.
        clearStandaloneReturn();

        expect(consumeStandaloneReturn()).toBeNull(); // no cross-identity auto-accept
    });

    it("expired-session chain is untouched: no success → callback never fires → stash survives to consume", () => {
        openPath("/drive/s/sh_abc?x=1");

        // Expired token still renders; API then 401s → global logout, so onSessionConfirmed
        // NEVER runs (no accessShare success). The stash must survive for post-login return.
        expect(prepareDriveLandingReturn(() => true)).toBe(true);
        // (no clearStandaloneReturn here — mirrors the 401 path that skips the success callback)
        expect(consumeStandaloneReturn()).toBe("/drive/s/sh_abc?x=1");
    });

    it("anonymous chain is untouched: stash survives for post-login return", () => {
        openPath("/drive/invite/tok_1?foo=bar");

        // Anonymous → resolveSession false → fall through to login; no landing mounts, so no
        // success callback. Stash must remain for onLogin.
        expect(prepareDriveLandingReturn(() => false)).toBe(false);
        expect(consumeStandaloneReturn()).toBe("/drive/invite/tok_1?foo=bar");
    });
});
