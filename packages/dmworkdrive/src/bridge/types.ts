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
  /** Caller's own role in this space. Present only on member-scoped list
   *  responses (GET /v1/drive/spaces); empty string on single-space reads
   *  (GET /v1/drive/spaces/:id). Front-end save-to-drive picker disables
   *  target spaces whose viewer_role rank is below uploader_downloader.
   *  Empty string means "unknown" — the caller should not gate on it. */
  viewer_role?: DriveRole | '';
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
  /** doc-only: the doc's OWN octo space (docs-backend doc_meta.space_id), for
   *  building `/d/:docId?sp=`. Absent for blobs/folders and when NULL server-side
   *  (omitempty). NOT space_id — that is drive's mount space, wrong across tenants. */
  doc_space_id?: string;
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
  /** the doc's OWN octo space (docs-backend doc_meta.space_id), for `/d/:docId?sp=`.
   *  Absent when NULL server-side (omitempty). See DriveEntry.doc_space_id. */
  doc_space_id?: string;
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
  im_channel_type: number;
  im_msg_id: string;
  target_space_id: string;
  target_parent_id: number;
  name_override?: string;
}

/** One folder on the root-to-parent path returned by GET /v1/drive/files/:id/ancestors.
 *  Root-first ordering; the target file itself is not included; parent_id=0 root
 *  means an empty array. Front-end save-to-drive "在云盘中查看" uses this to
 *  rebuild the breadcrumb when jumping into a deep folder in any space. */
export interface DriveAncestor {
  id: number;
  name: string;
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

// ─── IM → drive transferred-state (source_key wire contract) ────────────────
//
// The chat file card asks the backend whether a given IM file message has
// already been transferred into the caller's personal space. The backend keys
// its `drive_file.source_key` VARCHAR(128) column on the IM message triple:
//
//     source_key = `${im_channel_type}#${im_group_no}#${im_msg_id}`
//
// Delimiter '#' is unambiguous: `im_channel_type` (uint8) and `im_msg_id`
// (numeric string) are digits only; `im_group_no` is a hex uid, a Person peer
// uid, or a sub-thread composite "group_no____short_id" (already using
// `____`), none of which contain `#`.
//
// The response map is keyed by that same source_key string; the frontend
// rebuilds the key locally to look up each card's status (packages/
// dmworkdrive/src/module.tsx, `checkDriveTransferred` / batch dedupe /
// results read-back). The invariant is: write-key === read-key by
// construction, and both mirror the backend's canonical source_key format.
//
// Do not change the delimiter or the field order in isolation — the wire is
// pinned across octo-drive (drive_file.source_key + POST
// /blobs/im-transferred/batch handler) and octo-web (this file + module.tsx).
// The backend contract lives in octo-drive `internal/modules/imtransfer/`
// (see `buildSourceKey`) and the migration
// `db/migrations/007_add_file_source_key.up.sql`.

/**
 * Hit entry returned by POST /blobs/im-transferred/batch.
 * Present in `results` map when the file exists in the caller's personal
 * space; missing key means "not transferred yet".
 * Field names/types mirror octo-drive Go: file_id/parent_id are uint64 →
 * number; space_id is a string; parent_id === 0 means "space root".
 */
export interface ImTransferredEntry {
  file_id: number;
  space_id: string;
  parent_id: number;
}

/**
 * Batch item shape sent to POST /blobs/im-transferred/batch. The three fields
 * together form the source_key `${im_channel_type}#${im_group_no}#${im_msg_id}`
 * documented above. im_channel_type is the wukongimjssdk ChannelType numeric
 * enum (Person=1, Group=2, CommunityTopic=5); im_group_no is the IM
 * **normalised** channelID:
 *   - Person: the bare peer uid, with the `s<32-hex>_` Space prefix stripped
 *     (see `imTransferredSourceKey` — the Person path always normalises before
 *     the wire); on non-Space deployments this is a no-op.
 *   - Group: the raw group_no.
 *   - CommunityTopic: the raw `group_no____short_id` composite (already using
 *     `____` as separator for sub-threads).
 * im_msg_id is the octo-server message id as a string.
 *
 * Space-prefix rationale: in Space deployments `Channel.channelID` for Person
 * is `s<32-hex>_<peer_uid>` (see `Service/SpacePrefix.ts` + `hasSpacePrefix`).
 * octo-server's `getPersonMessage` (#708 head 06a25707) hashes `peer_uid`
 * directly via `GetFakeChannelIDWith` and passes it to `IsFriend` /
 * `AreSpaceMembers` — none of them are prefix-tolerant. Sending the
 * prefixed form 404s every DM save. Group / thread paths on the backend
 * accept prefixed IDs (see `Service/ChannelSettingService.ts`), so only
 * Person needs the strip; #1261 review round 6 P1-1.
 */
export interface ImTransferredItem {
  im_group_no: string;
  im_channel_type: number;
  im_msg_id: string;
}

// wukongimjssdk ChannelType numeric enum, duplicated here to avoid dragging
// the runtime `wukongimjssdk` dependency into a pure-type wire-contract file.
// Any drift would fail the source_key format test in driveApi.test.ts.
// (`isDriveTransferSupportedChannel` moved to `@octo/base` `Service/SpacePrefix.ts`
// long ago; the normalise + source_key helpers below now delegate there so
// there is a single authoritative implementation shared by dmworkbase and
// dmworkdrive. See Octo-Q / yujiawei review PR #1322 P2-6: duplicating the
// formula reintroduces the icon/menu divergence this feature exists to fix.)

import { normaliseImDriveChannelID, imDriveTransferSourceKey } from '@octo/base';

/**
 * @deprecated Thin re-export of `@octo/base` `normaliseImDriveChannelID`. Kept
 * under the original name so existing dmworkdrive call sites don't churn; new
 * code should import from `@octo/base` directly. The two producers of a
 * source_key (FileCell in dmworkbase, module.tsx save/check in dmworkdrive)
 * MUST agree on this normalisation — hosting it in `@octo/base` makes that
 * impossible to violate.
 */
export function normaliseImChannelID(channelType: number, channelID: string): string {
  return normaliseImDriveChannelID(channelType, channelID);
}

/**
 * @deprecated Thin re-export of `@octo/base` `imDriveTransferSourceKey`.
 * Same rationale as `normaliseImChannelID` above. Keeps this module's API
 * stable while making it structurally impossible for the formula to drift
 * between dmworkbase and dmworkdrive. Callers in this package should keep
 * using this shape (it takes an `ImTransferredItem` for wire-parity with
 * the batch request payload); the underlying key derivation is the single
 * `@octo/base` implementation.
 */
export function imTransferredSourceKey(item: ImTransferredItem): string {
  // Callers hand this an ALREADY-normalised `im_group_no` (they pass through
  // `normaliseImChannelID` upstream). `imDriveTransferSourceKey` normalises
  // again defensively, which is a no-op for an already-bare id — so the
  // resulting key is identical for well-formed callers, and safer for any
  // future caller that forgets the pre-normalisation.
  return imDriveTransferSourceKey(item.im_channel_type, item.im_group_no, item.im_msg_id);
}
