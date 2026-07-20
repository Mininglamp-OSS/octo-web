import { afterEach, describe, expect, it, vi } from "vitest";
import { runOnboardingViewTransition } from "./viewTransition";

describe("runOnboardingViewTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "startViewTransition");
    Reflect.deleteProperty(document.documentElement, "animate");
    delete document.documentElement.dataset.octoOnboardingVt;
    document.documentElement.style.removeProperty(
      "--wk-onboarding-vt-duration"
    );
    document.documentElement.style.removeProperty(
      "--wk-onboarding-vt-clip-from"
    );
  });

  it("waits for the captured transition to finish before running onFinished", async () => {
    let resolveFinished: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const onTransition = vi.fn();
    const onFinished = vi.fn();
    const animate = vi.fn();

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((callback: () => void) => {
        callback();
        return { ready: Promise.resolve(), finished };
      }),
    });
    Object.defineProperty(document.documentElement, "animate", {
      configurable: true,
      value: animate,
    });

    expect(runOnboardingViewTransition({ onFinished, onTransition })).toBe(
      true
    );
    expect(onTransition).toHaveBeenCalledOnce();
    expect(onFinished).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.octoOnboardingVt).toBe("active");

    await Promise.resolve();
    expect(animate).toHaveBeenCalledOnce();

    resolveFinished?.();
    await finished;
    await Promise.resolve();

    expect(onFinished).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.octoOnboardingVt).toBeUndefined();
  });
});
