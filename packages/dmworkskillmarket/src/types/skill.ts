export type Visibility = "public" | "space" | "private";

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
  spaceId: string;
  visibility: Visibility;
  version: string;
  readmeContent: string;
  iconUrl: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileSha256?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillListQuery {
  q?: string;
  categoryId?: string;
  cursor?: string;
  limit?: number;
  mine?: boolean;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
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
  id: string;
  name: string;
  icon_key: string;
  skill_count: number;
}

/** Raw skill as returned by GET /api/v1/skill and GET /api/v1/skill/:id */
export interface RawSkill {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category_id: string;
  tags: string[];
  owner_id: string;
  owner_name: string;
  space_id: string;
  visibility: Visibility;
  version: string;
  readme_content: string;
  icon_url: string;
  file_name: string;
  file_url: string;
  file_size: number;
  file_sha256: string;
  created_at: string;
  updated_at: string;
}

/** Raw paged response from list endpoints */
export interface RawPagedResult<T> {
  items: T[];
  next_cursor: string | null;
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
  id: string;
  skill_id: string;
  version: string;
  changelog: string;
  storage: VersionStorage;
  changed_by: string;
  created_at: string;
}
