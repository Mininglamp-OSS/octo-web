export interface ReadyReporter {
  request(): void;
  dispose(): void;
}

export interface ReadyReporterOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
  onExhausted?: (error: unknown) => void;
}

export function createReadyReporter(
  report: () => Promise<void>,
  options: ReadyReporterOptions = {},
): ReadyReporter {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 5000;
  let attempts = 0;
  let disposed = false;
  let inFlight = false;
  let reported = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attemptTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelAttempt: (() => void) | undefined;

  const runAttempt = () => new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (attemptTimer) clearTimeout(attemptTimer);
      attemptTimer = undefined;
      cancelAttempt = undefined;
      callback();
    };

    attemptTimer = setTimeout(() => {
      finish(() => reject(new Error(
        `Ready report attempt timed out after ${attemptTimeoutMs}ms`,
      )));
    }, attemptTimeoutMs);
    cancelAttempt = () => finish(resolve);

    void Promise.resolve()
      .then(() => {
        if (settled) return;
        return report();
      })
      .then(
        () => finish(resolve),
        (error: unknown) => finish(() => reject(error)),
      );
  });

  const request = () => {
    if (disposed || reported || inFlight || retryTimer || attempts >= maxAttempts) return;
    attempts += 1;
    inFlight = true;
    void Promise.resolve()
      .then(() => {
        if (disposed) return;
        return runAttempt();
      })
      .then(() => {
        inFlight = false;
        if (!disposed) reported = true;
      })
      .catch((error: unknown) => {
        inFlight = false;
        if (disposed) return;
        if (attempts >= maxAttempts) {
          try {
            options.onExhausted?.(error);
          } catch {
            // Diagnostics must not escape the retry controller.
          }
          return;
        }
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          request();
        }, retryDelayMs);
      });
  };

  return {
    request,
    dispose() {
      disposed = true;
      cancelAttempt?.();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
    },
  };
}
