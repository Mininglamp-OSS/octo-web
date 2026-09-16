import type { SummaryAttentionRuntimeScheduler } from "@dmwork/summary/runtime";
import type { OctoBuddyCommunicationBridge } from "../hostBridge";
import { sameRuntimeScope, type RuntimeScope, type RuntimeTimer } from "../../client-feature/runtimeContract";

export function createRuntimeHostScheduler(
  host: OctoBuddyCommunicationBridge,
  getScope: () => RuntimeScope,
) {
  if (!host.scheduleRuntimeTask || !host.cancelRuntimeTask) {
    throw new Error("Background summary requires the host scheduler");
  }
  let nextId = 0;
  let disposed = false;
  let pending: { timer: RuntimeTimer; callback: () => void } | undefined;
  const clear = () => {
    if (!pending) return;
    const previous = pending;
    pending = undefined;
    host.cancelRuntimeTask!(previous.timer);
  };
  const scheduler: SummaryAttentionRuntimeScheduler = {
    now: Date.now,
    setTimeout(callback, delayMs) {
      if (disposed) throw new Error("Runtime scheduler disposed");
      if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("Invalid runtime timer delay");
      if (pending) throw new Error("Summary runtime already has a scheduled task");
      const timer: RuntimeTimer = { ...getScope(), version: 1, task: "summaryAttentionRefresh", timerId: ++nextId };
      pending = { timer, callback };
      try {
        host.scheduleRuntimeTask!({ ...timer, delayMs: Math.max(100, Math.min(delayMs, 330_000)) });
      } catch (error) {
        pending = undefined;
        throw error;
      }
      return timer.timerId;
    },
    clearTimeout(handle) {
      if (pending?.timer.timerId === handle) clear();
    },
    setInterval() { throw new Error("Desktop summary must not install a leader interval"); },
    clearInterval() {},
  };
  return {
    scheduler,
    fire(timer: RuntimeTimer): void {
      if (disposed || !pending || timer.task !== pending.timer.task ||
          timer.timerId !== pending.timer.timerId || !sameRuntimeScope(timer, pending.timer)) return;
      const { callback } = pending;
      pending = undefined;
      callback();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
