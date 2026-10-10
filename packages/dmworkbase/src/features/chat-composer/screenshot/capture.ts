import type { ScreenshotHost, ScreenshotRequest, ScreenshotResult } from "./contract";

export interface ScreenshotTarget {
  isCurrent(): boolean;
  add(file: File): Promise<string | null>;
  focus(): void;
}

/** Bind acquisition to one composer lifetime; never use the currently active chat at completion. */
export function captureForComposer(host: ScreenshotHost, request: ScreenshotRequest, target: ScreenshotTarget) {
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    // Cancellation is optional in older hosts and best effort if the bridge is gone.
    if (typeof host.cancelScreenshot === "function") {
      try { void Promise.resolve(host.cancelScreenshot(request)).catch(() => undefined); }
      catch { /* A disposed bridge may throw before returning its promise. */ }
    }
  };
  const current = () => !cancelled && target.isCurrent();
  const watchdog = setInterval(() => { if (!current()) cancel(); }, 100);
  const result = (async (): Promise<ScreenshotResult | { status: "attachment-error"; message: string }> => {
    try {
      if (!current()) return { status: "cancelled" };
      if (typeof host.captureScreenshot !== "function") return { status: "error", code: "unsupported" };
      const captured = await host.captureScreenshot(request);
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
      if (captured.mimeType !== "image/png" || bytes.length === 0 || bytes.length > 32 * 1024 * 1024) {
        return { status: "error", code: "capture-failed" };
      }
      const file = new File([bytes], captured.filename, { type: "image/png" });
      const error = await target.add(file);
      if (current()) target.focus();
      return error ? { status: "attachment-error", message: error } : captured;
    } catch {
      if (current()) target.focus();
      return current() ? { status: "error", code: "capture-failed" } : { status: "cancelled" };
    } finally { clearInterval(watchdog); }
  })();
  return { result, cancel };
}
