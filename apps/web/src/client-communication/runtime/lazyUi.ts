import type { HostCommand } from "../hostBridge";

export interface CommunicationUiMount {
  mount(onReady: () => void): Promise<() => void>;
}

/** The data owner can exist without importing or rendering CommunicationShell. */
export function createLazyCommunicationUi(load: () => Promise<CommunicationUiMount>) {
  const listeners = new Set<(command: HostCommand) => void>();
  const waiters = new Set<{ resolve(): void; reject(error: Error): void }>();
  let loading: Promise<void> | undefined;
  let unmount: (() => void) | undefined;
  let disposed = false;
  let ready = false;
  let pendingNavigation: HostCommand | undefined;
  let pendingSpace: HostCommand | undefined;
  let flushQueued = false;

  const emit = (command: HostCommand) => {
    for (const listener of [...listeners]) {
      if (disposed) return;
      if (listeners.has(listener)) listener(command);
    }
  };
  const flush = () => {
    if (flushQueued || !listeners.size || disposed) return;
    flushQueued = true;
    queueMicrotask(() => {
      flushQueued = false;
      if (disposed || !listeners.size) return;
      const space = pendingSpace;
      pendingSpace = undefined;
      if (space) emit(space);
      const navigation = pendingNavigation;
      pendingNavigation = undefined;
      if (navigation) emit(navigation);
    });
  };
  const markReady = () => {
    if (disposed) return;
    ready = true;
    for (const waiter of [...waiters]) waiter.resolve();
    waiters.clear();
  };

  function start(): Promise<void> {
    if (disposed) return Promise.reject(new Error("Communication UI disposed"));
    if (!loading) {
      loading = load().then(async (module) => {
        if (disposed) return;
        const cleanup = await module.mount(markReady);
        if (disposed) cleanup();
        else unmount = cleanup;
      });
    }
    return loading;
  }

  return {
    subscribe(listener: (command: HostCommand) => void): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      flush();
      return () => { listeners.delete(listener); };
    },
    dispatch(command: HostCommand): void {
      if (disposed) return;
      if (command.type === "spaceChanged") {
        pendingNavigation = undefined;
        if (listeners.size) {
          pendingSpace = undefined;
          emit(command);
        } else {
          pendingSpace = command;
        }
      } else if (command.type === "navigate") {
        pendingNavigation = command;
      } else if (command.type === "suspend") {
        // Hiding the host cancels any queued navigation before the UI sees the command.
        pendingNavigation = undefined;
        emit(command);
      } else {
        emit(command);
      }
      flush();
    },
    start,
    async ensureReady(): Promise<void> {
      await start();
      if (disposed) throw new Error("Communication UI disposed");
      if (ready) return;
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          waiters.delete(waiter);
          if (error) reject(error);
          else resolve();
        };
        const waiter = { resolve: () => finish(), reject: (error: Error) => finish(error) };
        const timer = setTimeout(() => finish(new Error("Communication UI readiness timed out")), 30_000);
        waiters.add(waiter);
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pendingNavigation = pendingSpace = undefined;
      for (const waiter of [...waiters]) waiter.reject(new Error("Communication UI disposed"));
      waiters.clear();
      unmount?.();
      listeners.clear();
    },
  };
}
