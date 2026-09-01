import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). Both the list and category fetches
// fire in parallel on mount; a 5xx on either surfaces the load-failure state
// (加载失败 + 重试). Fail both /plugins and /plugin_categories so whichever
// settles first drives the error.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-error";
  } catch {
    return false;
  }
}

function unavailable() {
  return HttpResponse.json(
    { error: { message: "Skills market temporarily unavailable" } },
    { status: 503 },
  );
}

export const skillMarketErrorHandlers = [
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return unavailable();
  }),
  http.get(`*${API_BASE}/plugins`, () => {
    if (!enabled()) return undefined;
    return unavailable();
  }),
];
