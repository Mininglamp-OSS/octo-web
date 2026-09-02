import { http, HttpResponse } from "msw";

// Unified plugin surface (octo-marketplace). The MCP market migrated off the
// legacy /mcps + /mcp_categories endpoints onto /plugins, /plugins/detail and
// /plugin_categories (plugin_type=connector). Fixtures are plugin-wire shaped
// so mcpService's mapListItem/mapDetail project them back to the McpListItem /
// McpDetail view models the C37 spec asserts on. visibility=system drives the
// "官方发布" badge + wk-mcp-card--official card class (isOfficialMcp).
const API_BASE = "/market/api/v1";
const REDACTED_CREATOR = "[redacted-admin]";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "mcp-official";
  } catch {
    return false;
  }
}

// Official connector (list projection). visibility=system → official publisher;
// the redacted creator name must never render on an official card/detail.
const officialPlugin = {
  plugin_id: "official-search",
  plugin_name: "Official Search MCP",
  plugin_type: "connector" as const,
  category_id: "search-cat",
  tags: ["search", "official"],
  publisher: "Octo Platform",
  owner_id: "space-e2e",
  visibility: "system" as const,
  creator_name: REDACTED_CREATOR,
  created_by_type: "human" as const,
  icon_url: "",
  tool_count: 6,
  view_count: 24,
  install_count: 8,
  download_count: 0,
  current_version: "1.0.0",
  manifest_json: {
    name: "official-search",
    description: "Platform-maintained web and news search.",
    labels: ["search", "official"],
  },
  created_at: "2026-07-20T08:00:00Z",
  updated_at: "2026-07-24T08:00:00Z",
};

// Community connector: a space-visible row keeps its creator (Alice) on the
// card and detail — the anti-case for the official badge.
const normalPlugin = {
  ...officialPlugin,
  plugin_id: "community-search",
  plugin_name: "Community Search MCP",
  tags: ["search", "community"],
  publisher: "Octo Community",
  visibility: "public" as const,
  creator_name: "Alice",
  manifest_json: {
    name: "community-search",
    description: "Community-maintained search integration.",
    labels: ["search", "community"],
  },
};

// Detail carries the connector package: mcp.json is the standard MCP config
// document, connector/tools.json the tool list. mapDetail reads them via
// jsonAttachment; missing attachments degrade to sane defaults.
const detailFor = (plugin: typeof officialPlugin | typeof normalPlugin) => ({
  plugin: {
    ...plugin,
    plugin_json: {
      $schema: "cowork-plugin-package-1.0.json",
      connector: { type: "mcp" as const, source: `connector.${plugin.manifest_json.name}` },
      attachments: [
        {
          path: "mcp.json",
          content_type: "raw" as const,
          mime_type: "application/json",
          raw_content: JSON.stringify({
            mcpServers: {
              [plugin.plugin_name]: {
                type: "streamable-http",
                url: "https://example.test/mcp",
              },
            },
          }),
        },
        {
          path: "connector/tools.json",
          content_type: "raw" as const,
          mime_type: "application/json",
          raw_content: JSON.stringify([
            { name: "web_search", description: "Search the web." },
          ]),
        },
        {
          path: "connector/examples.json",
          content_type: "raw" as const,
          mime_type: "application/json",
          raw_content: JSON.stringify(["Search for the latest platform documentation."]),
        },
      ],
    },
  },
  relations: [],
});

const detailById: Record<string, ReturnType<typeof detailFor>> = {
  [officialPlugin.plugin_id]: detailFor(officialPlugin),
  [normalPlugin.plugin_id]: detailFor(normalPlugin),
};

export const mcpOfficialHandlers = [
  http.get("*/user/devices/:deviceId", () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({});
  }),
  // Register /plugins/detail before /plugins so the more specific path wins.
  http.get(`*${API_BASE}/plugins/detail`, ({ request }) => {
    if (!enabled()) return undefined;
    const pluginId = new URL(request.url).searchParams.get("plugin_id") ?? "";
    const detail = detailById[pluginId];
    if (!detail) {
      return HttpResponse.json({ error: { message: "Plugin not found" } }, { status: 404 });
    }
    return HttpResponse.json({ data: detail });
  }),
  http.get(`*${API_BASE}/plugins`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [officialPlugin, normalPlugin],
      pagination: { total: 2, page: 1, page_size: 20 },
    });
  }),
  http.get(`*${API_BASE}/plugin_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [
        { category_id: "search-cat", name: "search", sort_order: 0, plugin_count: 2 },
      ],
    });
  }),
  http.post(`*${API_BASE}/metrics/track`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: {} });
  }),
];
