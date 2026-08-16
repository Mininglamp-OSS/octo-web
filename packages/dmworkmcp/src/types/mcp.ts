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
  /** Extra request headers for the remote transport. */
  headers?: Record<string, string>;
  /** Subset of `headers` keys whose value must be filled locally by each
   *  consumer (not by the MCP author). The wire keeps the value as sentinel /
   *  empty for these; the UI renders a "needs user config" toggle ON. Keys
   *  NOT in this array are shared values persisted as-is. */
  headersUserSupplied?: string[];
  /** stdio command + args + env (stdio transport only). */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Same semantics as `headersUserSupplied` but for the stdio env map. */
  envUserSupplied?: string[];
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
  /** Provenance: who authored this row (mcp-v1.md §3.1; issue #894). Optional
   *  on the client type so legacy fixtures without the field still type-check;
   *  the backend always sends it. Purely a display marker — the card shows a
   *  🤖 badge when this is "bot". */
  createdByType?: McpCreatedByType;
  /** Bot's identity when createdByType === "bot". Present ONLY on bot rows —
   *  human/import rows omit both bot fields. */
  createdByBotUid?: string;
  /** Snapshot of the Bot's display name at create time so the market badge
   *  stays intact after a bot rename / delete. */
  createdByBotName?: string;
  transport?: McpTransport;
  source?: McpSource;
  verificationStatus?: "verified" | "unverified" | "error";
  matchReasons?: string[];
  relevance?: number;
  updatedAt?: string;
}

/** Full detail payload shown in the centered detail modal. */
export interface McpDetail extends McpListItem {
  /** Nickname of the user who created / published this MCP. Rendered as
   *  `@name` next to the tool count. Optional so legacy fixtures without
   *  the field still type-check. */
  creatorName?: string;
  /** Same provenance triple as McpListItem; see there for semantics. */
  createdByType?: McpCreatedByType;
  createdByBotUid?: string;
  createdByBotName?: string;
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

/** Provenance of an MCP row (mcp-v1.md §3.1; issue #894). "human" = created
 *  via a user token; "bot" = created via a Bot token on behalf of its owner;
 *  "import" is reserved for the Git-import path (#867). */
export type McpCreatedByType = "human" | "bot" | "import";

export type McpSource = "system" | "space" | "mine";

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
  categories?: string[];
  transports?: McpTransport[];
  visibilities?: McpVisibility[];
  sources?: McpSource[];
  verificationStatuses?: Array<"verified" | "unverified" | "error">;
  /** Provenance filter (mcp-v1.md §4.2; issue #894). Single-select today —
   *  the toolbar segmented control is one-of-three. Kept as a single value
   *  rather than an array because YAGNI: multi-select can be added later
   *  by widening the type when the UX actually needs it. */
  createdByType?: McpCreatedByType;
  tags?: string[];
  sort?: "relevance" | "updated" | "verified";
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
  /** Header keys whose value each consumer must fill locally (never persisted
   *  as a shared value). See McpQuickStart.headersUserSupplied for the wire
   *  contract. */
  headersUserSupplied?: string[];
  /** Env keys whose value each consumer must fill locally. */
  envUserSupplied?: string[];
  /** The tool list — probed or hand-filled. */
  tools: McpTool[];
  /** Usage examples — each one rendered as its own quote block. */
  usageExamples?: string[];
  /** Common questions rendered under ❓ on the detail page. */
  faqs?: McpFaq[];
  /** Cautions / notes rendered under ⚠️ on the detail page. */
  notes?: string[];
}

export type McpVisibility = "public" | "private" | "system";

/**
 * Payload for updating an existing MCP server entry (PATCH /mcps/{id}).
 * Wire-wise the backend accepts partial updates (fields are pointer types,
 * omitted fields stay unchanged — mcp-v1.md §4.5). The UI always sends the
 * full editable form, so the shape is identical to CreateMcpParams and every
 * editable field gets rewritten. Visibility is intentionally absent and
 * therefore preserved by the backend. Kept as a distinct type alias so callers self-document
 * "I'm editing" vs "I'm creating" — and so a future partial-update UI can
 * narrow to `Partial<CreateMcpParams>` without a signature churn.
 */
export type UpdateMcpParams = CreateMcpParams;
