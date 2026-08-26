import { http, HttpResponse } from "msw";

// Skill API resolves from WKApp.apiClient's configured /api/v1 base in the
// local E2E preview. Keep this separate from dmworkmcp's /market gateway.
const API_BASE = "/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-list";
  } catch {
    return false;
  }
}

const skill = {
  skill_id: "release-risk-radar",
  name: "release-risk-radar",
  display_name: "发布风险雷达",
  description: "结合改动范围、历史事故和测试覆盖生成发布风险雷达。",
  category_id: "dev-tools",
  tags: ["发布", "风险"],
  owner_id: "platform",
  owner_name: "平台团队",
  creator_id: "platform",
  creator_name: "平台团队",
  space_id: "e2e-space-001",
  visibility: "public",
  version: "1.2.0",
  readme_content: "# 发布风险雷达\n\n根据改动范围生成发布风险检查清单。",
  icon_url: "",
  file_name: "release-risk-radar.zip",
  file_url: "https://example.test/skills/release-risk-radar.zip",
  file_size: 4096,
  file_sha256: "e2e-skill-sha256",
  view_count: 18,
  download_count: 7,
  created_at: "2026-06-04T08:00:00.000Z",
  updated_at: "2026-07-12T10:00:00.000Z",
};

const category = {
  skill_category_id: "dev-tools",
  name: "开发工具",
  icon_key: "Terminal",
  skill_count: 1,
};

export const skillMarketListHandlers = [
  http.get(`*${API_BASE}/skill_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: [category] });
  }),
  http.get(`*${API_BASE}/skills`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [skill],
      pagination: { total: 1, next_cursor: null },
    });
  }),
  http.get(`*${API_BASE}/skills/:id`, ({ params }) => {
    if (!enabled()) return undefined;
    if (params.id !== skill.skill_id) {
      return HttpResponse.json({ error: { message: "Skill not found" } }, { status: 404 });
    }
    return HttpResponse.json({ data: skill });
  }),
  http.get(`*${API_BASE}/skills/:id/skill_md`, ({ params }) => {
    if (!enabled()) return undefined;
    if (params.id !== skill.skill_id) {
      return HttpResponse.json({ error: { message: "Skill not found" } }, { status: 404 });
    }
    return HttpResponse.json({ data: { content: "# 发布风险雷达\n\n根据改动范围生成发布风险检查清单。" } });
  }),
  http.get(`*${API_BASE}/skills/:id/versions`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: { items: [] } });
  }),
  http.post(`*${API_BASE}/metrics/track`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: {} });
  }),
];
