import { http, HttpResponse } from "msw";

// Apply keyword filtering before pagination, matching the unified plugin API.
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

// Production regression: matching names at positions 66 and 112.
const plugins = Array.from({ length: 112 }, (_, index) => ({
  ...firstPlugin,
  plugin_id: `catalog-expert-${index + 1}`,
  plugin_name: index === 65 ? "数据分析报告专家" : index === 111 ? "数据分析报告师" : `目录专家${index + 1}`,
  tags: index === 111 ? ["rare-report"] : index < 50 ? [`topic-${index}`] : firstPlugin.tags,
}));

export const expertMarketTruncatedHandlers = [
  http.get(`*${API_BASE}/plugins`, ({ request }) => {
    if (!enabled()) return undefined;
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").toLowerCase();
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("page_size") ?? 100);
    const tags = [...params.getAll("tag"), ...params.getAll("tag[]")];
    const filtered = plugins.filter((plugin) => plugin.plugin_name.toLowerCase().includes(q) && tags.every((tag) => plugin.tags.includes(tag)));
    return HttpResponse.json({
      data: filtered.slice((page - 1) * pageSize, page * pageSize),
      pagination: { total: filtered.length, page, page_size: pageSize },
    });
  }),
  http.get(`*${API_BASE}/plugin_tags`, ({ request }) => {
    if (!enabled()) return undefined;
    const tags = Array.from(new Set(plugins.flatMap((plugin) => plugin.tags)));
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    return HttpResponse.json({ data: tags.filter((name) => name.toLowerCase().includes(q)).slice(0, 50).map((name) => ({ name, count: 1 })) });
  }),
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [
        { category_id: "dev-tools", name: "研发工具", sort_order: 0, plugin_count: 112 },
      ],
    });
  }),
];
