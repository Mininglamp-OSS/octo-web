import type { BrowserContext, Request, Response } from "@playwright/test";

const API_PATH = /^\/(?:api|summary\/api)(?:\/|$)/;
const SUMMARY_API_PATH = /^\/summary\/api(?:\/|$)/;
const DEAD_BACKEND_HOSTS = new Set(["127.0.0.1:9", "mock.e2e.local"]);

/**
 * Opt-in guard for happy-path mock tests. Install before the first navigation.
 * Context events include SW-owned passthrough requests that page events miss
 * when the originating document has already unloaded. Observe, never fulfill.
 */
export function monitorMockNetwork(context: BrowserContext) {
  const issues: string[] = [];
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (DEAD_BACKEND_HOSTS.has(url.host)) {
      issues.push(`Real backend request: ${request.method()} ${request.url()}`);
    } else if (API_PATH.test(url.pathname) && request.serviceWorker()) {
      issues.push(`Service Worker API passthrough: ${request.method()} ${request.url()}`);
    }
  };
  const onResponse = (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (!API_PATH.test(path)) return;
    const status = response.status();
    // The shared boot mock intentionally returns 400 for unknown user devices.
    // Summary happy paths, however, must not receive any 4xx or 5xx response.
    if (status >= 500 || status === 401 || (SUMMARY_API_PATH.test(path) && status >= 400)) {
      issues.push(`API ${status}: ${response.request().method()} ${response.url()}`);
    }
  };
  const onRequestFailed = (request: Request) => {
    if (!API_PATH.test(new URL(request.url()).pathname)) return;
    const error = request.failure()?.errorText ?? "unknown network error";
    // Page navigations may cancel in-flight requests normally. SW passthrough
    // is already recorded on request, even if that outgoing request is aborted.
    if (error !== "net::ERR_ABORTED") {
      issues.push(`API network failure: ${request.method()} ${request.url()} (${error})`);
    }
  };

  context.on("request", onRequest);
  context.on("response", onResponse);
  context.on("requestfailed", onRequestFailed);
  return {
    issues,
    stop() {
      context.off("request", onRequest);
      context.off("response", onResponse);
      context.off("requestfailed", onRequestFailed);
    },
  };
}
