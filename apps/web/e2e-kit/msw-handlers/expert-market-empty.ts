import { http, HttpResponse } from "msw";

// Apply keyword filtering before pagination, matching the unified plugin API.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "expert-market-empty";
  } catch {
    return false;
  }
}

const plugins = [
  {
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
  },
  {
    plugin_id: "meeting-coordinator",
    plugin_name: "会议协调专家",
    plugin_type: "expert" as const,
    category_id: "office",
    tags: ["会议", "协作"],
    publisher: "Octo Community",
    owner_id: "space-e2e",
    visibility: "space" as const,
    creator_name: "Alice",
    created_by_type: "human" as const,
    icon_url: "",
    view_count: 11,
    install_count: 3,
    download_count: 0,
    current_version: "1.0.0",
    manifest_json: {
      name: "meeting-coordinator",
      description: "整理会议议程、决策和后续待办。",
      labels: ["会议", "协作"],
    },
    created_at: "2026-07-11T08:00:00Z",
    updated_at: "2026-07-21T08:00:00Z",
  },
];

export const expertMarketEmptyHandlers = [
  http.get(`*${API_BASE}/plugins`, ({ request }) => {
    if (!enabled()) return undefined;
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").toLowerCase();
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("page_size") ?? 100);
    const filtered = plugins.filter((plugin) => plugin.plugin_name.toLowerCase().includes(q));
    return HttpResponse.json({
      data: filtered.slice((page - 1) * pageSize, page * pageSize),
      pagination: { total: filtered.length, page, page_size: pageSize },
    });
  }),
  http.get(`*${API_BASE}/plugin_tags`, () => {
    if (!enabled()) return undefined;
    const tags = Array.from(new Set(plugins.flatMap((plugin) => plugin.tags)));
    return HttpResponse.json({ data: tags.map((name) => ({ name, count: 1 })) });
  }),
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [
        { category_id: "dev-tools", name: "研发工具", sort_order: 0, plugin_count: 1 },
        { category_id: "office", name: "办公提效", sort_order: 1, plugin_count: 1 },
      ],
    });
  }),
];
