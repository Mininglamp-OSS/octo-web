import { http, HttpResponse } from "msw";

const API_BASE = "/market/api/v1";
const REDACTED_CREATOR = "[redacted-admin]";

function enabled(): boolean {
  try {
    return sessionStorage.getItem("__e2e_scenario") === "mcp-official";
  } catch {
    return false;
  }
}

const officialListItem = {
  mcp_id: "official-search",
  name: "Official Search MCP",
  slogan: "Platform-maintained web and news search.",
  category: "search",
  icon: "🔎",
  tags: ["search", "official"],
  tool_count: 6,
  visibility: "system",
  source: "system",
  creator_name: REDACTED_CREATOR,
  created_by_type: "human",
  transport: "streamable-http",
  match_reasons: [`creator:${REDACTED_CREATOR}`, "tool:web_search"],
  updated_at: "2026-07-24T08:00:00Z",
};

const normalListItem = {
  ...officialListItem,
  mcp_id: "community-search",
  name: "Community Search MCP",
  slogan: "Community-maintained search integration.",
  tags: ["search", "community"],
  visibility: "public",
  source: "space",
  creator_name: "Alice",
  match_reasons: ["creator:Alice", "tool:web_search"],
};

const detailFor = (item: typeof officialListItem) => ({
  ...item,
  quick_start: {
    transport: "streamable-http",
    server_name: item.name,
    url: "https://example.test/mcp",
  },
  tools: [{ name: "web_search", description: "Search the web." }],
  usage_examples: ["Search for the latest platform documentation."],
  faqs: [],
  notes: [],
  created_at: "2026-07-20T08:00:00Z",
});

export const mcpOfficialHandlers = [
  http.get("*/user/devices/:deviceId", () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({});
  }),
  http.get(`*${API_BASE}/mcps`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({
      data: [officialListItem, normalListItem],
      pagination: { total: 2, page: 1, page_size: 20 },
    });
  }),
  http.get(`*${API_BASE}/mcp_categories`, () => {
    if (!enabled()) return undefined;
    return HttpResponse.json({ data: [{ key: "search", count: 2 }] });
  }),
  http.get(`*${API_BASE}/mcps/:id`, ({ params }) => {
    if (!enabled()) return undefined;
    const item =
      params.id === officialListItem.mcp_id ? officialListItem : normalListItem;
    return HttpResponse.json({ data: detailFor(item) });
  }),
];
