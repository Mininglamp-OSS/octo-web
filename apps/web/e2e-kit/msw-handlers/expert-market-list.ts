import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). The expert market migrated off the
// legacy /experts + /expert_categories endpoints onto /plugins,
// /plugins/detail and /plugin_categories (plugin_type=expert). Fixtures are
// plugin-wire shaped so the expertWire mappers project them back to the
// ExpertItem view model the UI renders.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "expert-market-list";
  } catch {
    return false;
  }
}

// One expert plugin (list projection). visibility=system drives the "官方发布"
// badge; manifest_json.description is the card/detail summary.
const expertPlugin = {
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

// Detail carries the package attachments; the expert instruction is the raw
// AGENTS.md attachment (expertService.getExpertReal reads it via rawAttachment).
const detail = {
  plugin: {
    ...expertPlugin,
    plugin_json: {
      attachments: [
        {
          path: "AGENTS.md",
          content_type: "raw" as const,
          mime_type: "text/markdown",
          raw_content: "你负责检查发布风险，并给出可执行的上线建议。",
        },
      ],
    },
  },
  relations: [],
};

export const expertMarketListHandlers = [
  http.get(`*${API_BASE}/plugins/detail`, ({ request }) => {
    if (!enabled()) return undefined;
    const pluginId = new URL(request.url).searchParams.get("plugin_id");
    if (pluginId !== expertPlugin.plugin_id) {
      return HttpResponse.json({ error: { message: "Plugin not found" } }, { status: 404 });
    }
    return HttpResponse.json({ data: detail });
  }),
  http.get(`*${API_BASE}/plugins`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [expertPlugin],
      pagination: { total: 1, page: 1, page_size: 100 },
    });
  }),
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [
        { category_id: "dev-tools", name: "研发工具", sort_order: 0, plugin_count: 1 },
      ],
    });
  }),
  http.post(`*${API_BASE}/metrics/track`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: {} });
  }),
];
