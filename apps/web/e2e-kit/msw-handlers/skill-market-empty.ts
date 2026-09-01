import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). One skill loads, then the spec
// searches for a keyword that matches nothing (server-side filter over the `q`
// param) so /plugins returns an empty slice and the page renders its 暂无数据
// empty state.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-empty";
  } catch {
    return false;
  }
}

const skill = {
  plugin_id: "release-risk-radar",
  plugin_name: "发布风险雷达",
  plugin_type: "skill" as const,
  category_id: "dev-tools-cat",
  tags: ["发布", "风险"],
  publisher: "平台团队",
  owner_id: "platform",
  space_id: "e2e-space-001",
  visibility: "public" as const,
  creator_name: "平台团队",
  created_by_type: "human" as const,
  icon_url: "",
  view_count: 18,
  download_count: 7,
  install_count: 0,
  current_version: "1.2.0",
  manifest_json: {
    name: "release-risk-radar",
    description: "结合改动范围生成发布风险雷达。",
    labels: ["发布", "风险"],
  },
  created_at: "2026-06-04T08:00:00.000Z",
  updated_at: "2026-07-12T10:00:00.000Z",
};

function filtered(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return query === "不存在" ? [] : [skill];
}

export const skillMarketEmptyHandlers = [
  http.get(`*${API_BASE}/plugin_categories`, ({ request }) => {
    if (!enabled()) return undefined;
    const items = filtered(request);
    return HttpResponse.json({
      data: items.length
        ? [{ category_id: "dev-tools-cat", name: "开发工具", icon_key: "Terminal", sort_order: 0, plugin_count: 1 }]
        : [],
    });
  }),
  http.get(`*${API_BASE}/plugins`, ({ request }) => {
    if (!enabled()) return undefined;
    const items = filtered(request);
    return HttpResponse.json({
      data: items,
      pagination: { total: items.length, page: 1, page_size: 20 },
    });
  }),
];
