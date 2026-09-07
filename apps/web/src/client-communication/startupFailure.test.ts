import { afterEach, describe, expect, it, vi } from "vitest";
import { reportStartupFailure } from "./startupFailure";

describe("reportStartupFailure", () => {
  afterEach(() => {
    delete window.octoBuddyCommunication;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the fallback even when fatal error reporting throws", () => {
    const reportError = new Error("fatal IPC failure");
    const reportFatalError = vi.fn(() => {
      throw reportError;
    });
    window.octoBuddyCommunication = { reportFatalError } as never;
    document.body.innerHTML = '<div id="root"></div>';
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportStartupFailure(new Error("bootstrap failed"));

    expect(reportFatalError).toHaveBeenCalledWith({
      message: "bootstrap failed",
      stack: expect.any(String),
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[client-communication] failed to report startup error",
      reportError,
    );
    expect(document.getElementById("root")?.textContent).toBe(
      "Communication module failed to start: bootstrap failed",
    );
  });
});
