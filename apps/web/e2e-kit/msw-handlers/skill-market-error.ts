import { http, HttpResponse } from "msw";

const API_BASE = "/api/v1";

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
  http.get(`*${API_BASE}/skill_categories`, () => {
    if (!enabled()) return undefined;
    return unavailable();
  }),
  http.get(`*${API_BASE}/skills`, () => {
    if (!enabled()) return undefined;
    return unavailable();
  }),
];
