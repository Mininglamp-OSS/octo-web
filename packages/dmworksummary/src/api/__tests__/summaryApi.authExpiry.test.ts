import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WKApp from "@octo/base/src/App";

const interceptors = vi.hoisted(() => ({
    reject: undefined as undefined | ((error: unknown) => Promise<never>),
}));
vi.mock("axios", () => ({
    default: {
        create: () => ({
            interceptors: {
                request: { use: vi.fn() },
                response: {
                    use: (_resolve: unknown, reject: typeof interceptors.reject) => {
                        interceptors.reject = reject;
                    },
                },
            },
        }),
    },
}));

import { agentChatStream, streamSummary } from "../summaryApi";

describe("Summary HTTP authentication boundary", () => {
    const originalClient = WKApp.apiClient;
    const hostLogout = vi.fn();
    let webLogout: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        hostLogout.mockClear();
        webLogout = vi.spyOn(WKApp.shared, "logout").mockImplementation(() => {});
        WKApp.apiClient = {
            config: { apiURL: "https://summary.example.test/api/v1/" },
            logoutCallback: hostLogout,
        } as typeof WKApp.apiClient;
        vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })));
    });

    afterEach(() => {
        WKApp.apiClient = originalClient;
        webLogout.mockRestore();
        vi.unstubAllGlobals();
    });

    for (const runtime of ["host", "web"] as const) {
        it(`routes JSON and both SSE 401 paths through the ${runtime} logout boundary`, async () => {
            if (runtime === "web") {
                delete (WKApp.apiClient as { logoutCallback?: () => void }).logoutCallback;
            }
            const error = { response: { status: 401 } };
            await expect(interceptors.reject!(error)).rejects.toBe(error);
            await expect(streamSummary(9, { onEvent: vi.fn() })).rejects.toThrow("401");
            await new Promise<void>((resolve) => {
                agentChatStream({ message: "test", session_id: "auth-expiry-test" }, {
                    onError: (error) => {
                        expect(error.code).toBe(401);
                        resolve();
                    },
                });
            });
            expect(runtime === "host" ? hostLogout : webLogout).toHaveBeenCalledTimes(3);
            expect(runtime === "host" ? webLogout : hostLogout).not.toHaveBeenCalled();
        });
    }

    it("does not expire the session for non-authentication errors", async () => {
        const error = { response: { status: 403 } };
        await expect(interceptors.reject!(error)).rejects.toBe(error);
        expect(hostLogout).not.toHaveBeenCalled();
        expect(webLogout).not.toHaveBeenCalled();
    });
});
