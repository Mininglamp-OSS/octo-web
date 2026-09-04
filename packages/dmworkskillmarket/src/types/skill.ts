export type Visibility = "public" | "space" | "private" | "system";
export type SkillSort = "comprehensive" | "latest" | "views" | "downloads";

/**
 * The unified plugin type a row belongs to. A `Skill` is the camelCase view of
 * any unified plugin row, not only skills, so the type it was fetched as has to
 * travel with it — the 全部 tab dispatches its row avatar, type tag, analytics
 * label and "open the owning tab" click off this. Mirrors `PluginTypeWire`;
 * kept as a local literal so this pure type module needs no wire import.
 */
export type PluginType = "connector" | "expert" | "expert_team" | "skill";

// ─── Listing lifecycle ───────────────────────────────────────────────────

/**
 * Whether a plugin is listed, independent of who it is listed TO. `visibility`
 * is the declared intent ("who should see this once it is listed") and this is
 * whether it actually is.
 */
export type PluginListingState = "draft" | "published" | "delisted";

/**
 * The single status a client renders, computed BY THE BACKEND from the listing
 * state plus the review entity. Deriving it client-side is what the old
 * five-value badge union did, and every page got the precedence subtly
 * different — a published plugin with a pending upgrade in particular.
 */
export type PluginDisplayStatus =
  | "draft"
  | "pending_review"
  | "published"
  | "rejected"
  | "delisted";

// ─── Frontend (camelCase) types ────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  iconKey: string;
  sortOrder: number;
  skillCount: number;
}

export interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  categoryId: string;
  tags: string[];
  ownerId: string;
  ownerName: string;
  creatorId?: string;
  creatorName?: string;
  spaceId: string;
  visibility: Visibility;
  /** The unified plugin type this row was fetched as. Absent on the legacy skill
   *  read; present on every unified `mode=mine` / detail row. The 全部 tab keys
   *  its per-row dispatch off it, so it must not be silently defaulted to
   *  "skill". */
  pluginType?: PluginType;
  version: string;
  readmeContent: string;
  iconUrl: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileSha256?: string;
  viewCount?: number;
  downloadCount?: number;
  /** Listing lifecycle and the single status to render. Both are supplied by the
   *  server on the owner (`mode=mine`) listing and on the detail read; they are
   *  absent on the public marketplace grid, where every row is published by
   *  construction. `reviewId` points at the request `displayStatus` reflects, so
   *  a 取消审核 button has something to act on without a second lookup. */
  listingState?: PluginListingState;
  displayStatus?: PluginDisplayStatus;
  reviewId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Review request types ────────────────────────────────────────────────
//
// Review state remains an independent entity, never a column on `Skill`: a
// listed v1 and an in-review v2 coexist. `display_status` above does NOT
// re-couple them — it is a derived projection the server computes per read, not
// a stored field. The snake_case wire shape lives in `api/pluginWire.ts`.

export type ReviewStatus = "pending" | "approved" | "rejected" | "canceled";
export type ReviewKind = "first" | "upgrade";
export type ReviewListMode = "mine" | "space";
export type ReviewTargetScope = "space" | "system";
export type ReviewDecisionSource = "web" | "im" | "policy";

export interface ReviewRelation {
  relationId?: string;
  targetPluginId: string;
  targetPluginType?: string;
  relationType: string;
  sortOrder: number;
  data?: Record<string, unknown>;
}

export interface ReviewRequest {
  id: string;
  pluginId: string;
  pluginName: string;
  pluginType: string;
  /** Resolved display URL. The backend runs `plugin_icon` through the same
   *  icon-resolution path the plugin list uses, on both review reads, so this is
   *  safe to bind to an `<img src>`. Still optional — a plugin may carry no icon
   *  — so consumers must keep a letter-avatar fallback. */
  pluginIconUrl?: string;
  /**
   * The plugin's CURRENT listing state — a live read of the plugin row, not part
   * of the frozen snapshot this request approved. The two drift on purpose: an
   * approved request whose plugin a Space admin later took down reads
   * `delisted`, which is how the queue avoids offering 下架 on something that is
   * already down. Optional because the server omits it when it has nothing to
   * report (`omitempty`).
   */
  pluginListingState?: PluginListingState;
  spaceId: string;
  targetScope: ReviewTargetScope;
  status: ReviewStatus;
  kind: ReviewKind;
  version: string;
  currentVersion?: string;
  changelog?: string;
  /** Reviewable body extracted from the FROZEN package snapshot: SKILL.md, then
   *  README.md / AGENTS.md, falling back to the manifest description so
   *  connectors are not blank. The list endpoint omits it; only the detail read
   *  populates it. Storage-backed attachments are not fetched on that path, so
   *  it can still be empty — render the preview section only when non-empty. */
  readmeContent?: string;
  manifestHash?: string;
  pluginHash?: string;
  /** Detail-only frozen relation graph that approval will publish. */
  frozenRelations?: ReviewRelation[];
  applicantId: string;
  applicantName: string;
  reviewerId?: string;
  reviewerName?: string;
  reason?: string;
  decisionSource?: ReviewDecisionSource;
  submittedAt: string;
  reviewedAt?: string;
}

export interface SkillListQuery {
  q?: string;
  categoryId?: string;
  tags?: string[];
  sort?: SkillSort;
  cursor?: string;
  limit?: number;
  mine?: boolean;
}

export interface SkillTag {
  name: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface ApiResponse<T> {
  code: number | string;
  message?: string;
  data: T;
}

export interface NewSkillForm {
  parseTaskId?: string;
  name: string;
  displayName: string;
  description: string;
  categoryId: string;
  tags: string[];
  visibility: Visibility;
  version?: string;
  changelog?: string;
  readmeContent: string;
  iconUrl?: string;
  fileName: string;
  fileSize: number;
}

export interface UpdateSkillForm {
  parseTaskId?: string;
  name?: string;
  displayName?: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  visibility?: Visibility;
  version?: string;
  changelog?: string;
  readmeContent?: string;
  iconUrl?: string;
  fileName?: string;
  fileSize?: number;
}

// ─── Upload/Parse flow types ─────────────────────────────────────────────

/** Response from POST /api/v1/skill/upload/init */
export interface UploadInitResult {
  uploadId: string;
  presignedUrl: string;
  method: string;
  headers: Record<string, string>;
  expiresIn: number;
}

/** Response from POST /api/v1/skill/upload/:uploadId/parse */
export interface TriggerParseResult {
  taskId: string;
}

export type ParseStatus = "pending" | "parsing" | "success" | "failed";

/** Response from GET /api/v1/skill/parse/:taskId */
export interface ParseStatusResult {
  status: ParseStatus;
  result?: {
    name: string;
    description: string;
    tags: string[];
    version: string;
    readmeContent: string;
    fileName: string;
    fileSize: number;
    fileSha256: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ─── Backend (snake_case) raw response types ───────────────────────────────

/** Raw category as returned by GET /api/v1/skill/categories */
export interface RawCategory {
  skill_category_id?: string;
  id?: string;
  name: string;
  icon_key: string;
  skill_count: number;
}

/** Raw skill as returned by GET /api/v1/skill and GET /api/v1/skill/:id */
export interface RawSkill {
  skill_id?: string;
  id?: string;
  name: string;
  display_name: string;
  description: string;
  category_id: string;
  tags: string[];
  owner_id: string;
  owner_name: string;
  creator_id?: string | null;
  creator_name?: string | null;
  space_id: string;
  visibility: Visibility;
  version: string;
  readme_content: string;
  icon_url: string;
  file_name: string;
  file_url: string;
  file_size: number;
  file_sha256: string;
  view_count?: number;
  download_count?: number;
  created_at: string;
  updated_at: string;
}

export interface RawSkillTag {
  name: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

/** Raw paged response from list endpoints */
export interface RawPagedResult<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
}

// ─── Version history types ──────────────────────────────────────────────────

export interface VersionStorage {
  type: string;
  object_key?: string;
  readme_key?: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: string;
  changelog: string;
  storage: VersionStorage;
  changedBy: string;
  createdAt: string;
}

export interface RawSkillVersion {
  skill_version_id?: string;
  id?: string;
  skill_id: string;
  version: string;
  changelog: string;
  storage: VersionStorage;
  changed_by: string;
  created_at: string;
}
