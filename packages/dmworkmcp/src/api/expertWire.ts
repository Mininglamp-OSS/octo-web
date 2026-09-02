// ═══════════════════════════════════════════════════════════════════════════
// Expert Marketplace wire shapes + mappers (octo-marketplace expert-v1)
// ═══════════════════════════════════════════════════════════════════════════
//
// Wire is snake_case and a SUPERSET of the frontend ExpertAgent / ExpertSquad
// TS shapes (expert-v1.md §0). These mappers translate the wire projections
// (list items) and full details into the camelCase shapes the UI already reads,
// applying `?? []` / `?? ""` fallbacks so a partial/legacy record never crashes
// a renderer that calls `.toLowerCase()` / `.map()` downstream.

import type {
  ExpertAgent,
  ExpertMember,
  ExpertSquad,
} from "../mock/expertMock";
import {
  jsonAttachment,
  rawAttachment,
  type PluginDetailPluginWire,
  type PluginListItemWire,
} from "./pluginWire";

// ─── Wire interfaces ────────────────────────────────────────────────────────

/** One skill on the wire. Write is one of two forms: a whole-package upload
 *  (`upload_object_key` + `file_name`/`file_size`, set after presigned upload)
 *  or legacy inline `content`. Read carries `has_content` (SKILL.md stored),
 *  `can_download` (package stored), the package `file_name`/`file_size`, and the
 *  bundled-`files` manifest. Names round-trip both ways. */
interface SkillWire {
  name?: string;
  content?: string;
  upload_object_key?: string;
  file_name?: string;
  file_size?: number;
  has_content?: boolean;
  can_download?: boolean;
  files?: string[];
}

/** Generic marketplace fields shared by both entities' projections. */
interface ExpertCommonWire {
  short_name?: string;
  name?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  publisher?: string;
  visibility?: string;
  listing_state?: string;
  display_status?: string;
  review_id?: string;
  creator_name?: string;
  created_by_type?: "human" | "bot" | "import";
  created_by_bot_uid?: string;
  created_by_bot_name?: string;
  view_count?: number;
  install_count?: number;
}

export interface ExpertAgentListItemWire extends ExpertCommonWire {
  expert_id: string;
}

export interface ExpertAgentDetailWire extends ExpertAgentListItemWire {
  instruction?: string;
  mcp_config?: string;
  skills?: SkillWire[];
  created_at?: string;
  updated_at?: string;
}

export interface SquadMemberWire {
  member_key?: string;
  template_id?: string;
  name?: string;
  role?: string;
  is_leader?: boolean;
  instruction?: string;
  mcp_config?: string;
  skills?: SkillWire[];
}

export interface ExpertSquadListItemWire extends ExpertCommonWire {
  squad_id: string;
  member_count?: number;
}

export interface ExpertSquadDetailWire extends ExpertSquadListItemWire {
  leader?: string;
  strategies?: string[];
  dependencies?: { blocking?: string[]; recommended?: string[] };
  permission?: string;
  members?: SquadMemberWire[];
  created_at?: string;
  updated_at?: string;
}

// `created_by_type` on the wire may carry `import`, which the TS shape doesn't
// model (only human/bot). Collapse the unmodeled value to `human` — the read
// side treats any non-bot record as human anyway (owner display).
function mapCreatedByType(raw?: string): "bot" | "human" {
  return raw === "bot" ? "bot" : "human";
}

/** Read: project a wire skill onto the TS ExpertSkill (detail projection —
 *  content/package bytes are fetched lazily via skill_md / skill_download). */
function fromSkillWire(s: SkillWire): import("../mock/expertMock").ExpertSkill {
  return {
    name: s.name ?? "",
    hasContent: !!s.has_content,
    canDownload: !!s.can_download,
    fileName: s.file_name,
    fileSize: s.file_size,
    files: s.files,
  };
}

// ─── Read mappers (wire → TS) ───────────────────────────────────────────────

const LISTING_STATES = ["draft", "published", "delisted"] as const;
const DISPLAY_STATUSES = [
  "draft",
  "pending_review",
  "published",
  "rejected",
  "delisted",
] as const;

function narrowListingState(v?: string): (typeof LISTING_STATES)[number] | undefined {
  return LISTING_STATES.includes(v as never) ? (v as (typeof LISTING_STATES)[number]) : undefined;
}

function narrowDisplayStatus(v?: string): (typeof DISPLAY_STATUSES)[number] | undefined {
  return DISPLAY_STATUSES.includes(v as never)
    ? (v as (typeof DISPLAY_STATUSES)[number])
    : undefined;
}

export function mapAgentListItem(raw: ExpertAgentListItemWire): ExpertAgent {
  return {
    id: raw.expert_id,
    kind: "agent",
    shortName: raw.short_name ?? "",
    name: raw.name ?? "",
    summary: raw.summary ?? "",
    category: raw.category ?? "",
    tags: raw.tags ?? [],
    publisher: raw.publisher ?? "",
    visibility: raw.visibility,
    // Narrowed rather than cast: an unknown or absent value must stay undefined,
    // or a public catalog card would badge itself as an unpublished draft.
    listingState: narrowListingState(raw.listing_state),
    displayStatus: narrowDisplayStatus(raw.display_status),
    reviewId: raw.review_id || undefined,
    createdByType: mapCreatedByType(raw.created_by_type),
    botName: raw.created_by_bot_name,
    creatorName: raw.creator_name ?? "",
    viewCount: raw.view_count ?? 0,
    installCount: raw.install_count ?? 0,
  };
}

export function mapAgentDetail(raw: ExpertAgentDetailWire): ExpertAgent {
  return {
    ...mapAgentListItem(raw),
    instruction: raw.instruction ?? "",
    mcpConfig: raw.mcp_config ?? "",
    skills: (raw.skills ?? []).map(fromSkillWire),
  };
}

function mapMember(raw: SquadMemberWire): ExpertMember {
  return {
    key: raw.member_key,
    templateId: raw.template_id,
    name: raw.name ?? "",
    role: raw.role ?? "",
    leader: Boolean(raw.is_leader),
    instruction: raw.instruction ?? "",
    mcpConfig: raw.mcp_config ?? "",
    skills: (raw.skills ?? []).map(fromSkillWire),
  };
}

export function mapSquadListItem(raw: ExpertSquadListItemWire): ExpertSquad {
  return {
    id: raw.squad_id,
    kind: "squad",
    shortName: raw.short_name ?? "",
    name: raw.name ?? "",
    summary: raw.summary ?? "",
    category: raw.category ?? "",
    tags: raw.tags ?? [],
    publisher: raw.publisher ?? "",
    visibility: raw.visibility,
    // Narrowed rather than cast: an unknown or absent value must stay undefined,
    // or a public catalog card would badge itself as an unpublished draft.
    listingState: narrowListingState(raw.listing_state),
    displayStatus: narrowDisplayStatus(raw.display_status),
    reviewId: raw.review_id || undefined,
    createdByType: mapCreatedByType(raw.created_by_type),
    botName: raw.created_by_bot_name,
    creatorName: raw.creator_name ?? "",
    viewCount: raw.view_count ?? 0,
    installCount: raw.install_count ?? 0,
    // List projection: roster loads on detail. Carry the count for the card
    // stat, leave `members` empty (ExpertCard falls back to memberCount).
    memberCount: raw.member_count ?? 0,
    members: [],
    leader: "",
    dependencies: { blocking: [], recommended: [] },
    permission: "",
    // Backend omits the environment probe result; the frontend treats an
    // unprobed squad as supported (checkResult has no persisted wire value).
    checkResult: "supported",
  };
}

export function mapSquadDetail(raw: ExpertSquadDetailWire): ExpertSquad {
  const members = (raw.members ?? []).map(mapMember);
  return {
    ...mapSquadListItem(raw),
    members,
    memberCount: members.length,
    leader: raw.leader ?? "",
    strategies: raw.strategies ?? [],
    dependencies: {
      blocking: raw.dependencies?.blocking ?? [],
      recommended: raw.dependencies?.recommended ?? [],
    },
    permission: raw.permission ?? "",
    checkResult: "supported",
  };
}

// ─── Unified plugin wire mappers (octo-marketplace /plugins) ────────────────
// The unified list item carries the manifest for display plus row-level
// counters; detail assembly (attachments + relations fan-out) lives in
// expertService — these are the pure projections.

/** Structured view of the team package's AGENTS.md document. The contract
 *  layout carries the collaboration/dispatch config as deterministic prose
 *  (rendered by the marketplace backfill/repackage teamAgentsMarkdown); this
 *  parser is its inverse and must track that format. */
export interface TeamAgentsDoc {
  leader: string;
  strategies: string[];
  dependencies: { blocking: string[]; recommended: string[] };
  permission: string;
}

export function parseTeamAgentsMarkdown(text: string): TeamAgentsDoc {
  const doc: TeamAgentsDoc = {
    leader: "",
    strategies: [],
    dependencies: { blocking: [], recommended: [] },
    permission: "",
  };
  let section = "";
  let inCollaboration = false;
  for (const rawLine of (text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      // The summary prose precedes ## 协作方式; nothing before that heading
      // may be interpreted as config (a summary line could echo "- Leader:"
      // or inject "### 策略"/"### 依赖"/"### 权限" sub-sections).
      inCollaboration = line.slice(3).trim() === "协作方式";
      section = "";
      continue;
    }
    // Fail closed until the collaboration region opens: ignore every ### section
    // capture and its content while outside ## 协作方式, so injected sub-headings
    // in the summary prose can never seed team config.
    if (!inCollaboration) continue;
    if (line.startsWith("### ")) {
      section = line.slice(4).trim();
      continue;
    }
    if (!section && line.startsWith("- Leader:")) {
      doc.leader = line.slice("- Leader:".length).trim();
      continue;
    }
    if (section === "策略") {
      const numbered = line.match(/^\d+\.\s+(.*)$/);
      if (numbered) doc.strategies.push(numbered[1].trim());
      continue;
    }
    if (section === "依赖") {
      if (line.startsWith("- 阻塞:")) doc.dependencies.blocking.push(line.slice("- 阻塞:".length).trim());
      if (line.startsWith("- 推荐:")) doc.dependencies.recommended.push(line.slice("- 推荐:".length).trim());
      continue;
    }
    if (section === "权限" && line && !doc.permission) {
      doc.permission = line;
    }
  }
  return doc;
}

/** expert/context.json attachment persisted for squad member snapshots. */
export interface MemberContextWire {
  member_key?: string;
  template_id?: string;
  role?: string;
  is_leader?: boolean;
}

/** skill/ref.json attachment: legacy artifact pointers shared by backfill
 *  and import. */
export interface SkillRefWire {
  file_name?: string;
  file_size?: number;
  file_url?: string;
  files?: string[];
  object_key?: string;
  zip_object_key?: string;
}

/** The legacy short_name never survived into the unified manifest; derive a
 *  compact logo glyph from the display name so ExpertCard's logo block keeps
 *  rendering. */
function deriveShortName(name: string): string {
  return name.trim().slice(0, 2);
}

function commonFromPlugin(raw: PluginListItemWire, categoryName: string) {
  const manifest = raw.manifest_json ?? {};
  return {
    shortName: deriveShortName(raw.plugin_name ?? ""),
    name: raw.plugin_name ?? "",
    summary: manifest.description ?? "",
    category: categoryName,
    tags: raw.tags ?? [],
    publisher: raw.publisher ?? "",
    visibility: raw.visibility,
    // Narrowed rather than cast: an unknown or absent value must stay undefined,
    // or a public catalog card would badge itself as an unpublished draft.
    listingState: narrowListingState(raw.listing_state),
    displayStatus: narrowDisplayStatus(raw.display_status),
    reviewId: raw.review_id || undefined,
    createdByType: mapCreatedByType(raw.created_by_type),
    botName: raw.created_by_bot_name,
    creatorName: raw.creator_name ?? "",
    viewCount: raw.view_count ?? 0,
    installCount: raw.install_count ?? 0,
    version: raw.current_version ?? "",
  };
}

export function mapPluginAgentListItem(
  raw: PluginListItemWire,
  categoryName: string
): ExpertAgent {
  return {
    id: raw.plugin_id,
    kind: "agent",
    ...commonFromPlugin(raw, categoryName),
  };
}

export function mapPluginSquadListItem(
  raw: PluginListItemWire,
  categoryName: string
): ExpertSquad {
  return {
    id: raw.plugin_id,
    kind: "squad",
    ...commonFromPlugin(raw, categoryName),
    memberCount: raw.member_count ?? 0,
    members: [],
    leader: "",
    dependencies: { blocking: [], recommended: [] },
    permission: "",
    checkResult: "supported",
  };
}

/** Project one skill Plugin (an expert_skill relation target) onto the lazy
 *  ExpertSkill detail shape the file browser reads. Tree-shaped skills expose
 *  their files directly as attachments; a legacy skill/ref.json pointer is still
 *  honored for not-yet-expanded rows. */
export function fromSkillPlugin(
  plugin: PluginDetailPluginWire
): import("../mock/expertMock").ExpertSkill {
  const ref = jsonAttachment<SkillRefWire>(plugin.plugin_json, "skill/ref.json") ?? {};
  const attachments = plugin.plugin_json?.attachments ?? [];
  const inlineMd = rawAttachment(plugin.plugin_json, "SKILL.md") !== undefined;
  const isLegacy = attachments.some(
    (a) => a.path === "skill/ref.json" || a.path === "skill/package.zip"
  );
  // Tree shape: every attachment except SKILL.md is a real package file.
  const treeFiles = attachments
    .map((a) => a.path)
    .filter((p) => p !== "SKILL.md");
  const treeSize = attachments.reduce((n, a) => n + (a.content_size ?? 0), 0);
  const managedZip = attachments.some(
    (a) => a.path === "skill/package.zip" && a.content_type === "storage"
  );
  return {
    name: plugin.plugin_name ?? "",
    pluginId: plugin.plugin_id,
    hasContent: inlineMd || !!ref.object_key,
    // A tree skill is downloadable (the backend rebuilds a zip) when it carries
    // supporting files beyond SKILL.md; legacy skills need a resolvable pointer.
    canDownload: isLegacy
      ? managedZip || !!ref.zip_object_key || !!ref.file_url
      : treeFiles.length > 0,
    // Tree skills have no ref.json, so synthesize a download filename from the
    // plugin name (matching mapSkillDetail in the skill market); legacy skills
    // keep the packaged file name from the pointer.
    fileName: isLegacy ? ref.file_name : treeFiles.length > 0 ? `${plugin.plugin_name ?? "skill"}.zip` : undefined,
    fileSize: isLegacy ? ref.file_size : treeSize,
    files: isLegacy ? ref.files : treeFiles,
  };
}
