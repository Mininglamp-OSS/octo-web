// Shared IPC listener helper used by the preload bridge.
// Extracted so unit tests can exercise the real implementation instead of a
// hand-written copy (avoids test/implementation drift).

export interface MinimalIpcRenderer {
  on(
    channel: string,
    listener: (event: unknown, ...args: any[]) => void
  ): void;
  removeListener(
    channel: string,
    listener: (event: unknown, ...args: any[]) => void
  ): void;
}

/**
 * Register a listener on an IPC channel and return an idempotent cleanup
 * function. Calling the cleanup more than once is a no-op, and each call to
 * this helper registers exactly one listener that is removed on cleanup —
 * preventing listener accumulation and memory leaks.
 */
export function subscribeDisposable<T = any>(
  ipcRenderer: MinimalIpcRenderer,
  channel: string,
  callback: (data: T) => void
): () => void {
  const handler = (_event: unknown, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    ipcRenderer.removeListener(channel, handler);
  };
}
