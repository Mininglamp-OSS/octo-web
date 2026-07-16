import { isSecretKey, slugifyServerName } from "../utils/constants";
import type { McpQuickStart } from "../types/mcp";

// ═══════════════════════════════════════════════════════════════════════════
// Quick-start template generation
// ═══════════════════════════════════════════════════════════════════════════
// The two quick-access tabs (提示词 / JSON) are ALL generated from a single
// structured `quickStart` payload plus the client-agnostic templates below.
// No MCP ships hand-written snippets. Per the LSC-71 conclusion:
//   - default tab = 提示词 (natural-language instruction for agent clients)
//   - JSON = `mcpServers` snippet — Cursor / Claude Desktop shape:
//       stdio  → { command, args, env }              (NO `type` field)
//       remote → { type: "streamable_http" | "sse", url, headers }
//     Claude Code also accepts `type: "stdio"`, but Cursor / Claude Desktop /
//     Codex etc. don't — omitting it keeps one snippet copy-pasteable across
//     the whole ecosystem, which is what users actually do.
//   - the token position always renders as the placeholder below (never a real
//     token, never pre-filled)
// ═══════════════════════════════════════════════════════════════════════════

/** The visible token placeholder. Never pre-fill a real token. */
export const TOKEN_PLACEHOLDER = "<把这里换成你的 Token>";

export type QuickStartTabKey = "prompt" | "json";

export interface QuickStartTab {
  key: QuickStartTabKey;
  /** i18n key suffix under `mcp.detail.qsTab`. */
  labelKey: string;
  /** The generated, copy-ready text. */
  content: string;
  /** Language hint for the code block styling. */
  lang: "text" | "bash" | "json";
}

/** Whether the transport is a remote (network) one. */
function isRemote(qs: McpQuickStart): boolean {
  return qs.transport === "streamable-http" || qs.transport === "sse";
}

/**
 * The `type` value emitted for remote transports. `.mcp.json` (Claude Code)
 * requires it; Cursor / Claude Desktop tolerate it. stdio gets no `type` at all
 * (Cursor / Claude Desktop reject unknown fields on stdio; Claude Code accepts
 * the omission). streamable-http emits the canonical `streamable_http` value
 * (the ecosystem's own key), not the shorthand `http`.
 */
function jsonTypeField(qs: McpQuickStart): "sse" | "streamable_http" | null {
  if (qs.transport === "sse") return "sse";
  if (qs.transport === "streamable-http") return "streamable_http";
  return null;
}

/** The `mcpServers` JSON key — an ASCII slug, never the Chinese display name.
 *  A manually-supplied slug is run through the same slugify as the auto one, so
 *  Chinese / uppercase / spaces / underscores can never leak into the JSON key. */
function serverKey(qs: McpQuickStart): string {
  const source = qs.slug?.trim() ? qs.slug : qs.serverName;
  return slugifyServerName(source);
}

/** Build the JSON `mcpServers` snippet — Cursor / Claude Desktop shape. */
function buildJson(qs: McpQuickStart): string {
  const key = serverKey(qs);
  if (isRemote(qs)) {
    // User-supplied headers first, so the auth line (if any) wins on collision.
    const merged: Record<string, string> = maskSecrets(qs.headers ?? {});
    if (qs.authType === "bearer") {
      merged.Authorization = `Bearer ${TOKEN_PLACEHOLDER}`;
    }
    const server: Record<string, unknown> = {
      type: jsonTypeField(qs),
      url: qs.url ?? "",
    };
    if (Object.keys(merged).length > 0) {
      server.headers = merged;
    }
    return JSON.stringify({ mcpServers: { [key]: server } }, null, 2);
  }
  // stdio — no `type` field per Cursor / Claude Desktop convention.
  const server: Record<string, unknown> = {
    command: qs.command ?? "npx",
    args: qs.args ?? [],
  };
  if (qs.env && Object.keys(qs.env).length > 0) {
    server.env = maskSecrets(qs.env);
  }
  return JSON.stringify({ mcpServers: { [key]: server } }, null, 2);
}

/** Replace secret-looking values with the token placeholder so the snippet is
 *  copy-pasteable without leaking anything the user's browser echoed back. Uses
 *  the same key pattern as the backend redaction rule (mcp-v1.md §5.1) so the
 *  frontend's "this is a secret" judgement matches the wire. */
function maskSecrets(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = isSecretKey(k) ? TOKEN_PLACEHOLDER : v;
  }
  return out;
}

/** Build the natural-language prompt for agent clients. */
function buildPrompt(qs: McpQuickStart): string {
  if (isRemote(qs)) {
    const auth =
      qs.authType === "bearer"
        ? `\n鉴权：请求头 Authorization: Bearer ${TOKEN_PLACEHOLDER}`
        : "";
    const extraHeaders =
      qs.headers && Object.keys(qs.headers).length > 0
        ? "\n请求头：" +
          Object.entries(qs.headers)
            .map(([k, v]) =>
              isSecretKey(k) ? `${k}: ${TOKEN_PLACEHOLDER}` : `${k}: ${v}`
            )
            .join("，")
        : "";
    return `帮我接入一个 MCP server：
- 名称：${qs.serverName}
- 传输方式：${qs.transport}
- 地址：${qs.url ?? ""}${extraHeaders}${auth}
请把它加到我的 MCP 配置里并确认连接可用。`;
  }
  const args = (qs.args ?? []).join(" ");
  const env =
    qs.env && Object.keys(qs.env).length > 0
      ? "\n环境变量：" +
        Object.entries(qs.env)
          .map(([k, v]) =>
            isSecretKey(k) ? `${k}=${TOKEN_PLACEHOLDER}` : `${k}=${v}`
          )
          .join("，")
      : "";
  return `帮我接入一个本地（stdio）MCP server：
- 名称：${qs.serverName}
- 启动命令：${qs.command ?? "npx"} ${args}${env}
请把它加到我的 MCP 配置里并确认连接可用。`;
}

/**
 * Generate the two copy-ready tabs from the structured quick-start payload.
 * Order matters: 提示词 first (the default tab).
 */
export function buildQuickStartTabs(qs: McpQuickStart): QuickStartTab[] {
  return [
    {
      key: "prompt",
      labelKey: "prompt",
      content: buildPrompt(qs),
      lang: "text",
    },
    { key: "json", labelKey: "json", content: buildJson(qs), lang: "json" },
  ];
}
