export interface ScreenshotRequest {
  requestId: string;
  locale: "zh-CN" | "en-US";
  /** Hide the chat window while the overlay is up. Defaults to false, so the window stays in the shot. */
  hideChatWindow?: boolean;
}
export type ScreenshotResult =
  | { status: "ok"; bytes: Uint8Array; filename: string; mimeType: "image/png"; width: number; height: number }
  | { status: "cancelled" }
  | { status: "error"; code: "busy" | "permission" | "unsupported" | "capture-failed" | (string & {}) };
export interface ScreenshotHost {
  captureScreenshot?(request: ScreenshotRequest): Promise<ScreenshotResult>;
  cancelScreenshot?(request: ScreenshotRequest): Promise<void>;
}
