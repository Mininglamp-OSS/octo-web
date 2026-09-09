export async function enableClientFeatureMocks(label: string): Promise<void> {
  if (import.meta.env.VITE_E2E_MOCK !== "1") return;
  try {
    const { worker } = await import("../mocks/browser");
    const {
      MSW_PROBE_PATH,
      MSW_CONTROL_TIMEOUT_MS,
      MSW_PROBE_TIMEOUT_MS,
      waitForMockInterception,
      waitForServiceWorkerControl,
    } = await import("../mocks/swControl");
    await worker.start({ onUnhandledRequest: "bypass" });
    const { http, HttpResponse } = await import("msw");
    (window as unknown as {
      __msw?: { worker: typeof worker; http: typeof http; HttpResponse: typeof HttpResponse };
    }).__msw = { worker, http, HttpResponse };
    const usesInterceptorFallback = window.location.protocol === "file:";
    const controlled =
      usesInterceptorFallback ||
      (await waitForServiceWorkerControl(MSW_CONTROL_TIMEOUT_MS));
    const intercepting =
      controlled &&
      (await waitForMockInterception(
        MSW_PROBE_TIMEOUT_MS,
        usesInterceptorFallback
          ? {
              fetchFn: (_input, init) =>
                fetch(
                  new URL(MSW_PROBE_PATH, "https://octobuddy.e2e.invalid"),
                  init
                ),
            }
          : undefined
      ));
    if (!intercepting) {
      console.warn(`[${label}-e2e] MSW started without confirmed interception`);
    }
    (window as unknown as { __MSW_READY__?: boolean }).__MSW_READY__ =
      intercepting;
  } catch (error) {
    console.warn(`[${label}-e2e] MSW disabled:`, error);
  }
}
