import { http, HttpResponse } from "msw";

const API_BASE = "/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-pagination";
  } catch {
    return false;
  }
}

const firstSkill = {
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
  file_sha256: "pagination-skill-1-sha256",
  view_count: 18,
  download_count: 7,
  created_at: "2026-06-04T08:00:00.000Z",
  updated_at: "2026-07-12T10:00:00.000Z",
};

const secondSkill = {
  skill_id: "meeting-note-cleaner",
  name: "meeting-note-cleaner",
  display_name: "会议纪要整理",
  description: "从会议记录中提炼决策和待办。",
  category_id: "dev-tools",
  tags: ["会议", "协作"],
  owner_id: "alice",
  owner_name: "Alice",
  creator_id: "alice",
  creator_name: "Alice",
  space_id: "e2e-space-001",
  visibility: "public",
  version: "0.9.0",
  readme_content: "# 会议纪要整理",
  icon_url: "",
  file_name: "meeting-note-cleaner.zip",
  file_url: "https://example.test/skills/meeting-note-cleaner.zip",
  file_size: 3072,
  file_sha256: "pagination-skill-2-sha256",
  view_count: 12,
  download_count: 5,
  created_at: "2026-06-08T08:00:00.000Z",
  updated_at: "2026-07-10T10:00:00.000Z",
};

export const skillMarketPaginationHandlers = [
  http.get(`*${API_BASE}/skill_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [{ skill_category_id: "dev-tools", name: "开发工具", icon_key: "Terminal", skill_count: 2 }],
    });
  }),
  http.get(`*${API_BASE}/skills`, ({ request }) => {
    if (!enabled()) return undefined;
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor === "page-2") {
      return HttpResponse.json({
        data: [secondSkill],
        pagination: { total: 2, next_cursor: null },
      });
    }
    return HttpResponse.json({
      data: [firstSkill],
      pagination: { total: 2, next_cursor: "page-2" },
    });
  }),
];
