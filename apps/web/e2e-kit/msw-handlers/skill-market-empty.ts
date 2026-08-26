import { http, HttpResponse } from "msw";

const API_BASE = "/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-empty";
  } catch {
    return false;
  }
}

const skill = {
  skill_id: "release-risk-radar",
  name: "release-risk-radar",
  display_name: "发布风险雷达",
  description: "结合改动范围生成发布风险雷达。",
  category_id: "dev-tools",
  tags: ["发布", "风险"],
  owner_id: "platform",
  owner_name: "平台团队",
  creator_id: "platform",
  creator_name: "平台团队",
  space_id: "e2e-space-001",
  visibility: "public",
  version: "1.2.0",
  readme_content: "# 发布风险雷达",
  icon_url: "",
  file_name: "release-risk-radar.zip",
  file_url: "https://example.test/skills/release-risk-radar.zip",
  file_size: 4096,
  file_sha256: "empty-skill-sha256",
  view_count: 18,
  download_count: 7,
  created_at: "2026-06-04T08:00:00.000Z",
  updated_at: "2026-07-12T10:00:00.000Z",
};

function filtered(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return query === "不存在" ? [] : [skill];
}

export const skillMarketEmptyHandlers = [
  http.get(`*${API_BASE}/skill_categories`, ({ request }) => {
    if (!enabled()) return undefined;
    const items = filtered(request);
    return HttpResponse.json({
      data: items.length
        ? [{ skill_category_id: "dev-tools", name: "开发工具", icon_key: "Terminal", skill_count: 1 }]
        : [],
    });
  }),
  http.get(`*${API_BASE}/skills`, ({ request }) => {
    if (!enabled()) return undefined;
    const items = filtered(request);
    return HttpResponse.json({
      data: items,
      pagination: { total: items.length, next_cursor: null },
    });
  }),
];
