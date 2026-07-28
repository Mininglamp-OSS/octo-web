import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    STANDALONE_RETURN_KEY,
    consumeStandaloneReturn,
    persistStandaloneReturn,
} from "./standaloneReturn";

describe("standaloneReturn", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/");
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("persists and consumes a standalone doc return target", () => {
        window.history.replaceState(null, "", "/d/d_abc?sp=s_1");

        persistStandaloneReturn();

        expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).toBe("/d/d_abc?sp=s_1");
        expect(consumeStandaloneReturn()).toBe("/d/d_abc?sp=s_1");
        expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).toBeNull();
    });

    it("allows standalone summary return targets", () => {
        window.sessionStorage.setItem(STANDALONE_RETURN_KEY, "/s/task_123?sp=s_1");

        expect(consumeStandaloneReturn()).toBe("/s/task_123?sp=s_1");
    });

    it("rejects unsafe or unrelated return targets", () => {
        for (const target of [
            "d/relative",
            "/settings",
            "//evil.example.com/d/d_abc",
            "https://evil.example.com/d/d_abc",
            "/\n/evil.example.com/d/d_abc",
            "/d/a:b",
        ]) {
            window.sessionStorage.setItem(STANDALONE_RETURN_KEY, target);
            expect(consumeStandaloneReturn()).toBeNull();
            expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).toBeNull();
        }
    });
});
