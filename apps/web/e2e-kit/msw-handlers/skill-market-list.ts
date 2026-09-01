import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). The skills market migrated off the
// legacy /skills + /skill_categories endpoints onto /plugins, /plugins/detail,
// /plugin_categories, /plugins/skill_md and /plugins/versions
// (plugin_type=skill), served from the /market gateway. Fixtures are
// plugin-wire shaped so skillApiReal's mapSkill/mapSkillDetail project them
// back to the Skill view model. visibility=public → the "官方发布" platform
// badge (isPlatformPublishedSkill); manifest_json.name is the machine name the
// card's accessible label uses, plugin_name is the display name.
const API_BASE = "/market/api/v1";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "skill-market-list";
  } catch {
    return false;
  }
}

const SKILL_MD =
  "# 发布风险雷达\n\n根据改动范围生成发布风险检查清单。";

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
    description: "结合改动范围、历史事故和测试覆盖生成发布风险雷达。",
    labels: ["发布", "风险"],
  },
  created_at: "2026-06-04T08:00:00.000Z",
  updated_at: "2026-07-12T10:00:00.000Z",
};

// Detail carries the SKILL.md raw attachment (tree shape); mapSkillDetail reads
// readmeContent from it, the modal body renders /plugins/skill_md.
const detail = {
  plugin: {
    ...skill,
    plugin_json: {
      $schema: "cowork-plugin-package-1.0.json",
      attachments: [
        {
          path: "SKILL.md",
          content_type: "raw" as const,
          mime_type: "text/markdown",
          raw_content: SKILL_MD,
        },
      ],
    },
  },
  relations: [],
};

const category = {
  category_id: "dev-tools-cat",
  name: "开发工具",
  icon_key: "Terminal",
  sort_order: 0,
  plugin_count: 1,
};

export const skillMarketListHandlers = [
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: [category] });
  }),
  // Register /plugins/detail (and the /plugins/* subpaths) before /plugins.
  http.get(`*${API_BASE}/plugins/detail`, ({ request }) => {
    if (!enabled()) return undefined;
    const pluginId = new URL(request.url).searchParams.get("plugin_id");
    if (pluginId !== skill.plugin_id) {
      return HttpResponse.json({ error: { message: "Skill not found" } }, { status: 404 });
    }
    return HttpResponse.json({ data: detail });
  }),
  http.get(`*${API_BASE}/plugins/skill_md`, ({ request }) => {
    if (!enabled()) return undefined;
    const pluginId = new URL(request.url).searchParams.get("plugin_id");
    if (pluginId !== skill.plugin_id) {
      return HttpResponse.json({ error: { message: "Skill not found" } }, { status: 404 });
    }
    return HttpResponse.json({ data: { content: SKILL_MD } });
  }),
  http.get(`*${API_BASE}/plugins/versions`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: [] });
  }),
  http.get(`*${API_BASE}/plugins`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [skill],
      pagination: { total: 1, page: 1, page_size: 20 },
    });
  }),
  http.post(`*${API_BASE}/metrics/track`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: {} });
  }),
];
