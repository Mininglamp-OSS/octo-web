import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryWorkspaceApiError } from "../../bridge/summaryWorkbench/protocol";
import {
    SummaryWorkbenchAvailability,
    type SummaryWorkbenchCapabilitySource,
} from "./availability";

function capability(
    enabled = true,
    contractVersion = "1",
    maxTimeRangeDays = 90,
    directTeamWorkflow = false
) {
    return {
        enabled,
        contract_version: contractVersion,
        max_time_range_days: maxTimeRangeDays,
        direct_team_workflow: directTeamWorkflow,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe("SummaryWorkbenchAvailability", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("deduplicates concurrent requests and caches decisions by normalized Space", async () => {
        const response = deferred<unknown>();
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi.fn(() => response.promise),
        };
        const availability = new SummaryWorkbenchAvailability(source);

        const first = availability.resolve(" space-a ");
        const second = availability.resolve("space-a");
        response.resolve(capability());

        await expect(first).resolves.toMatchObject({
            status: "enabled",
            spaceId: "space-a",
            reason: "supported",
            maxTimeRangeDays: 90,
            directTeamWorkflow: false,
        });
        await expect(second).resolves.toMatchObject({ status: "enabled" });
        await availability.resolve("space-a");
        await availability.resolve("space-b");

        expect(source.getCapabilities).toHaveBeenCalledTimes(2);
        expect(source.getCapabilities).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ spaceId: "space-a" })
        );
        expect(source.getCapabilities).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ spaceId: "space-b" })
        );
    });

    it("refreshes a cached decision after the short TTL expires", async () => {
        let now = 1_000;
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi.fn().mockResolvedValue(capability()),
        };
        const availability = new SummaryWorkbenchAvailability(source, {
            cacheTtlMs: 30_000,
            now: () => now,
        });

        await availability.resolve("space-a");
        now += 29_999;
        await availability.resolve("space-a");
        expect(source.getCapabilities).toHaveBeenCalledTimes(1);

        now += 1;
        await availability.resolve("space-a");
        expect(source.getCapabilities).toHaveBeenCalledTimes(2);
    });

    it.each([
        [capability(false), "server_disabled"],
        [capability(true, "2"), "unsupported_contract"],
        [
            {
                enabled: "yes",
                contract_version: "1",
                max_time_range_days: 90,
            },
            "invalid_response",
        ],
    ])("fails closed for capability payload %#", async (payload, reason) => {
        const availability = new SummaryWorkbenchAvailability({
            getCapabilities: vi.fn().mockResolvedValue(payload),
        });

        await expect(availability.resolve("space-a")).resolves.toMatchObject({
            status: "disabled",
            enabled: false,
            reason,
        });
    });

    it("fails closed for 404 and protocol errors", async () => {
        const notFound = new SummaryWorkbenchAvailability({
            getCapabilities: vi.fn().mockRejectedValue(
                new SummaryWorkspaceApiError({
                    message: "not found",
                    kind: "transport",
                    httpStatus: 404,
                })
            ),
        });
        const invalid = new SummaryWorkbenchAvailability({
            getCapabilities: vi.fn().mockRejectedValue(
                new SummaryWorkspaceApiError({
                    message: "invalid response",
                    kind: "protocol",
                })
            ),
        });

        await expect(notFound.resolve("space-a")).resolves.toMatchObject({
            status: "disabled",
            reason: "not_found",
        });
        await expect(invalid.resolve("space-a")).resolves.toMatchObject({
            status: "disabled",
            reason: "invalid_response",
        });
    });

    it("times out, aborts the transport signal, and caches the fail-closed decision", async () => {
        vi.useFakeTimers();
        let transportSignal: AbortSignal | undefined;
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi.fn(({ signal } = {}) => {
                transportSignal = signal;
                return new Promise(() => undefined);
            }),
        };
        const availability = new SummaryWorkbenchAvailability(source, {
            timeoutMs: 50,
        });

        const result = availability.resolve("space-a");
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(50);

        await expect(result).resolves.toMatchObject({
            status: "disabled",
            reason: "timeout",
        });
        expect(transportSignal?.aborted).toBe(true);
        await availability.resolve("space-a");
        expect(source.getCapabilities).toHaveBeenCalledOnce();
    });

    it("lets one subscriber abort without cancelling another subscriber", async () => {
        const response = deferred<unknown>();
        let transportSignal: AbortSignal | undefined;
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi.fn(({ signal } = {}) => {
                transportSignal = signal;
                return response.promise;
            }),
        };
        const availability = new SummaryWorkbenchAvailability(source);
        const firstController = new AbortController();

        const first = availability.resolve("space-a", {
            signal: firstController.signal,
        });
        const second = availability.resolve("space-a");
        await Promise.resolve();
        firstController.abort();

        await expect(first).resolves.toMatchObject({ reason: "aborted" });
        expect(transportSignal?.aborted).toBe(false);
        response.resolve(capability());
        await expect(second).resolves.toMatchObject({ status: "enabled" });
    });

    it("aborts an unobserved request without poisoning the Space cache", async () => {
        const firstResponse = deferred<unknown>();
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi
                .fn()
                .mockImplementationOnce(() => firstResponse.promise)
                .mockResolvedValueOnce(capability()),
        };
        const availability = new SummaryWorkbenchAvailability(source);
        const controller = new AbortController();

        const first = availability.resolve("space-a", {
            signal: controller.signal,
        });
        await Promise.resolve();
        controller.abort();

        await expect(first).resolves.toMatchObject({ reason: "aborted" });
        await expect(availability.resolve("space-a")).resolves.toMatchObject({
            status: "enabled",
        });
        expect(source.getCapabilities).toHaveBeenCalledTimes(2);
    });

    it("invalidates one Space or the complete cache", async () => {
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi.fn().mockResolvedValue(capability()),
        };
        const availability = new SummaryWorkbenchAvailability(source);

        await availability.resolve("space-a");
        await availability.resolve("space-b");
        availability.invalidate("space-a");
        await availability.resolve("space-a");
        await availability.resolve("space-b");
        expect(source.getCapabilities).toHaveBeenCalledTimes(3);

        availability.invalidate();
        await availability.resolve("space-a");
        await availability.resolve("space-b");
        expect(source.getCapabilities).toHaveBeenCalledTimes(5);
    });

    it("does not request capabilities without a current Space", async () => {
        const source: SummaryWorkbenchCapabilitySource = {
            getCapabilities: vi.fn(),
        };
        const availability = new SummaryWorkbenchAvailability(source);

        await expect(availability.resolve("  ")).resolves.toMatchObject({
            status: "disabled",
            reason: "missing_space",
            spaceId: "",
        });
        expect(source.getCapabilities).not.toHaveBeenCalled();
    });
});
