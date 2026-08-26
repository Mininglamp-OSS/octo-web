import { afterEach, describe, expect, it, vi } from "vitest";
import { debounce, throttle } from "../rateLimit";

describe("debounce", () => {
  afterEach(() => vi.useRealTimers());

  it("invokes once with the latest arguments after the wait", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced("first");
    vi.advanceTimersByTime(50);
    debounced("latest");
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith("latest");
  });

  it("cancels a pending invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.runAllTimers();

    expect(fn).not.toHaveBeenCalled();
  });
});

describe("throttle", () => {
  afterEach(() => vi.useRealTimers());

  it("replays the first suppressed arguments on the trailing call", () => {
    // Characterize the current throttle contract. Callers that pass pooled
    // React events must extract stable values before invoking this helper.
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled("first");
    throttled("second");
    throttled("third");

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith("first");

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("second");
  });
});
