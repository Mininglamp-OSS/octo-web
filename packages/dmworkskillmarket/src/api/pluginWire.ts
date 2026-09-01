// ─── Unified plugin API wire types + helpers ────────────────────────────────
// The octo-marketplace unified plugin surface (`/plugins`, `/plugins/detail`,
// `/plugin_categories`, `/plugins/*`) replaces the legacy per-type
// catalog endpoints. This module holds the wire shapes and the pure mapping
// helpers shared by the MCP and Expert services; it owns no HTTP plumbing.

/** The single marketplace scene every catalog row lives under today. */
export const SCENE_CODE = "default";

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
  space_id?: string;
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

/** `POST/GET /plugins/review_requests*` response row. Field names mirror
 *  `internal_api_handler_plugin.reviewRequestResponse` in octo-marketplace's
 *  `docs/openapi/swagger.yaml` exactly — do not add speculative aliases, an
 *  unknown key here silently maps to `undefined`.
 *
 *  Two backend defects are visible through this shape today:
 *  - `readme_content` is only ever populated by the detail endpoint, and even
 *    there the server currently returns "" — render the preview conditionally.
 *  - `plugin_icon` is the raw storage key, NOT a resolved display URL (unlike
 *    `PluginListItemWire.icon_url`), so binding it to `<img src>` 404s. Consumers
 *    must fall back to the letter-avatar. */
export interface PluginReviewRequestWire {
  review_id: string;
  plugin_id: string;
  plugin_name?: string;
  plugin_type?: PluginTypeWire;
  plugin_icon?: string;
  space_id: string;
  target_scope: string;
  status: string;
  kind: string;
  version: string;
  current_version?: string;
  changelog?: string;
  readme_content?: string;
  manifest_hash?: string;
  plugin_hash?: string;
  applicant_id: string;
  applicant_name?: string;
  reviewer_id?: string;
  reviewer_name?: string;
  reason?: string;
  decision_source?: string;
  submitted_at: string;
  reviewed_at?: string;
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
