import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearSummaryWorkbenchSession,
    readSummaryWorkbenchSession,
    writeSummaryWorkbenchSession,
} from "./sessionStorage";

describe("summary workbench session storage", () => {
    beforeEach(() => localStorage.clear());

    it("isolates sessions by Space and channel", () => {
        writeSummaryWorkbenchSession(
            {
                userId: "user-a",
                spaceId: "space-a",
                channelId: "channel-1",
                channelType: "group",
            },
            "session-a"
        );
        writeSummaryWorkbenchSession(
            {
                userId: "user-a",
                spaceId: "space-a",
                channelId: "channel-2",
                channelType: "group",
            },
            "session-b"
        );

        expect(
            readSummaryWorkbenchSession({
                userId: "user-a",
                spaceId: "space-a",
                channelId: "channel-1",
                channelType: "group",
            })
        ).toBe("session-a");
        expect(
            readSummaryWorkbenchSession({
                userId: "user-a",
                spaceId: "space-a",
                channelId: "channel-2",
                channelType: "group",
            })
        ).toBe("session-b");
        expect(
            readSummaryWorkbenchSession({
                userId: "user-a",
                spaceId: "space-b",
                channelId: "channel-1",
                channelType: "group",
            })
        ).toBe("");
    });

    it("isolates the same channel id by channel type", () => {
        const groupScope = {
            userId: "user-a",
            spaceId: "space-a",
            channelId: "shared-id",
            channelType: "group",
        };
        const directScope = { ...groupScope, channelType: "direct" };

        writeSummaryWorkbenchSession(groupScope, "group-session");
        writeSummaryWorkbenchSession(directScope, "direct-session");

        expect(readSummaryWorkbenchSession(groupScope)).toBe("group-session");
        expect(readSummaryWorkbenchSession(directScope)).toBe(
            "direct-session"
        );
    });

    it("clears only the requested entry", () => {
        const scope = { userId: "user-a", spaceId: 42, channelId: null };
        writeSummaryWorkbenchSession(scope, "session-global");
        clearSummaryWorkbenchSession(scope);
        expect(readSummaryWorkbenchSession(scope)).toBe("");
    });

    it("isolates referenced tasks without changing the ordinary session key", () => {
        const ordinaryScope = { userId: "user-a", spaceId: "space-a", channelId: null };
        const task42Scope = { ...ordinaryScope, referencedTaskId: 42 };
        const task73Scope = { ...ordinaryScope, referencedTaskId: 73 };

        writeSummaryWorkbenchSession(ordinaryScope, "ordinary-session");
        writeSummaryWorkbenchSession(task42Scope, "task-42-session");
        writeSummaryWorkbenchSession(task73Scope, "task-73-session");

        expect(readSummaryWorkbenchSession(ordinaryScope)).toBe(
            "ordinary-session"
        );
        expect(readSummaryWorkbenchSession(task42Scope)).toBe(
            "task-42-session"
        );
        expect(readSummaryWorkbenchSession(task73Scope)).toBe(
            "task-73-session"
        );
        expect(
            localStorage.getItem(
                "summary-workbench-session:v2:user-a:space-a:global"
            )
        ).toBe("ordinary-session");
    });

    it("isolates sessions for different signed-in users", () => {
        const first = { userId: "user-a", spaceId: "space-a" };
        const second = { userId: "user-b", spaceId: "space-a" };
        writeSummaryWorkbenchSession(first, "session-a");
        writeSummaryWorkbenchSession(second, "session-b");

        expect(readSummaryWorkbenchSession(first)).toBe("session-a");
        expect(readSummaryWorkbenchSession(second)).toBe("session-b");
    });

    it("fails safely when browser storage is unavailable", () => {
        const getSpy = vi
            .spyOn(Storage.prototype, "getItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });
        expect(readSummaryWorkbenchSession({ userId: "user-a", spaceId: "space-a" })).toBe("");
        getSpy.mockRestore();

        const setSpy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("blocked");
            });
        expect(() =>
            writeSummaryWorkbenchSession({ userId: "user-a", spaceId: "space-a" }, "session-a")
        ).not.toThrow();
        setSpy.mockRestore();
    });
});
