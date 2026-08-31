// ─── Unified plugin API wire types + helpers ────────────────────────────────
// The octo-marketplace unified plugin surface (`/plugins`, `/plugins/detail`,
// `/plugin_categories`, `/plugins/*`) replaces the legacy per-type
// catalog endpoints. This module holds the wire shapes and the pure mapping
// helpers shared by the MCP and Expert services; it owns no HTTP plumbing.

/** The single marketplace scene every catalog row lives under today. */
export const SCENE_CODE = "default";

/** Legacy redaction sentinel. The unified backend has NO secret scanner (it was
 *  deliberately removed), so it neither produces this marker on read nor rejects
 *  it on write — it is a purely client-side guard: if a value equal to this
 *  sentinel is ever read back, forms blank it and never echo it, so a stray
 *  marker cannot round-trip into a stored config. */
export const SECRET_PLACEHOLDER = "__OCTO_SECRET_PLACEHOLDER__";

export type PluginTypeWire = "connector" | "expert" | "expert_team" | "skill";
export type PluginVisibilityWire = "public" | "space" | "private" | "system";

export interface PluginManifestExampleWire {
  title: string;
  input: string;
}

export interface PluginManifestWire {
  $schema?: string;
  plugin_name?: string;
  plugin_type?: string;
  /** Machine name — for connectors this is the legacy slug. */
  name?: string;
  description?: string;
  labels?: string[];
  examples?: PluginManifestExampleWire[];
}

export interface PluginAttachmentWire {
  path: string;
  content_type: "raw" | "storage";
  mime_type?: string;
  raw_content?: string;
  storage_uri?: string;
  content_size?: number;
  content_hash?: string;
}

export interface PluginPackageWire {
  $schema?: string;
  attachments?: PluginAttachmentWire[];
}

export interface PluginListItemWire {
  plugin_id: string;
  plugin_name: string;
  plugin_type: PluginTypeWire;
  is_embedded?: boolean;
  category_id?: string;
  tags: string[];
  publisher?: string;
  owner_id: string;
  visibility: PluginVisibilityWire;
  creator_name: string;
  created_by_type: "human" | "bot" | "import";
  created_by_bot_id?: string;
  created_by_bot_name?: string;
  /** Stored write-canonical icon value — echo this on updates. */
  icon?: string;
  /** Resolved display URL (presigned when icon is an object key). */
  icon_url?: string;
  tool_count?: number;
  member_count?: number;
  view_count: number;
  install_count: number;
  download_count: number;
  manifest_json: PluginManifestWire;
  current_version?: string;
  created_at: string;
  updated_at: string;
}

export interface PluginDetailPluginWire extends PluginListItemWire {
  plugin_json?: PluginPackageWire;
}

export interface PluginRelationWire {
  relation_id: string;
  source_plugin_id: string;
  target_plugin_id: string;
  relation_type: string;
  sort_order: number;
  data?: Record<string, unknown>;
}

export interface PluginDetailWire {
  plugin: PluginDetailPluginWire;
  relations: PluginRelationWire[];
}

export interface PluginCategoryWire {
  category_id: string;
  name: string;
  icon_key?: string;
  plugin_types?: string[];
  sort_order: number;
  plugin_count: number;
}

export interface OffsetPaginationWire {
  total: number;
  page: number;
  page_size: number;
}

/** raw_content of one inline package attachment, or undefined. */
export function rawAttachment(
  pkg: PluginPackageWire | undefined,
  path: string
): string | undefined {
  const hit = (pkg?.attachments ?? []).find(
    (a) => a.path === path && a.content_type === "raw"
  );
  return hit?.raw_content;
}

/** Parsed JSON body of one inline attachment; undefined on miss/parse error. */
export function jsonAttachment<T>(
  pkg: PluginPackageWire | undefined,
  path: string
): T | undefined {
  const raw = rawAttachment(pkg, path);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Stable serializer matching Go's json.Marshal encoding (sorted keys,
 *  `<>&`/U+2028/U+2029 escapes): used to render deterministic JSON attachment
 *  contents (mcp.json, connector/*.json). The retired manifest byte-match rule
 *  no longer applies — packages carry no embedded manifest.json. */
export function goCanonicalJSON(value: unknown): string {
  return escapeLikeGo(stringifySortedKeys(value));
}

function stringifySortedKeys(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stringifySortedKeys).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${stringifySortedKeys(record[key])}`
  );
  return `{${parts.join(",")}}`;
}

function escapeLikeGo(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    // Go emits \u0008/\u000c where JSON.stringify emits the short \b/\f forms.
    .replace(/\\./g, (escape) => {
      if (escape === "\\b") return "\\u0008";
      if (escape === "\\f") return "\\u000c";
      return escape;
    });
}

/** Values matching the ${KEY} install-time placeholder pattern mark
 *  user-supplied keys: the UI shows a blank fill-in slot instead of the
 *  marker. Redaction sentinels blank the same way (never reach edit forms).
 *  The name part accepts leading digits because the writer normalizes keys
 *  like "12" to ${12} — reader and writer must agree on the full range. */
const PLACEHOLDER_PATTERN = /^\$\{[A-Za-z0-9_]+\}$/;

/** The self-referential placeholder the writer emits for a user-supplied key:
 *  ${NORMALIZED_KEY}. Must stay in lockstep with placeholderFor() in
 *  mcpWireParams so read↔write round-trips are byte-stable. */
function selfPlaceholder(key: string): string {
  const normalized = key.trim().replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
  return "${" + (normalized || "VALUE") + "}";
}

export function splitUserSupplied(map: Record<string, string> | undefined): {
  values?: Record<string, string>;
  userSupplied?: string[];
} {
  if (!map || !Object.keys(map).length) return {};
  const values: Record<string, string> = {};
  const userSupplied: string[] = [];
  // Preserve the ORIGINAL ${...} reference. A value that equals the key's own
  // self-referential placeholder (${NORMALIZED_KEY}) is a genuine user-supplied
  // slot: blank it for the UI — the writer regenerates the identical placeholder
  // from the key, so it round-trips unchanged. A value that references a
  // DIFFERENTLY-named install-time variable (e.g. "${SHARED_TOKEN}" under key
  // "TOKEN") is NOT a fill-in slot; keep it verbatim so the writer echoes it
  // instead of renaming it to "${TOKEN}" from the key.
  for (const [key, value] of Object.entries(map)) {
    if (PLACEHOLDER_PATTERN.test(value)) {
      if (value === selfPlaceholder(key)) {
        values[key] = "";
        userSupplied.push(key);
      } else {
        values[key] = value;
      }
      continue;
    }
    values[key] = value === SECRET_PLACEHOLDER ? "" : value;
  }
  return {
    values,
    userSupplied: userSupplied.length ? userSupplied : undefined,
  };
}
