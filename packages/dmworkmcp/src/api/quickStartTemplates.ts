import { slugifyServerName } from "../utils/constants";
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

/** The visible placeholder shape. Interpolates the actual header/env key so
 *  a user-supplied field named `Authorization` reads `<把这里换成你的
 *  Authorization>` and one named `12` reads `<把这里换成你的 12>` — never
 *  the misleading "Token" literal when the field isn't a token. */
export function formatTokenPlaceholder(key: string): string {
  return `<把这里换成你的 ${key}>`;
}

/** Global regex that matches any interpolated placeholder produced by
 *  formatTokenPlaceholder. Consumers use this to split rendered content and
 *  wrap each occurrence in a highlight `<mark>`. `[^>]+` covers any key
 *  shape the create flow allows through: env keys are `[A-Z0-9_]+` and
 *  headers are conventional HTTP tokens — neither can contain `>`, so the
 *  match is unambiguous. Global flag so `.split()` returns every occurrence.
 */
export const TOKEN_PLACEHOLDER_RE = /<把这里换成你的 [^>]+>/g;

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
    const merged = applyUserSuppliedPlaceholder(
      qs.headers ?? {},
      qs.headersUserSupplied
    );
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
    server.env = applyUserSuppliedPlaceholder(qs.env, qs.envUserSupplied);
  }
  return JSON.stringify({ mcpServers: { [key]: server } }, null, 2);
}

/** Render each key/value from the persisted map, substituting the visible
 *  token placeholder for any key that the MCP author marked as
 *  "user-supplied" (`headers_user_supplied` / `env_user_supplied`). Values
 *  for shared keys pass through verbatim — the author chose to publish them,
 *  and the copy-paste snippet has to include them for the config to work. */
function applyUserSuppliedPlaceholder(
  m: Record<string, string>,
  userSupplied: string[] | undefined
): Record<string, string> {
  const supplied = new Set(userSupplied ?? []);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = supplied.has(k) ? formatTokenPlaceholder(k) : v;
  }
  return out;
}

/**
 * Bilingual prompt templates for the copy-ready agent prompt. Kept inline
 * (rather than sourced through `@octo/base` `t()`) so this module stays a
 * pure computation with no React / i18n runtime dependency — that keeps
 * the unit tests fast and free of the Semi-UI transform chain.
 *
 * Locale detection is a simple browser check: anything that starts with
 * `zh` renders the Chinese prompt; everything else falls back to English.
 * Consumers on non-browser runtimes (tests) will render the English copy,
 * which is the safer default for cross-locale agents.
 */
type PromptTexts = {
  remote: (v: {
    serverName: string;
    transport: string;
    url: string;
    extraHeaders: string;
  }) => string;
  stdio: (v: {
    serverName: string;
    command: string;
    args: string;
    env: string;
  }) => string;
  headersLabel: string;
  envLabel: string;
};

const PROMPT_TEXTS: Record<"zh" | "en", PromptTexts> = {
  zh: {
    remote: ({ serverName, transport, url, extraHeaders }) =>
      `帮我接入一个 MCP server：
- 名称：${serverName}
- 传输方式：${transport}
- 地址：${url}${extraHeaders}
请把它加到我的 MCP 配置里并确认连接可用。`,
    stdio: ({ serverName, command, args, env }) =>
      `帮我接入一个本地（stdio）MCP server：
- 名称：${serverName}
- 启动命令：${command} ${args}${env}
请把它加到我的 MCP 配置里并确认连接可用。`,
    headersLabel: "\n请求头：",
    envLabel: "\n环境变量：",
  },
  en: {
    remote: ({ serverName, transport, url, extraHeaders }) =>
      `Please help me add an MCP server:
- Name: ${serverName}
- Transport: ${transport}
- URL: ${url}${extraHeaders}
Add it to my MCP config and confirm the connection works.`,
    stdio: ({ serverName, command, args, env }) =>
      `Please help me add a local (stdio) MCP server:
- Name: ${serverName}
- Command: ${command} ${args}${env}
Add it to my MCP config and confirm the connection works.`,
    headersLabel: "\nHeaders: ",
    envLabel: "\nEnv: ",
  },
};

function currentPromptLocale(): "zh" | "en" {
  if (typeof navigator === "undefined") return "en";
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("zh") ? "zh" : "en";
}

/** Build the natural-language prompt for agent clients. Bilingual — the
 *  UI locale picks between the zh and en template above (Nit#2 on PR#851
 *  addressed the pre-#894 hardcoded-Chinese case). */
function buildPrompt(qs: McpQuickStart): string {
  const texts = PROMPT_TEXTS[currentPromptLocale()];
  if (isRemote(qs)) {
    const headerSupplied = new Set(qs.headersUserSupplied ?? []);
    const extraHeaders =
      qs.headers && Object.keys(qs.headers).length > 0
        ? texts.headersLabel +
          Object.entries(qs.headers)
            .map(([k, v]) =>
              headerSupplied.has(k)
                ? `${k}: ${formatTokenPlaceholder(k)}`
                : `${k}: ${v}`
            )
            .join(", ")
        : "";
    return texts.remote({
      serverName: qs.serverName,
      transport: qs.transport,
      url: qs.url ?? "",
      extraHeaders,
    });
  }
  // Shell-quote any arg containing whitespace so an arg like `--config "a b"`
  // survives copy-paste out of the natural-language prompt tab without being
  // re-tokenized by whichever shell the agent runs. The JSON tab preserves
  // token boundaries via a real array; this string form has to encode them.
  const args = (qs.args ?? [])
    .map((a) =>
      /\s/.test(a) ? `"${a.replace(/(["\\])/g, "\\$1")}"` : a
    )
    .join(" ");
  const envSupplied = new Set(qs.envUserSupplied ?? []);
  const env =
    qs.env && Object.keys(qs.env).length > 0
      ? texts.envLabel +
        Object.entries(qs.env)
          .map(([k, v]) =>
            envSupplied.has(k) ? `${k}=${formatTokenPlaceholder(k)}` : `${k}=${v}`
          )
          .join(", ")
      : "";
  return texts.stdio({
    serverName: qs.serverName,
    command: qs.command ?? "npx",
    args,
    env,
  });
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
