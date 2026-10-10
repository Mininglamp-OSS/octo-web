import type { ScreenshotHost, ScreenshotRequest, ScreenshotResult } from "./contract";

export interface ScreenshotTarget {
  isCurrent(): boolean;
  add(file: File): Promise<string | null>;
  focus(): void;
}

/** Upper bound on how long the host may hold a capture open. */
export const SCREENSHOT_CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;

/** Binding size limit for one capture; the attachment queue itself allows a larger payload. */
export const SCREENSHOT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Bind acquisition to one composer lifetime; never use the currently active chat at completion.
 *
 * The returned promise is guaranteed to settle: `cancel()` releases it locally instead of relying
 * on the host, so a capture-only or disposed bridge cannot latch the toolbar in its busy state.
 */
export function captureForComposer(host: ScreenshotHost, request: ScreenshotRequest, target: ScreenshotTarget) {
  let cancelled = false;
  let release!: () => void;
  // Resolves when the operation is abandoned locally; races the host call so `result` always settles.
  const abandoned = new Promise<void>(resolve => { release = resolve; });
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    release();
    // Cancellation is optional in older hosts and best effort if the bridge is gone.
    if (typeof host.cancelScreenshot === "function") {
      try { void Promise.resolve(host.cancelScreenshot(request)).catch(() => undefined); }
      catch { /* A disposed bridge may throw before returning its promise. */ }
    }
  };
  const current = () => !cancelled && target.isCurrent();
  const watchdog = setInterval(() => { if (!current()) cancel(); }, 100);
  const result = (async (): Promise<ScreenshotResult | { status: "attachment-error"; message: string }> => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!current()) return { status: "cancelled" };
      if (typeof host.captureScreenshot !== "function") return { status: "error", code: "unsupported" };
      const captured = await Promise.race([
        host.captureScreenshot(request),
        abandoned.then((): ScreenshotResult => ({ status: "cancelled" })),
        new Promise<ScreenshotResult>(resolve => {
          deadline = setTimeout(
            () => resolve({ status: "error", code: "capture-failed" }),
            SCREENSHOT_CAPTURE_TIMEOUT_MS
          );
        }),
      ]);
      if (!current()) return { status: "cancelled" };
      if (captured.status !== "ok") {
        target.focus();
        if (captured.status === "cancelled") return captured;
        // Hosts may ship new error codes before this renderer is updated.
        const code = captured.status === "error" && ["busy", "permission", "unsupported"].includes(captured.code)
          ? captured.code : "capture-failed";
        return { status: "error", code };
      }
      const bytes = new Uint8Array(captured.bytes);
      // The host contract guarantees a PNG; unlike the generic failures below this is not user-actionable.
      if (captured.mimeType !== "image/png" || captured.width <= 0 || captured.height <= 0) {
        return { status: "error", code: "capture-failed" };
      }
      // Binding limit: the downstream attachment queue allows more, so a large multi-display
      // capture fails here and would otherwise repeat identically on every retry.
      if (bytes.length === 0 || bytes.length > SCREENSHOT_MAX_BYTES) {
        return { status: "error", code: "too-large" };
      }
      const file = new File([bytes], captured.filename, { type: "image/png" });
      const error = await target.add(file);
      if (current()) target.focus();
      return error ? { status: "attachment-error", message: error } : captured;
    } catch {
      if (current()) target.focus();
      return current() ? { status: "error", code: "capture-failed" } : { status: "cancelled" };
    } finally { clearInterval(watchdog); clearTimeout(deadline); }
  })();
  return { result, cancel };
}
