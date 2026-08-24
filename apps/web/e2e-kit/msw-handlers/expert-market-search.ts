import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). Keyword filtering is client-side
// over the fetched slice, so the list endpoint returns the full catalog and the
// page narrows it as the user types.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "expert-market-search";
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

export const expertMarketSearchHandlers = [
  http.get(`*${API_BASE}/plugins`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: plugins,
      pagination: { total: 2, page: 1, page_size: 100 },
    });
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
