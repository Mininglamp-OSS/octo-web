import { describe, expect, it, vi } from "vitest";
import { createRuntimeHostScheduler } from "./hostScheduler";
import type { OctoBuddyCommunicationBridge } from "../hostBridge";

describe("runtime host scheduler", () => {
  it("schedules only one allowlisted task, rejects stale ticks, clears before callback", () => {
    const scope = { ownerId: "owner", contextId: "context", epoch: 1 };
    const host = { scheduleRuntimeTask: vi.fn(), cancelRuntimeTask: vi.fn() };
    const runtime = createRuntimeHostScheduler(host as unknown as OctoBuddyCommunicationBridge, () => scope);
    const callback = vi.fn(() => runtime.scheduler.setTimeout(() => {}, 600_000));
    runtime.scheduler.setTimeout(callback, 15_000);
    const timer = host.scheduleRuntimeTask.mock.calls[0][0];
    expect(timer).toMatchObject({ ...scope, task: "summaryAttentionRefresh", delayMs: 15_000 });
    expect(() => runtime.scheduler.setTimeout(() => {}, 1)).toThrow("already");
    runtime.fire({ ...timer, epoch: 0 });
    expect(callback).not.toHaveBeenCalled();
    runtime.fire(timer);
    runtime.fire(timer);
    expect(callback).toHaveBeenCalledOnce();
    expect(host.scheduleRuntimeTask.mock.calls[1][0]).toMatchObject({ delayMs: 330_000 });
    runtime.scheduler.clearTimeout(timer.timerId);
    expect(host.cancelRuntimeTask).not.toHaveBeenCalled();
    runtime.dispose();
    runtime.dispose();
    expect(host.cancelRuntimeTask).toHaveBeenCalledOnce();
    expect(() => runtime.scheduler.setInterval(() => {}, 10)).toThrow("leader");
  });
});
