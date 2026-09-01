import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). The skills list paginates by page
// number: skillApiReal threads the legacy opaque cursor through as the next
// page and synthesizes nextCursor while `page * page_size < total`. Report a
// page_size of 1 against a total of 2 so page 1 leaves one row remaining and
// the sentinel triggers a page-2 append (request carries `page=2`).
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-pagination";
  } catch {
    return false;
  }
}

const firstSkill = {
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

const secondSkill = {
  plugin_id: "meeting-note-cleaner",
  plugin_name: "会议纪要整理",
  plugin_type: "skill" as const,
  category_id: "dev-tools-cat",
  tags: ["会议", "协作"],
  publisher: "Alice",
  owner_id: "alice",
  space_id: "e2e-space-001",
  visibility: "public" as const,
  creator_name: "Alice",
  created_by_type: "human" as const,
  icon_url: "",
  view_count: 12,
  download_count: 5,
  install_count: 0,
  current_version: "0.9.0",
  manifest_json: {
    name: "meeting-note-cleaner",
    description: "从会议记录中提炼决策和待办。",
    labels: ["会议", "协作"],
  },
  created_at: "2026-06-08T08:00:00.000Z",
  updated_at: "2026-07-10T10:00:00.000Z",
};

export const skillMarketPaginationHandlers = [
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [{ category_id: "dev-tools-cat", name: "开发工具", icon_key: "Terminal", sort_order: 0, plugin_count: 2 }],
    });
  }),
  http.get(`*${API_BASE}/plugins`, ({ request }) => {
    if (!enabled()) return undefined;
    const page = Number.parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1;
    if (page >= 2) {
      return HttpResponse.json({
        data: [secondSkill],
        pagination: { total: 2, page: 2, page_size: 1 },
      });
    }
    return HttpResponse.json({
      data: [firstSkill],
      pagination: { total: 2, page: 1, page_size: 1 },
    });
  }),
];
