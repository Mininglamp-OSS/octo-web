import { http, HttpResponse } from "msw";

const API_BASE = "/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "expert-market-empty";
  } catch {
    return false;
  }
}

const experts = [
  {
    expert_id: "release-lead",
    short_name: "发布",
    name: "发布负责人",
    summary: "统筹发布检查、风险识别和上线决策。",
    category: "研发工具",
    tags: ["发布", "质量"],
    publisher: "Octo Platform",
    visibility: "system",
    creator_name: "[redacted-admin]",
    created_by_type: "human",
    view_count: 24,
    install_count: 8,
  },
  {
    expert_id: "meeting-coordinator",
    short_name: "会议",
    name: "会议协调专家",
    summary: "整理会议议程、决策和后续待办。",
    category: "办公提效",
    tags: ["会议", "协作"],
    publisher: "Octo Community",
    visibility: "space",
    creator_name: "Alice",
    created_by_type: "human",
    view_count: 11,
    install_count: 3,
  },
];

export const expertMarketEmptyHandlers = [
  http.get(`*${API_BASE}/experts`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: experts,
      pagination: { total: 2, page: 1, page_size: 100 },
    });
  }),
  http.get(`*${API_BASE}/expert_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [
        { expert_category_id: "dev-tools", name: "研发工具", count: 1 },
        { expert_category_id: "office", name: "办公提效", count: 1 },
      ],
    });
  }),
];
