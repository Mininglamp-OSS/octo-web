// ─── MCP Market domain types ───────────────────────────────────────────────
// These types describe the MCP (Model Context Protocol) server marketplace
// entities. They are intentionally decoupled from any backend wire format so
// the service layer (see ./api) can map a real API response onto them later
// without touching the UI.

/** MCP transport kinds, per the MCP spec. */
export type McpTransport = "stdio" | "streamable-http" | "sse";

/** A single tool exposed by an MCP server. */
export interface McpTool {
  name: string;
  description: string;
  /** JSON schema of the tool input (optional, from tools/list). */
  inputSchema?: Record<string, unknown>;
}

/** A frequently-asked question shown on the detail modal. */
export interface McpFaq {
  question: string;
  answer: string;
}

/**
 * Structured "quick access" data. The three quick-access tabs (prompt / CLI /
 * JSON) are all generated from THIS structure plus frontend templates — no MCP
 * ships hand-written snippets. See src/api/quickStartTemplates.ts.
 *
 * TODO(backend): the real detail endpoint should return this same `quickStart`
 * shape; the frontend keeps owning the client-specific templating.
 */
export interface McpQuickStart {
  transport: McpTransport;
  /** Server display name (shown in the generated prompt). */
  serverName: string;
  /** English slug used as the KEY in the generated `mcpServers` JSON. A JSON
   *  key must be a stable ASCII identifier (Chinese display names break the
   *  copy-paste config), so this is derived by slugifying `serverName` and may
   *  be overridden by the user in the create form. Optional so legacy records
   *  without it still type-check; callers fall back to slugifying serverName. */
  slug?: string;
  /** Remote endpoint (streamable-http / sse). */
  url?: string;
  /** Whether the remote endpoint needs a bearer token. */
  authType?: "bearer" | "none";
  /** Extra request headers for the remote transport (merged into the JSON
   *  snippet; the Bearer header from authType is appended on top). */
  headers?: Record<string, string>;
  /** stdio command + args + env (stdio transport only). */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Card + list representation of an MCP server. */
export interface McpListItem {
  id: string;
  /** Display name, e.g. "GitHub MCP". */
  name: string;
  /** Short one/two line pitch shown on the card. */
  slogan: string;
  /** Category key used by the filter pills, e.g. "dev". */
  category: string;
  /** Short tag labels shown on the card, e.g. ["官方", "热门"]. */
  tags: string[];
  /** Number of tools this server exposes (shown on the card footer). */
  toolCount: number;
  /** Icon: single emoji/char OR image URL / data URL. */
  icon: string;
  /** Visibility scope, echoed by the wire (mcp-v1.md §0). Optional so legacy
   *  fixtures without the field still type-check; list cards may promote it to
   *  a badge. */
  visibility?: McpVisibility;
  /** Snapshot of the publisher's nickname at create time (mcp-v1.md §3.2).
   *  Optional so legacy fixtures without the field still type-check. */
  creatorName?: string;
}

/** Full detail payload shown in the centered detail modal. */
export interface McpDetail extends McpListItem {
  /** Nickname of the user who created / published this MCP. Rendered as
   *  `@name` next to the tool count. Optional so legacy fixtures without
   *  the field still type-check. */
  creatorName?: string;
  /** Structured quick-access data — the 3 tabs are generated from this. */
  quickStart: McpQuickStart;
  /** The tools grid (2 columns) in the detail modal. */
  tools: McpTool[];
  /** Usage examples — each item rendered as its own quote block. */
  usageExamples: string[];
  /** Common questions. */
  faqs: McpFaq[];
  /** Cautions / notes (rendered as a warning block, one string per line). */
  notes: string[];
  /** RFC 3339 timestamps echoed by the wire (mcp-v1.md §0). Wire-only extras;
   *  optional so mock fixtures without them still type-check. */
  createdAt?: string;
  updatedAt?: string;
}

/** A category filter option with its live count. */
export interface McpCategory {
  key: string;
  label: string;
  count: number;
}

/** Params accepted by the list endpoint (mock honors keyword + category). */
export interface ListMcpParams {
  keyword?: string;
  category?: string;
  /** Page size; backend clamps to [1, 100], defaulting to 20 when 0/absent. */
  limit?: number;
  /** Row offset; defaults to 0. */
  offset?: number;
}

/** Response envelope for the list endpoint. */
export interface ListMcpResponse {
  items: McpListItem[];
  total: number;
  categories: McpCategory[];
}

/**
 * Request for the "try connect / fetch tool list" probe.
 * Shape fixed per LSC-70 research conclusion so the mock and the real
 * (Electron main-process) implementation share one signature.
 */
export interface McpProbeRequest {
  transport: McpTransport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http / sse */
  url?: string;
  headers?: Record<string, string>;
}

/** Error codes the probe can surface. */
export type McpProbeErrorCode =
  | "command_not_found"
  | "timeout"
  | "init_failed"
  | "no_tools_capability";

/** Result of a probe. Mirrors LSC-70's McpProbeResult. */
export interface McpProbeResult {
  ok: boolean;
  tools: McpTool[];
  serverInfo?: { name?: string; version?: string };
  error?: { code: McpProbeErrorCode; message: string };
}

/**
 * Payload for creating a new MCP server entry. Fields map 1:1 onto the
 * fields surfaced in the detail modal — anything the detail page renders
 * must have a matching entry here so the create → detail round-trip has
 * no blanks.
 */
export interface CreateMcpParams {
  name: string;
  /** English slug used as the KEY in the generated `mcpServers` JSON snippet.
   *  Auto-derived from `name` (slugify) and user-overridable in the form.
   *  Falls back to a safe default when slugifying yields an empty string. */
  slug?: string;
  category: string;
  /** Icon: single emoji/char OR uploaded image (data URL). */
  icon: string;
  /** Card + detail tag chips, e.g. ["官方", "热门"]. */
  tags: string[];
  slogan: string;
  /** Transport kind (drives which connection fields apply). */
  transport: McpTransport;
  /** Remote endpoint (streamable-http / sse). */
  url?: string;
  /** stdio command (executable). */
  command?: string;
  /** stdio command args (positional, e.g. ["-y", "@x/y"]). */
  args?: string[];
  /** stdio process env (KEY=VAL). */
  env?: Record<string, string>;
  /** Remote request headers (streamable-http / sse). */
  headers?: Record<string, string>;
  /** Auth style for the remote transport ("bearer" enables token snippet). */
  authType?: "bearer" | "none";
  /** The tool list — probed or hand-filled. */
  tools: McpTool[];
  /** Usage examples — each one rendered as its own quote block. */
  usageExamples?: string[];
  /** Common questions rendered under ❓ on the detail page. */
  faqs?: McpFaq[];
  /** Cautions / notes rendered under ⚠️ on the detail page. */
  notes?: string[];
  /** Visibility scope. */
  visibility: McpVisibility;
}

export type McpVisibility = "public" | "private";

/**
 * Payload for updating an existing MCP server entry (PATCH /mcps/{id}).
 * Wire-wise the backend accepts partial updates (fields are pointer types,
 * omitted fields stay unchanged — mcp-v1.md §4.5). The UI always sends the
 * full form, so the shape is identical to CreateMcpParams and every field
 * gets rewritten. Kept as a distinct type alias so callers self-document
 * "I'm editing" vs "I'm creating" — and so a future partial-update UI can
 * narrow to `Partial<CreateMcpParams>` without a signature churn.
 */
export type UpdateMcpParams = CreateMcpParams;
