import { describe, expect, it, vi } from "vitest";
import { captureForComposer } from "./capture";
import type { ScreenshotResult } from "./contract";

const request = { requestId: "test-capture", locale: "en-US" as const };
const image: ScreenshotResult = { status: "ok", bytes: new Uint8Array([137, 80, 78, 71]),
  filename: "screenshot.png", mimeType: "image/png", width: 1, height: 1 };
function fixture() {
  let resolve!: (result: ScreenshotResult) => void;
  let current = true;
  const host = { captureScreenshot: vi.fn(() => new Promise<ScreenshotResult>(r => { resolve = r; })), cancelScreenshot: vi.fn(async () => {}) };
  const target = { isCurrent: () => current, add: vi.fn(async (_file: File) => null as string | null), focus: vi.fn() };
  return { host, target, finish: (result: ScreenshotResult) => resolve(result), invalidate: () => { current = false; } };
}
describe("screenshot composer ownership", () => {
  it("appends one PNG through the attachment queue and focuses without sending", async () => {
    const f = fixture();
    const operation = captureForComposer(f.host, request, f.target);
    f.finish(image);
    expect(await operation.result).toMatchObject({ status: "ok" });
    expect(f.target.add).toHaveBeenCalledOnce();
    const file = f.target.add.mock.calls[0][0] as File;
    expect(file.name).toBe("screenshot.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(4);
    expect(f.target.focus).toHaveBeenCalledOnce();
  });
  it.each([{ status: "cancelled" }, { status: "error", code: "permission" }])("keeps existing attachments on $status", async result => {
    const f = fixture();
    const operation = captureForComposer(f.host, request, f.target);
    f.finish(result as ScreenshotResult);
    expect(await operation.result).toEqual(result);
    expect(f.target.add).not.toHaveBeenCalled();
  });
  it("discards results from a different channel or Space", async () => {
    const f = fixture();
    const operation = captureForComposer(f.host, request, f.target);
    f.invalidate();
    f.finish(image);
    expect(await operation.result).toEqual({ status: "cancelled" });
    expect(f.target.add).not.toHaveBeenCalled();
    expect(f.target.focus).not.toHaveBeenCalled();
  });
  it("cancels on unmount once and rejects a late success", async () => {
    const f = fixture();
    const operation = captureForComposer(f.host, request, f.target);
    operation.cancel(); operation.cancel();
    f.finish(image);
    expect(await operation.result).toEqual({ status: "cancelled" });
    expect(f.host.cancelScreenshot).toHaveBeenCalledExactlyOnceWith(request);
    expect(f.target.add).not.toHaveBeenCalled();
  });
  it("preserves attachment-limit errors and reports a rejected acquisition", async () => {
    const f = fixture();
    f.target.add.mockResolvedValue("Attachment limit reached");
    const operation = captureForComposer(f.host, request, f.target);
    f.finish(image);
    expect(await operation.result).toEqual({ status: "attachment-error", message: "Attachment limit reached" });
    const failed = captureForComposer({ captureScreenshot: async () => { throw Error("IPC failed"); } }, request, f.target);
    expect(await failed.result).toEqual({ status: "error", code: "capture-failed" });
  });
  it("does not capture for an unsupported host", async () => {
    const f = fixture();
    expect(await captureForComposer({}, request, f.target).result).toEqual({ status: "error", code: "unsupported" });
    expect(f.target.add).not.toHaveBeenCalled();
  });
  it.each(["timeout", "native-unavailable", "overlay-crashed", "invalid-image", "future-host-error"])(
    "falls back to a localized generic error for host code %s", async code => {
      const f = fixture();
      const operation = captureForComposer(f.host, request, f.target);
      f.finish({ status: "error", code });
      expect(await operation.result).toEqual({ status: "error", code: "capture-failed" });
      expect(f.target.add).not.toHaveBeenCalled();
      expect(f.target.focus).toHaveBeenCalledOnce();
    });
  it("supports capture-only hosts and ignores cancellation after bridge disposal", async () => {
    const f = fixture();
    const operation = captureForComposer({ captureScreenshot: f.host.captureScreenshot }, request, f.target);
    expect(operation.cancel).not.toThrow();
    f.finish(image);
    expect(await operation.result).toEqual({ status: "cancelled" });
    const disposed = captureForComposer({ ...f.host, cancelScreenshot() { throw Error("disposed"); } }, request, f.target);
    expect(disposed.cancel).not.toThrow();
    f.finish(image);
    expect(await disposed.result).toEqual({ status: "cancelled" });
    expect(f.target.add).not.toHaveBeenCalled();
  });
});
