import { http, HttpResponse } from "msw";

const API_BASE = "/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-search";
  } catch {
    return false;
  }
}

const skills = [
  {
    skill_id: "release-risk-radar",
    name: "release-risk-radar",
    display_name: "发布风险雷达",
    description: "结合改动范围和测试覆盖生成发布风险雷达。",
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
    file_sha256: "search-risk-sha256",
    view_count: 18,
    download_count: 7,
    created_at: "2026-06-04T08:00:00.000Z",
    updated_at: "2026-07-12T10:00:00.000Z",
  },
  {
    skill_id: "meeting-note-cleaner",
    name: "meeting-note-cleaner",
    display_name: "会议纪要整理",
    description: "将会议纪要整理为决策、待办和风险。",
    category_id: "office",
    tags: ["纪要", "协作"],
    owner_id: "alice",
    owner_name: "Alice",
    creator_id: "alice",
    creator_name: "Alice",
    space_id: "e2e-space-001",
    visibility: "space",
    version: "1.1.3",
    readme_content: "# 会议纪要整理",
    icon_url: "",
    file_name: "meeting-note-cleaner.zip",
    file_url: "https://example.test/skills/meeting-note-cleaner.zip",
    file_size: 4096,
    file_sha256: "search-notes-sha256",
    view_count: 12,
    download_count: 3,
    created_at: "2026-06-01T08:00:00.000Z",
    updated_at: "2026-07-10T10:00:00.000Z",
  },
];

function filtered(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (!query) return skills;
  return skills.filter((item) =>
    [item.name, item.display_name, item.description, ...item.tags]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

export const skillMarketSearchHandlers = [
  http.get(`*${API_BASE}/skill_categories`, ({ request }) => {
    if (!enabled()) return undefined;
    const items = filtered(request);
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.category_id, (counts.get(item.category_id) ?? 0) + 1);
    }
    return HttpResponse.json({
      data: [
        { skill_category_id: "dev-tools", name: "开发工具", icon_key: "Terminal", skill_count: counts.get("dev-tools") ?? 0 },
        { skill_category_id: "office", name: "办公协作", icon_key: "FolderKanban", skill_count: counts.get("office") ?? 0 },
      ],
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
