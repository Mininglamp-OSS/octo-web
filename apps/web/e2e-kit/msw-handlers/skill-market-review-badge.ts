import { http, HttpResponse } from "msw";

// 组织发布管理 badge invalidation (RB1).
//
// The sidebar badge and the 待审核 list are two independent reads of the same
// queue — the badge has to render while ReviewQueue is unmounted, so it cannot
// be derived from the queue's state. This scenario exists to prove the two now
// move together: a decision taken in the queue must drop the sidebar count
// without a page reload.
//
// Deliberately STATEFUL: `approve` mutates the pending list so the badge's
// re-read genuinely returns a smaller number. A stub that always answered
// total=1 would pass whether or not the badge re-read at all.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-review-badge";
  } catch {
    return false;
  }
}

interface PendingRequest {
  review_id: string;
  plugin_id: string;
  plugin_name: string;
  plugin_type: string;
  space_id: string;
  target_scope: string;
  status: string;
  kind: string;
  version: string;
  changelog: string;
  applicant_id: string;
  applicant_name: string;
  submitted_at: string;
  plugin_listing_state: string;
}

const basePending: PendingRequest[] = [
  {
    review_id: "rb1-review-1",
    plugin_id: "rb1-plugin-1",
    plugin_name: "发布风险雷达",
    plugin_type: "skill",
    space_id: "e2e-space-001",
    target_scope: "space",
    status: "pending",
    kind: "first",
    version: "1.0.0",
    changelog: "首次提交组织审核",
    applicant_id: "e2e-user-2",
    applicant_name: "Jian",
    submitted_at: "2026-08-31T10:00:00.000Z",
    plugin_listing_state: "draft",
  },
];

// Reset per page load: `enabled()` is evaluated per request, and MSW handlers
// live for the whole session, so without this a second navigation in the same
// worker would start from an already-approved queue.
let pending: PendingRequest[] = [...basePending];
let approvedAt: PendingRequest[] = [];

function resetIfFreshLoad() {
  try {
    const marker = sessionStorage.getItem("__e2e_rb1_loaded");
    if (marker === "1") return;
    sessionStorage.setItem("__e2e_rb1_loaded", "1");
  } catch {
    /* storage unavailable — keep whatever state we have */
  }
  pending = [...basePending];
  approvedAt = [];
}

function pageOf(items: PendingRequest[], url: URL) {
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = Number.parseInt(url.searchParams.get("page_size") ?? "20", 10) || 20;
  const start = (page - 1) * pageSize;
  return {
    data: items.slice(start, start + pageSize),
    pagination: { total: items.length, page, page_size: pageSize },
  };
}

export const skillMarketReviewBadgeHandlers = [
  http.get(`*${API_BASE}/plugin_review_policies`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: { is_auto_approve_enabled: true } });
  }),
  http.patch(`*${API_BASE}/plugin_review_policies`, async ({ request }) => {
    if (!enabled()) return undefined;
    const body = await request.json() as { is_auto_approve_enabled?: boolean };
    return HttpResponse.json({
      data: { is_auto_approve_enabled: body.is_auto_approve_enabled === true },
    });
  }),
  http.post(`*${API_BASE}/plugins/review_requests/:id/approve`, ({ params }) => {
    if (!enabled()) return undefined;
    const id = String(params.id);
    const target = pending.find((item) => item.review_id === id);
    if (!target) {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: "already decided" } },
        { status: 409 },
      );
    }
    pending = pending.filter((item) => item.review_id !== id);
    approvedAt = [...approvedAt, { ...target, status: "approved", plugin_listing_state: "published" }];
    return HttpResponse.json({ data: {} });
  }),
  http.get(`*${API_BASE}/plugins/review_requests`, ({ request }) => {
    if (!enabled()) return undefined;
    resetIfFreshLoad();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    if (status === "approved") return HttpResponse.json(pageOf(approvedAt, url));
    if (status === "rejected" || status === "canceled") {
      return HttpResponse.json(pageOf([], url));
    }
    return HttpResponse.json(pageOf(pending, url));
  }),
  // The right pane boots into the skills market before the deep link resolves;
  // answer its catalog reads so the page does not sit on an error state.
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: [] });
  }),
  http.get(`*${API_BASE}/plugins`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: [], pagination: { total: 0, page: 1, page_size: 20 } });
  }),
  http.post(`*${API_BASE}/metrics/track`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: {} });
  }),
];
