// @octo/drive — wire contract with the octo-drive backend.
//
// Field names/types mirror octo-drive Go DTOs (json tags) 1:1. Notes on the
// wire that the type system can't capture:
//   - File-tree ids (id / parent_id / file_id) are Go uint64 → number here.
//     Space / share / invite / member ids are strings.
//   - parent_id === 0 means "space root".
//   - List endpoints return a named-key envelope (e.g. { spaces: [...] }) with
//     no unified { code, data } wrapper; the api layer unwraps to the array.
//   - Errors use a FLAT envelope { error: "<code>", message: "<human>" }.
//   - All *_at strings are RFC3339 millis UTC ("2006-01-02T15:04:05.000Z");
//     omitempty timestamps (expires_at) are absent when null.

// ─── Enums (wire = lowercase string unions) ─────────────────────────────────

export type SpaceType = 'personal' | 'shared';
export type FileType = 'doc' | 'blob' | 'folder';
export type FileSource = 'docs-sync' | 'user-upload' | 'im-transfer' | 'user-mount';
export type FileStatus = 'pending' | 'confirmed';
export type DriveRole =
  | 'super_admin'
  | 'admin'
  | 'editor'
  | 'downloader'
  | 'uploader_downloader'
  | 'preview_only'
  | 'custom';
export type SharePermission = 'view' | 'download' | 'edit';

/** octo-lib pagination envelope. `data` duplicates the top-level list array. */
export interface Page<T = unknown> {
  page_size: number;
  page_index: number;
  total: number;
  data: T[];
}

// ─── Space ──────────────────────────────────────────────────────────────────

export interface Space {
  id: string;
  type: SpaceType;
  name: string;
  super_admin_uid: string;
  created_at: string;
  updated_at: string;
}

export interface Member {
  space_id: string;
  uid: string;
  /** Display name resolved by drive via octo-server; absent ⇒ fall back to uid.
   *  Avatar is not on the wire — render it client-side from uid via
   *  WKApp.shared.avatarUser(uid). */
  name?: string;
  role: DriveRole;
  granted_by: string;
  created_at: string;
  updated_at: string;
}

// ─── File tree ────────────────────────────────────────────────────────────

/** Rich node returned by browse / folder-children / blob listings. */
export interface DriveEntry {
  id: number;
  space_id: string;
  parent_id: number;
  name: string;
  is_folder: boolean;
  type: FileType;
  ref_type?: FileType;
  ref_id?: string;
  size: number;
  content_type?: string;
  source: FileSource;
  owner_uid: string;
  created_at: string;
  updated_at: string;
}

/** Lean node returned by generic file ops (move / copy root). */
export interface FileNode {
  id: number;
  space_id: string;
  parent_id: number;
  name: string;
  is_folder: boolean;
  type: FileType;
  ref_id?: string;
}

export interface CopyResult {
  root: FileNode;
  total_rows: number;
}

// ─── Type-1 doc references ──────────────────────────────────────────────────

export interface DocRef {
  id: number;
  space_id: string;
  parent_id: number;
  doc_id: string;
  title: string;
  source: string;
  owner_uid: string;
  created_at: string;
  updated_at: string;
}

export interface MountableDoc {
  doc_id: string;
  title: string;
  doc_type: string;
  owner_id: string;
  space_id: string;
  octo_doc_slug?: string;
  /** "owner" | "member" */
  access_type: string;
  granted_role: number;
  updated_at: string;
}

// ─── Type-2 blobs ────────────────────────────────────────────────────────────

export interface Blob {
  id: number;
  space_id: string;
  parent_id: number;
  name: string;
  object_path: string;
  size: number;
  content_type: string;
  source: string;
  status: FileStatus;
  owner_uid: string;
  created_at: string;
  updated_at: string;
}

export interface PrepareUploadResp {
  file_id: number;
  status: string;
  /** presigned PUT target on octo-server object storage */
  upload_url: string;
  object_path: string;
  /** MUST be echoed as the PUT Content-Type header */
  content_type: string;
  /** MUST be echoed as the PUT Content-Disposition header when present */
  content_disposition?: string;
  /** PUT body length MUST equal this exactly (int64 bytes) */
  max_file_size: number;
  expires_at?: string;
}

export interface DownloadResp {
  url: string;
  filename: string;
  expires_at?: string;
}

export interface TransferResult {
  id: number;
  space_id: string;
  parent_id: number;
  name: string;
  type: string;
  ref_id: string;
  size: number;
  content_type: string;
  source: string;
  owner_uid: string;
  created_at: string;
  updated_at: string;
  /** true when a pre-existing row was returned (idempotent replay) */
  idempotent: boolean;
}

// ─── Share ────────────────────────────────────────────────────────────────

export interface Share {
  id: string;
  file_id: number;
  creator_uid: string;
  permission: string;
  expires_at?: string;
  /** whether a password hash exists (the hash itself is never returned) */
  password_set: boolean;
  created_at: string;
  updated_at: string;
}

/** Public share-access result (recipient side, no auth). */
export interface ShareAccess {
  permission: string;
  expires_at?: string;
  file_id: number;
  file_name: string;
  file_size: number;
  content_type?: string;
  ref_id: string;
}

/**
 * Public share-download result (recipient side, no auth). `url` is the
 * anonymous object-storage URL persisted at upload time — no expiry, unlike
 * the authed DownloadResp's freshly-minted presigned URL.
 */
export interface ShareDownload {
  url: string;
  filename: string;
  content_type?: string;
}

// ─── Invite ───────────────────────────────────────────────────────────────

export interface Invite {
  id: string;
  space_id: string;
  role: string;
  token: string;
  expires_at?: string;
  creator_uid: string;
  created_at: string;
}

export interface AcceptInviteResult {
  space_id: string;
  role: string;
  already_member: boolean;
}

// ─── Org picker ──────────────────────────────────────────────────────────────

export interface OrgCandidate {
  uid: string;
  name?: string;
  username?: string;
  email?: string;
  /** masked upstream: front3 + **** + last4 */
  phone?: string;
}

// ─── Request bodies ─────────────────────────────────────────────────────────

export interface CreateSpaceReq {
  name: string;
}

export interface RenameReq {
  name: string;
}

export interface AddMemberReq {
  uid: string;
  role: DriveRole;
}

export interface UpdateMemberRoleReq {
  role: DriveRole;
}

export interface CreateFolderReq {
  space_id: string;
  parent_id: number;
  name: string;
}

export interface MoveReq {
  parent_id: number;
}

export interface CopyFileReq {
  parent_id: number;
  name: string;
}

export interface MountDocReq {
  space_id: string;
  parent_id: number;
  doc_id: string;
  doc_title: string;
  /** defaults to "user-mount" server-side when omitted */
  source?: FileSource;
}

export interface CreateBlobReq {
  space_id: string;
  parent_id: number;
  name: string;
  object_path: string;
  size: number;
  content_type: string;
  /** defaults to "user-upload" server-side when omitted */
  source?: FileSource;
}

export interface PrepareUploadReq {
  space_id: string;
  parent_id: number;
  name: string;
  size: number;
  content_type: string;
}

export interface ConfirmUploadReq {
  actual_size?: number | null;
}

export interface TransferFromImReq {
  im_group_no: string;
  im_msg_id: string;
  target_space_id: string;
  target_parent_id: number;
  name_override?: string;
}

export interface CreateShareReq {
  file_id: number;
  permission: SharePermission;
  expires_in_seconds: number;
  password?: string;
}

export interface CreateInviteReq {
  role: DriveRole;
  expires_in_seconds: number;
}

// ─── Query params ─────────────────────────────────────────────────────────

export interface BrowseParams {
  space_id: string;
  parent_id?: number;
  type?: FileType | 'all';
  source?: FileSource | 'all';
  page_index?: number;
  page_size?: number;
}

export interface MountableDocsParams {
  space_id: string;
  page?: number;
  page_size?: number;
}

export interface OrgSearchParams {
  q: string;
  space_id?: string;
  limit?: number;
}

// ─── List / composite responses ──────────────────────────────────────────────

export interface BrowseResponse {
  entries: DriveEntry[];
  page: Page<DriveEntry>;
  filter: { type: string; source: string };
}

export interface MountableDocsResponse {
  items: MountableDoc[];
  page: Page<MountableDoc>;
  total: number;
}

export interface OrgSearchResponse {
  candidates: OrgCandidate[];
  total: number;
}
