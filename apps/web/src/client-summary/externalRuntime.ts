import { installExternalSummaryAttention } from "@dmwork/summary/runtime";
import {
  parseRuntimeSnapshot, parseSummaryRuntimeBootstrap,
  type SummaryRuntimeBootstrap,
} from "../client-feature/runtimeContract";
import type { OctoBuddySummaryBridge } from "./hostBridge";

/** Only the host's versioned snapshot can write the external badge mirror. */
export function installSummaryExternalRuntime(
  host: OctoBuddySummaryBridge,
  initial: SummaryRuntimeBootstrap,
) {
  if (!host.getRuntimeSnapshot || !host.onRuntimeSnapshot || !host.invalidateSummaryRuntime) {
    throw new Error("External summary runtime bridge unavailable");
  }
  let scope = parseSummaryRuntimeBootstrap(initial);
  if (scope.summaryAttention !== "external") throw new Error("Expected external summary ownership");
  let disposed = false;
  let revision = -1;
  let ownerId: string | undefined;
  const adapter = installExternalSummaryAttention({
    requestRefresh: (reason) => host.invalidateSummaryRuntime!({ ...scope, reason }),
  });
  const apply = (value: unknown) => {
    if (disposed || value === null) return;
    let snapshot;
    try { snapshot = parseRuntimeSnapshot(value); }
    catch { return; }
    if (snapshot.contextId !== scope.contextId || snapshot.epoch !== scope.epoch ||
        snapshot.revision <= revision || (ownerId && snapshot.ownerId !== ownerId)) return;
    ownerId = snapshot.ownerId;
    revision = snapshot.revision;
    adapter.apply(snapshot.badges.summary.count);
  };
  let off: () => void;
  try {
    // Subscribe before reading so a late initial response cannot overwrite an event.
    off = host.onRuntimeSnapshot(apply);
    void host.getRuntimeSnapshot().then(apply).catch(() => {});
  } catch (error) {
    adapter.dispose();
    throw error;
  }
  return {
    getScope: (): SummaryRuntimeBootstrap => ({ ...scope }),
    acceptSpace(next: SummaryRuntimeBootstrap | undefined): boolean {
      if (disposed || !next) return false;
      let parsed;
      try { parsed = parseSummaryRuntimeBootstrap(next); }
      catch { return false; }
      if (parsed.summaryAttention !== "external" || parsed.epoch <= scope.epoch ||
          parsed.contextId === scope.contextId) return false;
      scope = parsed;
      revision = -1;
      ownerId = undefined;
      adapter.apply(null);
      void host.getRuntimeSnapshot!().then(apply).catch(() => {});
      return true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      off();
      adapter.dispose();
    },
  };
}
