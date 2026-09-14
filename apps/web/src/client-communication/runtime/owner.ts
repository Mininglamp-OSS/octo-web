import {
  parseRuntimeCommand, sameRuntimeScope,
  type OwnerRuntimeBootstrap, type RuntimeActivity, type RuntimeBadge,
  type RuntimeCommand, type RuntimeCommandResult, type RuntimeReady, type RuntimeScope, type RuntimeSnapshot,
} from "../../client-feature/runtimeContract";
import type { HostCommand } from "../hostBridge";

export interface OwnerRuntimePorts {
  bootstrap: OwnerRuntimeBootstrap;
  retainData(): () => void;
  subscribeData(listener: () => void): () => void;
  readMessages(): RuntimeBadge;
  isConnected(): boolean;
  refreshMessages(): Promise<void>;
  applySpace(space: { id: string; name: string }): void;
  setReadAttention(allowed: boolean): void;
  disposeData(): void;
  reportReady(ready: RuntimeReady): Promise<void>;
  reportSnapshot(snapshot: RuntimeSnapshot): void;
  reportCommandResult(result: RuntimeCommandResult): void;
  onCommand(callback: (command: unknown) => void): () => void;
  dispatchUi(command: HostCommand): void;
  startUi(): Promise<void>;
  disposeUi(): void;
  fireTimer(command: Extract<RuntimeCommand, { type: "timerFired" }>): void;
  summary?: {
    start(): void;
    setActivity(activity: { applicationActive: boolean; foreground: boolean }): void;
    refresh(reason?: "mutation" | "manual-refresh"): Promise<void>;
    switchSpace(): void;
    dispose(): void;
  };
  onError(error: unknown): void;
}

export function createCommunicationOwner(ports: OwnerRuntimePorts) {
  let scope: RuntimeScope = { ...ports.bootstrap };
  let revision = 0;
  let started = false;
  let disposed = false;
  let protocolReady = false;
  let switching = false;
  let activity: RuntimeActivity = {
    applicationActive: true, windowVisible: false, windowFocused: false, communicationSurfaceVisible: false,
  };
  let summary: RuntimeBadge = { status: ports.summary ? "loading" : "unavailable", count: null };
  const cleanups: Array<() => void> = [];
  const run = (action: () => void | Promise<void>) => {
    try { void Promise.resolve(action()).catch(ports.onError); }
    catch (error) { ports.onError(error); }
  };
  function publish(): void {
    if (!started || disposed || switching) return;
    const messages = ports.readMessages();
    const phase = !protocolReady ? "starting" : !ports.isConnected() ? "offline" : "ready";
    ports.reportSnapshot({
      version: 1, ownerId: scope.ownerId, contextId: scope.contextId, epoch: scope.epoch,
      revision: ++revision, phase,
      badges: {
        messages: messages.status === "ready" && phase === "offline"
          ? { status: "stale", count: messages.count } : messages,
        summary: { ...summary },
      },
    });
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    ports.setReadAttention(false);
    // UI teardown precedes restoring ordinary Web's default read allowance.
    for (const cleanup of [
      () => ports.disposeUi(), () => ports.summary?.dispose(),
      ...cleanups.splice(0).reverse(), () => ports.disposeData(),
    ]) {
      try { cleanup(); } catch (error) { ports.onError(error); }
    }
  }
  function accept(value: unknown): void {
    if (disposed) return;
    let command: RuntimeCommand;
    try { command = parseRuntimeCommand(value); }
    catch (error) { ports.onError(error); return; }
    if (!sameRuntimeScope(command, scope)) {
      if (command.type === "invalidateSummary") ports.reportCommandResult({
        version: 1, ownerId: command.ownerId, contextId: command.contextId, epoch: command.epoch,
        requestId: command.requestId, accepted: false,
      });
      return;
    }
    if (command.type === "dispose") { dispose(); return; }
    if (command.type === "spaceChanged") {
      if (command.next.epoch <= scope.epoch || command.next.contextId === scope.contextId) return;
      switching = true;
      ports.setReadAttention(false);
      activity = { ...activity, communicationSurfaceVisible: false };
      scope = { ownerId: scope.ownerId, contextId: command.next.contextId, epoch: command.next.epoch };
      summary = { status: ports.summary ? "loading" : "unavailable", count: null };
      try {
        // Drop queued targets before synchronous domain listeners can re-enter.
        ports.dispatchUi({ type: "spaceChanged", space: command.next.space });
        ports.applySpace(command.next.space);
        ports.summary?.switchSpace();
      } finally {
        switching = false;
      }
      publish();
      return;
    }
    if (command.type === "activity") {
      const wasActive = activity.applicationActive;
      activity = command.activity;
      ports.setReadAttention(activity.applicationActive && activity.windowVisible &&
        activity.windowFocused && activity.communicationSurfaceVisible);
      ports.summary?.setActivity({
        applicationActive: activity.applicationActive,
        foreground: activity.windowVisible && activity.windowFocused,
      });
      if (!wasActive && activity.applicationActive) run(ports.refreshMessages);
      publish();
      return;
    }
    if (command.type === "refresh") {
      run(ports.refreshMessages);
      if (ports.summary) run(() => ports.summary!.refresh("manual-refresh"));
      return;
    }
    if (command.type === "invalidateSummary") {
      let accepted = false;
      if (ports.summary) {
        try {
          // refresh invalidates synchronously; network completion arrives in later snapshots.
          void ports.summary.refresh(command.reason).catch(ports.onError);
          accepted = true;
        } catch (error) { ports.onError(error); }
      }
      ports.reportCommandResult({
        version: 1, ownerId: scope.ownerId, contextId: scope.contextId, epoch: scope.epoch,
        requestId: command.requestId, accepted,
      });
      return;
    }
    if (command.type === "timerFired") { ports.fireTimer(command); return; }
    ports.dispatchUi({
      type: "navigate", page: command.page, presentation: command.presentation, target: command.target,
    });
    run(ports.startUi);
  }
  return {
    getScope: (): RuntimeScope => ({ ownerId: scope.ownerId, contextId: scope.contextId, epoch: scope.epoch }),
    isCurrent: (value: RuntimeScope): boolean => !disposed && sameRuntimeScope(value, scope),
    updateSummary(badge: RuntimeBadge): void {
      if (disposed) return;
      summary = badge;
      publish();
    },
    async start(): Promise<void> {
      if (started || disposed) return;
      started = true;
      try {
        ports.setReadAttention(false);
        cleanups.push(ports.onCommand(accept));
        cleanups.push(ports.subscribeData(publish));
        cleanups.push(ports.retainData());
        ports.summary?.start();
        publish();
        const initialScope = { ownerId: scope.ownerId, contextId: scope.contextId, epoch: scope.epoch };
        await ports.reportReady({
          version: 1, ...initialScope, backgroundRuntimeVersion: 1,
          ...(ports.summary ? { summaryAttentionProviderVersion: 1 as const } : {}),
        });
        if (disposed) return;
        protocolReady = true;
        publish();
        run(ports.refreshMessages);
      } catch (error) {
        dispose();
        throw error;
      }
    },
    dispose,
  };
}
