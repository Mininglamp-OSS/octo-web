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
  creator_name?: string;
  created_by_type?: "human" | "bot" | "import";
  created_by_bot_uid?: string;
  created_by_bot_name?: string;
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
    createdByType: mapCreatedByType(raw.created_by_type),
    botName: raw.created_by_bot_name,
    creatorName: raw.creator_name ?? "",
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
    createdByType: mapCreatedByType(raw.created_by_type),
    botName: raw.created_by_bot_name,
    creatorName: raw.creator_name ?? "",
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
