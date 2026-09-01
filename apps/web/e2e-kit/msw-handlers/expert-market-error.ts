import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). Both the list and category fetches
// fire in parallel on mount; a 5xx on either classifies as the "server" list
// error (mcp.list.error.server → "服务暂时不可用，请稍后重试") and the page shows
// the retry state. Fail both so whichever settles first drives the error.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "expert-market-error";
  } catch {
    return false;
  }
}

function unavailable() {
  return HttpResponse.json(
    { error: { message: "Experts market temporarily unavailable" } },
    { status: 503 },
  );
}

export const expertMarketErrorHandlers = [
  http.get(`*${API_BASE}/plugins`, () => {
    if (!enabled()) return undefined;
    return unavailable();
  }),
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return unavailable();
  }),
];
