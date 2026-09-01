import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). The list fetch caps at page_size
// 100 while the true total is 101, so the page renders the "仅显示前 100 项"
// truncation notice (total from pagination.total exceeds the loaded slice).
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "expert-market-truncated";
  } catch {
    return false;
  }
}

const firstPlugin = {
  plugin_id: "release-lead",
  plugin_name: "发布负责人",
  plugin_type: "expert" as const,
  category_id: "dev-tools",
  tags: ["发布", "质量"],
  publisher: "Octo Platform",
  owner_id: "space-e2e",
  visibility: "system" as const,
  creator_name: "[redacted-admin]",
  created_by_type: "human" as const,
  icon_url: "",
  view_count: 24,
  install_count: 8,
  download_count: 0,
  current_version: "1.0.0",
  manifest_json: {
    name: "release-lead",
    description: "统筹发布检查、风险识别和上线决策。",
    labels: ["发布", "质量"],
  },
  created_at: "2026-07-10T08:00:00Z",
  updated_at: "2026-07-20T08:00:00Z",
};

// 100 loaded rows against a true total of 101 → one page over the cap.
const plugins = [
  firstPlugin,
  ...Array.from({ length: 99 }, (_, index) => ({
    ...firstPlugin,
    plugin_id: `catalog-expert-${index + 2}`,
    plugin_name: `目录专家${index + 2}`,
    visibility: "space" as const,
    tags: ["目录"],
    manifest_json: {
      name: `catalog-expert-${index + 2}`,
      description: `用于分页边界验证的目录专家 ${index + 2}。`,
      labels: ["目录"],
    },
  })),
];

export const expertMarketTruncatedHandlers = [
  http.get(`*${API_BASE}/plugins`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: plugins,
      pagination: { total: 101, page: 1, page_size: 100 },
    });
  }),
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [
        { category_id: "dev-tools", name: "研发工具", sort_order: 0, plugin_count: 101 },
      ],
    });
  }),
];
