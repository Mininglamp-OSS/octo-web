import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMobileDownloadUrl,
  MOBILE_DOWNLOAD_REQUEST_TIMEOUT_MS,
  resolveMobileUpdaterUrl,
  resolveSafeDownloadUrl,
} from "../mobileDownloadUpdater";

describe("mobile download updater", () => {
  afterEach(() => vi.useRealTimers());

  it("normalizes updater paths and download URLs", () => {
    expect(resolveMobileUpdaterUrl("/common/updater/android/1.0", "https://api.test/")).toBe(
      "https://api.test/common/updater/android/1.0",
    );
    expect(resolveSafeDownloadUrl("\u00a0\u200bhttps://cdn.test/app.apk\u200b")).toBe(
      "https://cdn.test/app.apk",
    );
    expect(resolveSafeDownloadUrl("javascript:alert(1)")).toBeUndefined();
    expect(resolveSafeDownloadUrl("/app.apk")).toBeUndefined();
    expect(resolveSafeDownloadUrl("/app.apk", "https://app.test")).toBe(
      "https://app.test/app.apk",
    );
  });

  it("aborts a stalled updater request after the shared timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });

    const request = fetchMobileDownloadUrl("common/updater/ios/1.0.0", fetcher, "https://api.test");
    const rejection = expect(request).rejects.toThrow("Aborted");
    await vi.advanceTimersByTimeAsync(MOBILE_DOWNLOAD_REQUEST_TIMEOUT_MS);

    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.test/common/updater/ios/1.0.0",
      expect.objectContaining({ signal }),
    );
    await rejection;
  });
});
