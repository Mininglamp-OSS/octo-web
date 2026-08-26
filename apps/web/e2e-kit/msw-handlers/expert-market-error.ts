import { http, HttpResponse } from "msw";

const API_BASE = "/api/v1";

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
  http.get(`*${API_BASE}/experts`, () => {
    if (!enabled()) return undefined;
    return unavailable();
  }),
  http.get(`*${API_BASE}/expert_categories`, () => {
    if (!enabled()) return undefined;
    return unavailable();
  }),
];
