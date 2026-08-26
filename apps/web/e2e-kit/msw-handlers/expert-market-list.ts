import { http, HttpResponse } from "msw";

const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "expert-market-list";
  } catch {
    return false;
  }
}

const expert = {
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
};

const detail = {
  ...expert,
  instruction: "你负责检查发布风险，并给出可执行的上线建议。",
  mcp_config: "{}",
  skills: [],
  created_at: "2026-07-10T08:00:00Z",
  updated_at: "2026-07-20T08:00:00Z",
};

export const expertMarketListHandlers = [
  http.get(`*${API_BASE}/experts`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [expert],
      pagination: { total: 1, page: 1, page_size: 100 },
    });
  }),
  http.get(`*${API_BASE}/expert_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [{ expert_category_id: "dev-tools", name: "研发工具", count: 1 }],
    });
  }),
  http.get(`*${API_BASE}/experts/:id`, ({ params }) => {
    if (!enabled()) return undefined;
    if (params.id !== expert.expert_id) {
      return HttpResponse.json({ error: { message: "Expert not found" } }, { status: 404 });
    }
    return HttpResponse.json({ data: detail });
  }),
  http.post(`*${API_BASE}/metrics/track`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: {} });
  }),
];
