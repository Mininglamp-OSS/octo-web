// ─── JSON import → CreateMcpParams seed (issue #867) ──────────────────────
// Pure function used by the "从 JSON 导入" mode of the create modal. Users
// paste a Claude Desktop / Cursor `mcpServers` config OR a flat `server.json`
// snippet; we extract the connection-critical fields (name / command / args /
// env keys / url / headers keys / transport) and let the wizard flow reuse
// existing validation, probe, and publish.
//
// Design rules:
//   - Env / header VALUES are always dropped. A user pasting a config from a
//     README may leak real tokens; keys are enough to seed the KV UI and the
//     user re-enters values.
//   - Multiple servers under `mcpServers` → take the first and warn.
//   - Never throw: every failure surfaces as `error` (i18n key) so the caller
//     shows a stable message; syntax errors, wrong shape, empty input all map.
//   - Transport inference is best-effort: explicit `transport` / `type` wins;
//     else `url` present → `streamable-http`; else `command` present → `stdio`.

import type { McpTransport } from "../types/mcp";
import { slugifyServerName } from "./constants";

/** Fields lifted from an import payload. Value-only for `name`/`slug`/
 *  `command`/`url`/`transport`; array/keys for structured fields so the caller
 *  can decide how to merge with buffered raw text (argsRaw / envRaw / etc). */
export interface ParsedImportFields {
  name?: string;
  slug?: string;
  command?: string;
  args?: string[];
  /** Env variable names only — values are intentionally discarded. */
  envKeys?: string[];
  url?: string;
  /** Header names only — values are intentionally discarded. */
  headerKeys?: string[];
  transport?: McpTransport;
}

export interface ParseImportResult {
  fields: ParsedImportFields;
  /** i18n keys of non-fatal notes shown under the textarea. */
  warnings: string[];
  /** i18n key of the fatal reason; when set, `fields` is empty. */
  error?: string;
}

// A minimal shape for what we care about; unknown extra keys are ignored.
interface McpServerCfg {
  name?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
  transport?: unknown;
  type?: unknown;
  /** Alternative transport-field name seen in some vendor exports (e.g. the
   *  mixreach-style config). Handled identically to `transport` / `type`. */
  protocol_type?: unknown;
}

/** Look-alike token placeholder detector — `<YOUR_TOKEN>` / `${API_KEY}` /
 *  `xxx-your-key` style literals should NOT trip the "value dropped" warning
 *  because they were never real. */
function isPlaceholderValue(v: string): boolean {
  const t = v.trim();
  if (!t) return true;
  if (/^<.*>$/.test(t)) return true;
  if (/^\$\{.*\}$/.test(t)) return true;
  if (/^your[-_ ]/i.test(t)) return true;
  if (/^(sk|pk|xoxb|ghp)_?xxx+$/i.test(t)) return true;
  // Contains an uppercase-only `<PLACEHOLDER>` fragment anywhere — catches the
  // common "Bearer <TOKEN>" / "Bearer <YOUR_KEY>" README style. Lowercase like
  // `<user>@host` intentionally doesn't match (that shape is real config).
  if (/<[A-Z_][A-Z0-9_]*>/.test(t)) return true;
  return false;
}

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    // Drop empty / whitespace-only entries: joining these into argsRaw with
    // newlines produces blank lines that the submit-side `.filter(Boolean)`
    // silently discards, so a positional `""` arg would round-trip as absent
    // with no warning. Filtering here mirrors the submit contract.
    if (typeof item === "string") {
      if (item.trim()) out.push(item);
    } else if (typeof item === "number" || typeof item === "boolean") {
      out.push(String(item));
    }
    // objects / arrays / null skipped — args must be scalar tokens
  }
  return out;
}

function keysOfObject(v: unknown): string[] | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return Object.keys(v as Record<string, unknown>);
}

function inferTransport(cfg: McpServerCfg): McpTransport | undefined {
  const raw =
    typeof cfg.transport === "string"
      ? cfg.transport
      : typeof cfg.type === "string"
      ? cfg.type
      : typeof cfg.protocol_type === "string"
      ? cfg.protocol_type
      : "";
  // Normalize separators before comparing so `streamable_http`,
  // `streamable-http`, `streamablehttp` and `http` all resolve to the same
  // canonical value.
  const t = raw.toLowerCase().replace(/_/g, "-");
  if (t === "stdio") return "stdio";
  if (t === "sse") return "sse";
  if (t === "http" || t === "streamable-http" || t === "streamablehttp") {
    return "streamable-http";
  }
  if (typeof cfg.url === "string" && cfg.url.trim()) return "streamable-http";
  if (typeof cfg.command === "string" && cfg.command.trim()) return "stdio";
  return undefined;
}

function extractServerFields(
  cfg: McpServerCfg,
  warnings: string[]
): ParsedImportFields {
  const fields: ParsedImportFields = {};

  if (typeof cfg.name === "string" && cfg.name.trim()) {
    fields.name = cfg.name.trim();
  }
  if (typeof cfg.command === "string" && cfg.command.trim()) {
    fields.command = cfg.command.trim();
  }

  const args = toStringArray(cfg.args);
  if (args) fields.args = args;

  const envKeys = keysOfObject(cfg.env);
  if (envKeys && envKeys.length > 0) {
    fields.envKeys = envKeys;
    const env = cfg.env as Record<string, unknown>;
    const hasReal = envKeys.some((k) => {
      const v = env[k];
      return typeof v === "string" && !isPlaceholderValue(v);
    });
    if (hasReal) warnings.push("mcp.create.import.warning.envValuesDropped");
  }

  if (typeof cfg.url === "string" && cfg.url.trim()) {
    fields.url = cfg.url.trim();
  }

  const headerKeys = keysOfObject(cfg.headers);
  if (headerKeys && headerKeys.length > 0) {
    fields.headerKeys = headerKeys;
    const headers = cfg.headers as Record<string, unknown>;
    const hasReal = headerKeys.some((k) => {
      const v = headers[k];
      return typeof v === "string" && !isPlaceholderValue(v);
    });
    if (hasReal) warnings.push("mcp.create.import.warning.headerValuesDropped");
  }

  const transport = inferTransport(cfg);
  if (transport) fields.transport = transport;

  return fields;
}

/**
 * Parse a pasted JSON string into a partial CreateMcpParams seed.
 *
 * Accepted shapes:
 *   1. Claude Desktop / Cursor:  `{ "mcpServers": { "<key>": { ... } } }`
 *      - First entry wins; extra entries → warning
 *      - The map KEY becomes both `slug` (authoritative) and `name` (unless
 *        the entry itself has a `.name`)
 *   2. Flat server.json-ish:     `{ "name": "...", "command": "...", ... }`
 *   3. Single-key wrapper:       `{ "<key>": { url|command|... } }`
 *      Some vendor exports (e.g. mixreach) omit the `mcpServers` wrapper.
 *      Treated as Format A with just this one entry. First entry wins if
 *      multiple, same as Format A.
 *
 * Never throws. Returns `{ error }` on any structural failure.
 */
export function parseImportJSON(raw: string): ParseImportResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { fields: {}, warnings: [], error: "mcp.create.import.error.empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      fields: {},
      warnings: [],
      error: "mcp.create.import.error.invalidJson",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      fields: {},
      warnings: [],
      error: "mcp.create.import.error.notObject",
    };
  }

  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  // Format A: mcpServers wrapper.
  if ("mcpServers" in obj) {
    const servers = obj.mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      return {
        fields: {},
        warnings: [],
        error: "mcp.create.import.error.mcpServersInvalid",
      };
    }
    const entries = Object.entries(servers as Record<string, unknown>);
    if (entries.length === 0) {
      return {
        fields: {},
        warnings: [],
        error: "mcp.create.import.error.mcpServersEmpty",
      };
    }
    if (entries.length > 1) {
      warnings.push("mcp.create.import.warning.multipleServers");
    }
    const [key, cfgRaw] = entries[0];
    if (!cfgRaw || typeof cfgRaw !== "object" || Array.isArray(cfgRaw)) {
      return {
        fields: {},
        warnings: [],
        error: "mcp.create.import.error.serverConfigInvalid",
      };
    }
    const fields = extractServerFields(cfgRaw as McpServerCfg, warnings);
    // The wrapper key is the authoritative source for the slug. Run it through
    // the same slugifier as manual entry (constants.ts): raw keys like
    // "@scope/name" or a Chinese key would otherwise skip the [a-z0-9-] rule
    // handleSlugChange enforces character-by-character. Display `name` still
    // uses the raw key because that's how humans actually spell it.
    fields.slug = slugifyServerName(key);
    if (!fields.name) fields.name = key;
    return { fields, warnings };
  }

  // Format B: flat server.json-ish. Require at least one recognizable field
  // so an arbitrary JSON blob doesn't silently succeed with empty fields.
  const looksLikeFlat =
    "command" in obj || "url" in obj || "name" in obj || "transport" in obj;
  if (looksLikeFlat) {
    const fields = extractServerFields(obj as McpServerCfg, warnings);
    if (!fields.name && !fields.command && !fields.url) {
      return {
        fields: {},
        warnings: [],
        error: "mcp.create.import.error.noRecognizedFields",
      };
    }
    return { fields, warnings };
  }

  // Format C: single-key wrapper — `{ "<slug>": { url|command|... } }`.
  // Same treatment as Format A minus the outer `mcpServers` key. Vendor
  // exports that follow this shape (mixreach at least) also alias transport
  // via `protocol_type`, which inferTransport already handles.
  const serverEntries = Object.entries(obj).filter(([, v]) =>
    isServerLikeValue(v)
  );
  if (serverEntries.length > 0) {
    if (serverEntries.length > 1) {
      warnings.push("mcp.create.import.warning.multipleServers");
    }
    const [key, cfgRaw] = serverEntries[0];
    const fields = extractServerFields(cfgRaw as McpServerCfg, warnings);
    fields.slug = slugifyServerName(key);
    if (!fields.name) fields.name = key;
    return { fields, warnings };
  }

  return {
    fields: {},
    warnings: [],
    error: "mcp.create.import.error.unknownFormat",
  };
}

/** True when `v` looks like a nested server config. Format C detection is
 *  intentionally strict: it must carry at least ONE connection field
 *  (`url` or `command`) — a transport-only hint like `{type: "module"}`
 *  should NOT match, or arbitrary nested JSON like a package.json snippet
 *  gets false-positive'd as an MCP config. Transport hints alone are
 *  ambiguous (the `type` / `transport` / `protocol_type` names collide
 *  with plenty of unrelated shapes), so we require a real connection
 *  target alongside. */
function isServerLikeValue(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const hasConnection =
    (typeof o.url === "string" && o.url.trim() !== "") ||
    (typeof o.command === "string" && o.command.trim() !== "");
  return hasConnection;
}
