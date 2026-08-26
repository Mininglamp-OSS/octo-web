import { http, HttpResponse } from "msw";

const API_BASE = "/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "expert-market-truncated";
  } catch {
    return false;
  }
}

const firstExpert = {
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

const experts = [
  firstExpert,
  ...Array.from({ length: 99 }, (_, index) => ({
    ...firstExpert,
    expert_id: `catalog-expert-${index + 2}`,
    short_name: `专家${index + 2}`,
    name: `目录专家${index + 2}`,
    summary: `用于分页边界验证的目录专家 ${index + 2}。`,
    tags: ["目录"],
  })),
];

export const expertMarketTruncatedHandlers = [
  http.get(`*${API_BASE}/experts`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: experts,
      pagination: { total: 101, page: 1, page_size: 100 },
    });
  }),
  http.get(`*${API_BASE}/expert_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [{ expert_category_id: "dev-tools", name: "研发工具", count: 101 }],
    });
  }),
];
