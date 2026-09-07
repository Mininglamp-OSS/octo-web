import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadyReporter } from "./readyReporter";

describe("createReadyReporter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a rejected ready report and stops after success", async () => {
    vi.useFakeTimers();
    const report = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValue(undefined);
    const reporter = createReadyReporter(report, { retryDelayMs: 10 });

    reporter.request();
    await vi.runAllTimersAsync();

    expect(report).toHaveBeenCalledTimes(2);
    reporter.request();
    await vi.runAllTimersAsync();
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("reports the final error after the configured attempt limit", async () => {
    vi.useFakeTimers();
    const error = new Error("persistent IPC failure");
    const report = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const onExhausted = vi.fn();
    const reporter = createReadyReporter(report, {
      maxAttempts: 2,
      retryDelayMs: 10,
      onExhausted,
    });

    reporter.request();
    await vi.runAllTimersAsync();

    expect(report).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledWith(error);
  });

  it("cancels a scheduled retry when disposed", async () => {
    vi.useFakeTimers();
    const report = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("failed"));
    const reporter = createReadyReporter(report, { retryDelayMs: 10 });

    reporter.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    reporter.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();

    expect(report).toHaveBeenCalledTimes(1);
  });

  it("does not invoke a queued report after disposal", async () => {
    const report = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const reporter = createReadyReporter(report);

    reporter.request();
    reporter.dispose();
    await Promise.resolve();

    expect(report).not.toHaveBeenCalled();
  });

  it("retries when the report callback throws synchronously", async () => {
    vi.useFakeTimers();
    const report = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error("synchronous IPC failure");
      })
      .mockResolvedValue(undefined);
    const reporter = createReadyReporter(report, { retryDelayMs: 10 });

    expect(() => reporter.request()).not.toThrow();
    await vi.runAllTimersAsync();

    expect(report).toHaveBeenCalledTimes(2);
  });

  it("isolates an onExhausted callback that throws", async () => {
    const report = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("failed"));
    const onExhausted = vi.fn(() => {
      throw new Error("diagnostic failure");
    });
    const reporter = createReadyReporter(report, {
      maxAttempts: 1,
      onExhausted,
    });

    reporter.request();
    await vi.waitFor(() => expect(onExhausted).toHaveBeenCalledTimes(1));
  });

  it("times out a stuck report and continues retrying", async () => {
    vi.useFakeTimers();
    const report = vi.fn<() => Promise<void>>(() => new Promise(() => {}));
    const onExhausted = vi.fn();
    const reporter = createReadyReporter(report, {
      maxAttempts: 2,
      retryDelayMs: 5,
      attemptTimeoutMs: 10,
      onExhausted,
    });

    reporter.request();
    await vi.runAllTimersAsync();

    expect(report).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Ready report attempt timed out after 10ms" }),
    );
  });
});
