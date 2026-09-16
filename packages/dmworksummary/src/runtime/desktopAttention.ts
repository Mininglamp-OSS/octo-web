/**
 * createDesktopSummaryAttention -- desktop summary attention provider.
 *
 * Single-active desktop provider. Reuses the existing adaptive poll (which owns
 * the ONLY pending timer), existing readSummaryAttentionCount /
 * resetSummaryAttentionScope helpers, and the sole WKSDK connection. No leader
 * election, no BroadcastChannel, no connect, no separate sync-debounce timer.
 *
 * Activity model:
 *   applicationActive=true,  foreground=true  -> foreground (15 -> 30 -> 60s)
 *   applicationActive=true,  foreground=false -> hidden    (60 -> 300s)
 *   applicationActive=false                    -> suspended (timer stopped)
 *
 * Serialization: only one in-flight fetch at a time. A mutation/refresh that
 * arrives while a fetch is in-flight queues pendingReason and triggers a fresh
 * read AFTER the current one completes (including when the in-flight fetch
 * fails). Stale non-fresh results older than the last accepted fresh sample
 * are rejected (sampleAt < lastFreshSampleAt). Results discarded on dispose or
 * scope switch (guarded by monotonic scopeRevision).
 *
 * A request for a fresh read (mutation or manual-refresh) marks the last known
 * ready badge stale immediately, then confirms ready only after the new sample
 * arrives. While suspended, fresh requests are queued (not fetched) and flushed
 * on resume.
 *
 * IM listeners: WKSDK chatManager.addMessageListener (filtered by
 * shouldRefreshForMessage) and connectManager (ConnectStatus.Connected). Both
 * drive a fresh mutation/refresh read. Attached on start; a partial install
 * failure removes any already-installed listener and rethrows so the owner
 * knows the wiring did not complete.
 *
 * Lifecycle: start()/dispose() idempotent. Exclusive capture at factory time
 * (two factories before either start are rejected). start() never publishes
 * old local badge as ready; only a confirmed fetch emits ready:{count}. Default
 * starts hidden (foreground=false); owner is expected to call setActivity after
 * ready.
 *
 * Dispose invalidates shared attention tickets via resetSummaryAttentionScope
 * so old WKSDK callbacks cannot write back stale counts.
 */
import {
  readSummaryAttentionCount,
  resetSummaryAttentionScope,
} from "../utils/summaryAttentionBadge";
import { createAttentionPoll } from "../utils/summaryAttentionPoll";
import { shouldRefreshForMessage } from "../utils/summaryAttentionSync";
import WKSDK, { ConnectStatus } from "wukongimjssdk";
import type { SummaryAttentionRuntimeScheduler } from "./attentionHost";

// -- Constants ---------------------------------------------------------------

export const FG_BASE_MS = 15_000;
const FG_MAX_MS = 60_000;
export const HIDDEN_BASE_MS = 60_000;
const HIDDEN_MAX_MS = 300_000;
const UNCHANGED_THRESHOLD = 3;

// -- Types -------------------------------------------------------------------

export type DesktopBadgeStatus = "loading" | "ready" | "stale" | "unavailable";

export interface DesktopBadge {
  status: DesktopBadgeStatus;
  count: number | null;
}

export interface CreateDesktopSummaryAttentionOptions {
  scheduler: SummaryAttentionRuntimeScheduler;
  onBadge: (badge: DesktopBadge) => void;
}

export interface DesktopSummaryAttentionController {
  start(): void;
  setActivity(activity: {
    applicationActive: boolean;
    foreground: boolean;
  }): void;
  refresh(reason?: "mutation" | "manual-refresh"): Promise<void>;
  switchSpace(): void;
  dispose(): void;
}

// -- Module-level state ------------------------------------------------------

let activeProviderId: symbol | null = null;

/** Reset module-level state (test only). */
export function resetDesktopAttentionState(): void {
  activeProviderId = null;
}

// -- Provider factory --------------------------------------------------------

export function createDesktopSummaryAttention(
  options: CreateDesktopSummaryAttentionOptions,
): DesktopSummaryAttentionController {
  if (activeProviderId !== null) {
    throw new Error(
      "desktop summary attention: another provider is already active",
    );
  }

  const emitBadge = options.onBadge;
  const id = Symbol("desktopAttention");
  // Claim ownership at creation time: a second factory (created before either
  // provider starts) must be rejected immediately.
  activeProviderId = id;
  let started = false;
  let disposed = false;
  let lastKnownCount: number | null = null;
  let lastKnownStatus: DesktopBadgeStatus = "loading";
  let imUnsub: (() => void) | null = null;

  // Scope guard
  let scopeRevision = 0;
  let lastFreshSampleAt = 0;
  let freshGeneration = 0;

  // Interval policy
  // Start hidden (foreground=false): the owner is not expected to report
  // activity until after the provider has reached ready.
  let foreground = false;
  let suspended = false;
  let intervalMs = foreground ? FG_BASE_MS : HIDDEN_BASE_MS;
  let unchangedRuns = 0;

  function resetInterval() {
    unchangedRuns = 0;
    intervalMs = foreground ? FG_BASE_MS : HIDDEN_BASE_MS;
  }
  function advanceInterval() {
    unchangedRuns += 1;
    if (unchangedRuns >= UNCHANGED_THRESHOLD) {
      unchangedRuns = 0;
      intervalMs = Math.min(
        intervalMs * 2,
        foreground ? FG_MAX_MS : HIDDEN_MAX_MS,
      );
    }
  }

  function failInterval() {
    intervalMs = Math.min(
      intervalMs * 2,
      foreground ? FG_MAX_MS : HIDDEN_MAX_MS,
    );
  }

  // Badge publish
  function publish(status: DesktopBadgeStatus, count: number | null) {
    if (disposed) return;
    if (status === lastKnownStatus && count === lastKnownCount) return;
    lastKnownStatus = status;
    lastKnownCount = count;
    emitBadge({ status, count });
  }

  // -- Read helper (single fetch, scope-guarded, stale-guarded) ------------
  async function readOnce(fresh: boolean): Promise<number> {
    const rev = scopeRevision;
    const gen = freshGeneration;
    try {
      const result = await readSummaryAttentionCount({ fresh });
      if (disposed || rev !== scopeRevision) return lastKnownCount ?? 0;
      // No confirmed sample (e.g. not logged in / space not ready / cross-space
      // early return): keep the current state and never fabricate a ready count
      // from the old local badge snapshot.
      if (!result) return lastKnownCount ?? 0;
      // Result from an old generation (a mutation/refresh was queued
      // after this poll fetch started) must not republish ready with the old
      // count, even if its sampleAt looks recent enough.
      if (gen !== freshGeneration) return lastKnownCount ?? 0;
      // Stale non-fresh (poll) sample older than the last accepted fresh sample
      // must not regress the count. Samples at or after lastFreshSampleAt are
      // fine (same timestamp means equal freshness; let the poll provide a
      // count that is consistent with the post-fresh baseline).
      if (!fresh && lastFreshSampleAt > 0 && result.sampleAt < lastFreshSampleAt) {
        return lastKnownCount ?? result.count;
      }
      if (fresh) lastFreshSampleAt = result.sampleAt;
      publish("ready", result.count);
      return result.count;
    } catch (err) {
      if (!disposed && rev === scopeRevision) {
        if (lastKnownStatus === "loading" || lastKnownCount === null) {
          // First failure: no confirmed count yet. Publish unavailable so the
          // owner is not left on an indeterminate loading badge.
          publish("unavailable", null);
        } else {
          publish("stale", lastKnownCount);
        }
      }
      // Rethrow so the poll's own failure handler can back off (its fetchCount
      // contract relies on rejection to escalate the interval).
      throw err;
    }
  }

  // -- Serialized fetch executor --------------------------------------------
  // At most one fetch at a time. pendingReason != "idle" means a fresh read is
  // queued. The executor loop drains all queued reads even when a fetch throws:
  // a queued post-mutation read must still run so the fresh request is not lost.

  let pendingReason: "idle" | "mutation" | "manual-refresh" = "idle";
  let inFlight: Promise<number> | null = null;

  async function executor(): Promise<number> {
    if (inFlight) return inFlight;
    const run = (async () => {
      let value = lastKnownCount ?? 0;
      while (!disposed) {
        if (suspended) break;
        const reason = pendingReason;
        pendingReason = "idle";
        try {
          value = await readOnce(reason !== "idle");
        } catch (err) {
          if (disposed || pendingReason === "idle") throw err;
          // A fresh read was queued after this in-flight request failed; keep
          // going rather than losing the queued request.
          continue;
        }
        if (disposed || pendingReason === "idle") break;
      }
      return value;
    })();
    inFlight = run;
    return run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
  }

  function queueFresh(reason: "mutation" | "manual-refresh") {
    if (disposed) return;
    // A requested fresh read supersedes the current ready snapshot: reflect
    // that we are no longer confident until the new sample confirms ready.
    freshGeneration++;
    if (lastKnownStatus === "ready") {
      publish("stale", lastKnownCount);
    }
    if (pendingReason === "idle") {
      pendingReason = reason;
    } else if (reason === "mutation") {
      pendingReason = "mutation";
    }
  }

  /** Fire-and-forget fresh read (event listeners). Rejections are swallowed. */
  function fireRefresh(reason: "mutation" | "manual-refresh") {
    if (disposed) return;
    // While suspended, never launch a fetch: queue the reason and flush on
    // resume so hidden state does not generate background requests.
    if (suspended) {
      queueFresh(reason);
      return;
    }
    queueFresh(reason);
    void executor().catch(() => {});
  }

  // -- IM listeners (sole WKSDK connection) ----------------------------------
  // Attached on start, detached on dispose. Filtered by shouldRefreshForMessage
  // and a ConnectStatus.Connected transition; both drive a fresh read. The
  // poll covers the remaining lifecycle so no separate debounce sync timer
  // is needed — at most one pending timer at a time.
  //
  // On a partial install failure (e.g. the message listener is installed but
  // the connect-status listener cannot be), remove whatever was already
  // installed and rethrow so the owner knows the IM wiring did not complete.

  function subscribeIm(): () => void {
    const sdk = WKSDK.shared();
    const onMessage = (message: unknown) => {
      if (shouldRefreshForMessage(message)) fireRefresh("mutation");
    };
    const onConnected = (status: ConnectStatus) => {
      if (status === ConnectStatus.Connected) fireRefresh("manual-refresh");
    };
    let messageInstalled = false;
    let statusInstalled = false;
    try {
      sdk.chatManager.addMessageListener(onMessage);
      messageInstalled = true;
      sdk.connectManager.addConnectStatusListener(onConnected);
      statusInstalled = true;
    } catch (err) {
      if (messageInstalled) {
        try {
          sdk.chatManager.removeMessageListener(onMessage);
        } catch { /* noop */ }
      }
      if (statusInstalled) {
        try {
          sdk.connectManager.removeConnectStatusListener(onConnected);
        } catch { /* noop */ }
      }
      throw err;
    }
    return () => {
      try {
        sdk.chatManager.removeMessageListener(onMessage);
      } catch { /* noop */ }
      try {
        sdk.connectManager.removeConnectStatusListener(onConnected);
      } catch { /* noop */ }
    };
  }

  // -- Poll (sole timer owner) ----------------------------------------------
  const poll = createAttentionPoll({
    fetchCount: executor,
    isVisible: () => !suspended,
    now: options.scheduler.now,
    setTimeoutFn: options.scheduler.setTimeout,
    clearTimeoutFn: options.scheduler.clearTimeout,
    intervalPolicy: {
      current: () => intervalMs,
      onChanged: () => resetInterval(),
      onUnchanged: () => advanceInterval(),
      onFailed: () => failInterval(),
    },
  });

  // -- Public API -----------------------------------------------------------
  return {
    start(): void {
      if (disposed) throw new Error("desktop attention already disposed");
      if (activeProviderId !== id) {
        throw new Error(
          "desktop summary attention: another provider is already active",
        );
      }
      if (started) return;
      // Install IM listeners first; on failure we never mark started so the
      // owner can retry or dispose.
      const unsub = subscribeIm();
      started = true;
      imUnsub = unsub;
      poll.start();
      queueFresh("manual-refresh");
      poll.notifyActivity();
    },

    setActivity(activity: {
      applicationActive: boolean;
      foreground: boolean;
    }): void {
      if (disposed) return;
      if (!started) {
        // Pre-start: just record the state so the first setActivity after
        // ready reflects the correct mode.
        suspended = !activity.applicationActive;
        foreground = activity.foreground;
        return;
      }
      const wasSuspended = suspended;
      const wasForeground = foreground;
      suspended = !activity.applicationActive;
      foreground = activity.foreground;

      if (!wasSuspended && suspended) {
        poll.stop();
        return;
      }
      if (wasSuspended && !suspended) {
        resetInterval();
        queueFresh("manual-refresh");
        poll.start();
        poll.notifyActivity();
        return;
      }
      if (wasForeground !== foreground) {
        resetInterval();
        queueFresh("manual-refresh");
        poll.notifyActivity();
      }
    },

    async refresh(
      reason: "mutation" | "manual-refresh" = "manual-refresh",
    ): Promise<void> {
      if (disposed || !started) return;
      // While suspended, do not launch a fetch: queue the reason and flush on
      // resume.
      if (suspended) {
        queueFresh(reason);
        return;
      }
      queueFresh(reason);
      await executor().catch(() => {});
    },

    switchSpace(): void {
      if (disposed) return;
      resetSummaryAttentionScope();
      scopeRevision++;
      lastFreshSampleAt = 0;
      emitBadge({ status: "loading", count: null });
      lastKnownCount = null;
      lastKnownStatus = "loading";
      queueFresh("manual-refresh");
      poll.notifyActivity();
    },

    dispose(): void {
      if (disposed) return;
      publish("unavailable", null);
      lastKnownCount = null;
      lastKnownStatus = "unavailable";
      if (activeProviderId === id) activeProviderId = null;
      // Detach IM listeners before invalidating shared tickets so any
      // in-flight WKSDK callback arriving synchronously during removal
      // sees a clean scope and is discarded.
      imUnsub?.();
      imUnsub = null;
      // Invalidate shared attention tickets: old global WKSDK callbacks
      // (or stale responses) cannot write back counts through the
      // ticket system after the provider is gone.
      resetSummaryAttentionScope();
      disposed = true;
      poll.stop();
      pendingReason = "idle";
      inFlight = null;
    },
  };
}
