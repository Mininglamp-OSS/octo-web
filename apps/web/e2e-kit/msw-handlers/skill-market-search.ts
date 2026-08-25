import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). Skill search is server-side: the
// list page re-fetches /plugins with the `q` param (useSkills debounces query →
// fetchPage), and the "共 N 个技能" count binds to pagination.total. Filter the
// fixture set by `q` and report the narrowed total so the count follows.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-search";
  } catch {
    return false;
  }
}

const skills = [
  {
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
      description: "结合改动范围和测试覆盖生成发布风险雷达。",
      labels: ["发布", "风险"],
    },
    created_at: "2026-06-04T08:00:00.000Z",
    updated_at: "2026-07-12T10:00:00.000Z",
  },
  {
    plugin_id: "meeting-note-cleaner",
    plugin_name: "会议纪要整理",
    plugin_type: "skill" as const,
    category_id: "office-cat",
    tags: ["纪要", "协作"],
    publisher: "Alice",
    owner_id: "alice",
    space_id: "e2e-space-001",
    visibility: "space" as const,
    creator_name: "Alice",
    created_by_type: "human" as const,
    icon_url: "",
    view_count: 12,
    download_count: 3,
    install_count: 0,
    current_version: "1.1.3",
    manifest_json: {
      name: "meeting-note-cleaner",
      description: "将会议纪要整理为决策、待办和风险。",
      labels: ["纪要", "协作"],
    },
    created_at: "2026-06-01T08:00:00.000Z",
    updated_at: "2026-07-10T10:00:00.000Z",
  },
];

function filtered(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (!query) return skills;
  return skills.filter((item) =>
    [item.plugin_name, item.manifest_json.name, item.manifest_json.description, ...item.tags]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

export const skillMarketSearchHandlers = [
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [
        { category_id: "dev-tools-cat", name: "开发工具", icon_key: "Terminal", sort_order: 0, plugin_count: 1 },
        { category_id: "office-cat", name: "办公协作", icon_key: "FolderKanban", sort_order: 1, plugin_count: 1 },
      ],
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
