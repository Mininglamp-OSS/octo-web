import axios from 'axios';
import { WKApp, buildAcceptLanguage, DEFAULT_REQUEST_TIMEOUT_MS } from '@octo/base';
import type {
  Space,
  Member,
  DriveEntry,
  FileNode,
  CopyResult,
  DocRef,
  MountableDocsResponse,
  Blob as DriveBlob,
  PrepareUploadResp,
  DownloadResp,
  TransferResult,
  Share,
  ShareAccess,
  ShareDownload,
  Invite,
  AcceptInviteResult,
  BrowseResponse,
  OrgSearchResponse,
  CreateSpaceReq,
  RenameReq,
  AddMemberReq,
  UpdateMemberRoleReq,
  CreateFolderReq,
  MoveReq,
  CopyFileReq,
  MountDocReq,
  CreateBlobReq,
  PrepareUploadReq,
  ConfirmUploadReq,
  TransferFromImReq,
  CreateShareReq,
  CreateInviteReq,
  DriveRole,
  BrowseParams,
  MountableDocsParams,
} from '../bridge/types';

/**
 * Isolated axios instance for the drive service.
 *
 * Kept separate from WKApp.apiClient's singleton (which is pinned to octo-server
 * at '/api/v1/') because drive is a distinct service reached at '/v1/drive/*'.
 * In the browser the request interceptor resolves an absolute origin so drive
 * works outside a plain same-origin web page — the Electron desktop shell loads
 * from `file://` and the browser extension from its own origin, where an empty
 * baseURL would resolve against the wrong scheme/host and every drive call would
 * fail. Mirrors dmworkmcp's mcpAxios / dmworksummary's summaryAxios.
 */
const driveAxios = axios.create({
  baseURL: '',
  // Isolated instance (no shared interceptors), so it never inherits the 20s
  // default APIClient.initAxios sets on the axios singleton — set the same
  // ceiling explicitly to avoid the UI-hang class DEFAULT_REQUEST_TIMEOUT_MS
  // was introduced to close (a drive call with no timeout hangs forever).
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
});

/**
 * Resolve the drive service origin from the configured octo-server apiURL.
 *
 * A relative apiURL (plain web deployment) has no parsable origin → return ''
 * so requests stay same-origin (the Vite proxy / prod nginx forward
 * '/v1/drive/*'). An absolute apiURL (Electron `file://`, browser extension)
 * yields the real origin so the drive path resolves against octo-server's host
 * instead of `file://` / the extension origin. Mirrors mcpService.resolveBaseURL.
 */
function resolveBaseURL(): string {
  const apiURL = WKApp.apiClient?.config?.apiURL;
  if (!apiURL) return '';
  try {
    return new URL(apiURL).origin;
  } catch {
    return '';
  }
}

// Inject auth headers at request time (so the token stays fresh after refresh).
driveAxios.interceptors.request.use((config) => {
  config.baseURL = resolveBaseURL();
  config.headers = config.headers ?? {};
  config.headers['Accept-Language'] = buildAcceptLanguage();
  const token = WKApp.loginInfo.token;
  if (token) {
    config.headers['token'] = token;
  }
  const spaceId = WKApp.shared.currentSpaceId;
  if (spaceId) {
    config.headers['X-Space-Id'] = spaceId;
  }
  return config;
});

// Share-domain business error codes (see TASK-I1). A 401 carrying one of these
// is the SHARE rejecting the caller (unknown/revoked token, wrong password,
// expired), NOT the viewer's own Octo session dying — so it must reach
// ShareLandingPage's classify() rather than trigger a global logout. The
// backend serves these as 403/404 today; keying on the code (not the path)
// keeps the exemption correct even if a share-credential failure ever arrives
// as 401, without swallowing a genuine session 401 on the same route.
const SHARE_BUSINESS_CODES = new Set([
  'password_required',
  'wrong_password',
  'share_expired',
  'not_found',
]);

/**
 * Whether `url` targets the public-share namespace, anchored to the exact drive
 * base path so it never matches a sibling like `/v1/drive/publicshares` or an
 * unrelated `/public/shares/` on another service.
 */
function isSharePublicPath(url: string): boolean {
  const path = url.split('?')[0];
  return path.startsWith(`${BASE}/public/shares/`);
}

// Mirror APIClient: an expired octo session (401) logs the user out — EXCEPT a
// 401 from `/v1/drive/public/shares/:token/*` whose envelope carries a share
// business code, which means the share (not the session) rejected the caller.
// ShareLandingPage classifies that response by its code. Every other 401 —
// including a share-route `unauthorized`/session-expired 401 — still logs out,
// preserving the login-then-return-to-landing flow.
driveAxios.interceptors.response.use(undefined, (err) => {
  if (err?.response?.status === 401) {
    const url: string = err?.config?.url ?? '';
    const code = extractApiError(err).code;
    const isShareBusinessFailure =
      isSharePublicPath(url) && !!code && SHARE_BUSINESS_CODES.has(code);
    if (!isShareBusinessFailure) {
      WKApp.shared.logout();
    }
  }
  return Promise.reject(err);
});

/** Base path for the drive service. Backend routes are namespaced under this. */
const BASE = '/v1/drive';

/**
 * Structured drive API error preserving the server error code.
 *
 * The drive backend uses a FLAT error envelope: `{ error: "<code>", message }`
 * (NOT the nested `{ error: { code, message } }` shape used by the marketplace).
 * `code` is the machine string (e.g. "permission_denied", "not_found").
 */
export class DriveApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'DriveApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Whether `err` is a genuine session-expiry 401 — the single failure the response
 * interceptor above reacts to by firing a global logout. A share-business 401
 * (password_required / wrong_password / share_expired / not_found) is exempt and
 * is NOT session expiry; nor is any 403/404/5xx/network error. The landing pages
 * keep the stashed standalone-return target ONLY for this case, so re-login bounces
 * back to the deep-link; every other outcome clears the stash so it can't replay
 * under a different account that later signs in on the same tab (PR#1146 R10).
 */
export function isSessionExpiredError(err: unknown): boolean {
  return (
    err instanceof DriveApiError &&
    err.status === 401 &&
    !(err.code !== undefined && SHARE_BUSINESS_CODES.has(err.code))
  );
}

function extractApiError(err: unknown): DriveApiError {
  if (axios.isCancel(err)) {
    const abortErr = new DriveApiError('aborted', 'aborted');
    abortErr.name = 'AbortError';
    return abortErr;
  }
  const axiosErr = err as {
    response?: { status?: number; data?: { error?: string; message?: string } };
  };
  const data = axiosErr?.response?.data;
  const code = data?.error;
  const rawMsg = data?.message ?? (err instanceof Error ? err.message : 'Request failed');
  // Defend against a non-string `message` in the error envelope (a misbehaving
  // backend could send a number/object): coerce before length/slice.
  const msg = String(rawMsg);
  const capped = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
  return new DriveApiError(capped, code, axiosErr?.response?.status);
}

/** Drop undefined/null and stringify query params. */
function buildParams(obj?: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  if (!obj) return result;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

async function get<T>(
  path: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const config: { params: Record<string, string>; signal?: AbortSignal } = {
      params: buildParams(params),
    };
    if (signal) config.signal = signal;
    const resp = await driveAxios.get<T>(`${BASE}${path}`, config);
    return resp.data;
  } catch (err) {
    throw extractApiError(err);
  }
}

async function post<T>(path: string, data?: unknown): Promise<T> {
  try {
    const resp = await driveAxios.post<T>(`${BASE}${path}`, data);
    return resp.data;
  } catch (err) {
    throw extractApiError(err);
  }
}

async function put<T>(path: string, data?: unknown): Promise<T> {
  try {
    const resp = await driveAxios.put<T>(`${BASE}${path}`, data);
    return resp.data;
  } catch (err) {
    throw extractApiError(err);
  }
}

async function patch<T>(path: string, data?: unknown): Promise<T> {
  try {
    const resp = await driveAxios.patch<T>(`${BASE}${path}`, data);
    return resp.data;
  } catch (err) {
    throw extractApiError(err);
  }
}

async function del<T>(path: string): Promise<T> {
  try {
    const resp = await driveAxios.delete<T>(`${BASE}${path}`);
    return resp.data;
  } catch (err) {
    throw extractApiError(err);
  }
}

// ─── Space management ─────────────────────────────────────────────────────

export async function listSpaces(): Promise<Space[]> {
  const data = await get<{ spaces: Space[] }>('/spaces');
  return data.spaces ?? [];
}

export async function createSharedSpace(req: CreateSpaceReq): Promise<Space> {
  return post<Space>('/spaces', req);
}

export async function ensurePersonalSpace(): Promise<Space> {
  return post<Space>('/spaces/personal');
}

export async function getSpace(spaceId: string): Promise<Space> {
  return get<Space>(`/spaces/${spaceId}`);
}

export async function renameSpace(spaceId: string, req: RenameReq): Promise<void> {
  return put<void>(`/spaces/${spaceId}`, req);
}

export async function deleteSpace(spaceId: string): Promise<void> {
  return del<void>(`/spaces/${spaceId}`);
}

// ─── Space members ──────────────────────────────────────────────────────────

export async function listMembers(spaceId: string, signal?: AbortSignal): Promise<Member[]> {
  const data = await get<{ members: Member[] }>(`/spaces/${spaceId}/members`, undefined, signal);
  return data.members ?? [];
}

export async function addMember(spaceId: string, req: AddMemberReq): Promise<Member> {
  return post<Member>(`/spaces/${spaceId}/members`, req);
}

export async function updateMemberRole(
  spaceId: string,
  uid: string,
  req: UpdateMemberRoleReq,
): Promise<void> {
  return put<void>(`/spaces/${spaceId}/members/${uid}`, req);
}

export async function removeMember(spaceId: string, uid: string): Promise<void> {
  return del<void>(`/spaces/${spaceId}/members/${uid}`);
}

// ─── Folders ──────────────────────────────────────────────────────────────

export async function createFolder(req: CreateFolderReq): Promise<DriveEntry> {
  return post<DriveEntry>('/folders', req);
}

export async function listFolderChildren(
  spaceId: string,
  parentId: number,
): Promise<DriveEntry[]> {
  const data = await get<{ files: DriveEntry[] }>(`/folders/${spaceId}/${parentId}`);
  return data.files ?? [];
}

export async function renameFolder(folderId: number, req: RenameReq): Promise<void> {
  return patch<void>(`/folders/${folderId}/rename`, req);
}

export async function moveFolder(folderId: number, req: MoveReq): Promise<void> {
  return patch<void>(`/folders/${folderId}/move`, req);
}

export async function deleteFolder(folderId: number): Promise<void> {
  return del<void>(`/folders/${folderId}`);
}

// ─── Generic file ops (any node) ─────────────────────────────────────────────

export async function moveFile(fileId: number, req: MoveReq): Promise<void> {
  return post<void>(`/files/${fileId}/move`, req);
}

export async function copyFile(fileId: number, req: CopyFileReq): Promise<CopyResult> {
  return post<CopyResult>(`/files/${fileId}/copy`, req);
}

export async function renameFile(fileId: number, req: RenameReq): Promise<void> {
  return post<void>(`/files/${fileId}/rename`, req);
}

// ─── Unified browse ─────────────────────────────────────────────────────────

export async function browse(params: BrowseParams, signal?: AbortSignal): Promise<BrowseResponse> {
  return get<BrowseResponse>(
    '/browse',
    params as unknown as Record<string, unknown>,
    signal,
  );
}

// ─── Type-1 doc references (mount / unmount / list) ──────────────────────────

export async function mountDoc(req: MountDocReq): Promise<DocRef> {
  return post<DocRef>('/docs', req);
}

export async function unmountDoc(fileId: number): Promise<void> {
  return del<void>(`/docs/${fileId}`);
}

export async function listMountedDocs(spaceId: string, parentId = 0): Promise<DocRef[]> {
  const data = await get<{ docs: DocRef[] }>('/docs', {
    space_id: spaceId,
    parent_id: parentId,
  });
  return data.docs ?? [];
}

export async function listMountableDocs(
  params: MountableDocsParams,
  signal?: AbortSignal,
): Promise<MountableDocsResponse> {
  return get<MountableDocsResponse>(
    '/mountable-docs',
    params as unknown as Record<string, unknown>,
    signal,
  );
}

// ─── Type-2 blobs — CRUD ─────────────────────────────────────────────────────

export async function createBlob(req: CreateBlobReq): Promise<DriveBlob> {
  return post<DriveBlob>('/blobs', req);
}

export async function getBlob(blobId: number): Promise<DriveBlob> {
  return get<DriveBlob>(`/blobs/${blobId}`);
}

export async function listBlobs(spaceId: string, parentId = 0): Promise<DriveBlob[]> {
  const data = await get<{ blobs: DriveBlob[] }>('/blobs', {
    space_id: spaceId,
    parent_id: parentId,
  });
  return data.blobs ?? [];
}

export async function deleteBlob(blobId: number): Promise<void> {
  return del<void>(`/blobs/${blobId}`);
}

export async function transferFromIm(req: TransferFromImReq): Promise<TransferResult> {
  return post<TransferResult>('/blobs/transfer-from-im', req);
}

export interface ImTransferredEntry {
  file_id: number;
  space_id: string;
  parent_id: number;
}

/** Batch-query whether a set of IM files (identified by their message urls)
 *  have already been transferred into the caller's personal space. Only hit
 *  ref_ids appear in the returned map — missing keys mean "not yet transferred". */
export async function checkImTransferredBatch(
  refIds: string[],
): Promise<Record<string, ImTransferredEntry>> {
  const resp = await post<{ results: Record<string, ImTransferredEntry> }>(
    '/blobs/im-transferred/batch',
    { ref_ids: refIds },
  );
  return resp.results ?? {};
}

// ─── Type-2 blobs — two-phase direct upload ─────────────────────────────────

export async function prepareUpload(req: PrepareUploadReq): Promise<PrepareUploadResp> {
  return post<PrepareUploadResp>('/files/prepare-upload', req);
}

export async function confirmUpload(
  fileId: number,
  req?: ConfirmUploadReq,
): Promise<DriveBlob> {
  return post<DriveBlob>(`/files/${fileId}/confirm-upload`, req);
}

/**
 * Cancel a still-pending upload, best-effort (spec §2 D-3).
 *
 * Idempotent on the backend: 204 whether the pending record still existed or
 * was already gone / unknown id. A 409 means confirm-upload already won the
 * race — the file is confirmed, not cancellable — so the caller surfaces the
 * confirmed result instead of a phantom removal rather than treating it as an
 * error. Runs on the authed `driveAxios` like the other logged-in file ops
 * (this is a drive-member action, NOT an anonymous share endpoint).
 */
export async function cancelUpload(fileId: number): Promise<void> {
  return post<void>(`/files/${fileId}/cancel-upload`);
}

export async function getDownloadUrl(fileId: number): Promise<DownloadResp> {
  return get<DownloadResp>(`/files/${fileId}/download`);
}

/**
 * Reject any presigned object-storage URL that isn't https (or http on localhost
 * for dev proxies). Defense-in-depth for BOTH directions: before PUTting bytes to
 * an upload URL and before handing a signed download/GET URL to the browser — a
 * misconfigured/compromised backend could point either at an internal or
 * plaintext host. Exported so the upload hook and download paths validate early.
 */
export function assertSafePresignedURL(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DriveApiError('invalid presigned url', 'unsafe_presigned_url');
  }
  if (u.protocol === 'https:') return;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return;
  throw new DriveApiError('unsafe presigned url', 'unsafe_presigned_url');
}

export interface PutToStorageOptions {
  contentType: string;
  contentDisposition?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * PUT file bytes directly to object storage using the presigned URL from
 * prepareUpload.
 *
 * M-3 credential-isolation rule: this uses a FRESH axios.create() with NO
 * interceptors. The global axios singleton (APIClient.ts) injects `token` +
 * `X-Space-Id` on every request; the presigned URL points at an external
 * storage origin, so those headers would leak the session token to a
 * third-party host (P1 credential exposure, PR#851). A fresh instance never
 * picked up that interceptor, so no credentials cross the origin — and it
 * avoids S3/OSS presigners rejecting unexpected headers with
 * `SignatureDoesNotMatch`. The PUT must echo Content-Type (and
 * Content-Disposition when present) and send the raw bytes untransformed.
 */
export async function putToPresignedUrl(
  uploadUrl: string,
  file: Blob,
  opts: PutToStorageOptions,
): Promise<void> {
  assertSafePresignedURL(uploadUrl);
  const headers: Record<string, string> = { 'Content-Type': opts.contentType };
  if (opts.contentDisposition) {
    headers['Content-Disposition'] = opts.contentDisposition;
  }
  const rawAxios = axios.create();
  const resp = await rawAxios.put(uploadUrl, file, {
    headers,
    // No time limit on the byte transfer: a large file over a slow link can
    // legitimately take minutes, and a fixed ceiling would abort a healthy
    // upload. The caller's AbortController (opts.signal) is the sole cancel
    // mechanism. (The control-plane driveAxios keeps DEFAULT_REQUEST_TIMEOUT_MS —
    // this exemption is only for the raw object-storage PUT.)
    timeout: 0,
    // Resolve every status so the explicit 2xx check below runs (and can throw a
    // typed DriveApiError). Without this, axios rejects non-2xx with a generic
    // AxiosError before the check — making the branch dead and its error opaque.
    validateStatus: () => true,
    // Send file bytes as-is; don't let axios JSON-stringify them.
    transformRequest: [(data) => data],
    onUploadProgress: opts.onProgress
      ? (e: { loaded: number; total?: number }) => {
          if (e.total) opts.onProgress!(Math.round((e.loaded / e.total) * 100));
        }
      : undefined,
    signal: opts.signal,
  });
  if (!(resp.status >= 200 && resp.status < 300)) {
    throw new DriveApiError('upload failed', 'upload_failed', resp.status);
  }
}

// ─── Share ────────────────────────────────────────────────────────────────

export async function createShare(req: CreateShareReq): Promise<Share> {
  return post<Share>('/shares', req);
}

export async function listShares(): Promise<Share[]> {
  const data = await get<{ shares: Share[] }>('/shares');
  return data.shares ?? [];
}

export async function revokeShare(shareId: string): Promise<void> {
  return del<void>(`/shares/${shareId}`);
}

/**
 * Recipient-side share access. Requires a valid Octo session: any signed-in Octo
 * user may open a share (regardless of whether they belong to the file's Space);
 * external/anonymous visitors cannot. Sent through the authed `driveAxios`, so a
 * genuine session 401 still triggers logout — but a 401 carrying a share business
 * code (password_required / wrong_password / share_expired / not_found) does NOT,
 * so ShareLandingPage can classify it instead of tearing down the session. The
 * path keeps the `/public/shares/...` name for backend-route compatibility, but
 * the request carries the session token.
 */
export async function accessShareByToken(token: string, password?: string): Promise<ShareAccess> {
  return post<ShareAccess>(`/public/shares/${encodeURIComponent(token)}/access`, password ? { password } : undefined);
}

/**
 * Recipient-side share download. Reuses the same token+password+expiry check as
 * accessShareByToken and returns the object-storage URL. Authed like access —
 * any signed-in Octo user may download; same 401 handling (session 401 logs out,
 * a share-business-code 401 is left for the caller to classify).
 */
export async function downloadShareByToken(
  token: string,
  password?: string,
): Promise<ShareDownload> {
  return post<ShareDownload>(
    `/public/shares/${encodeURIComponent(token)}/download`,
    password ? { password } : undefined,
  );
}

// ─── Invite ───────────────────────────────────────────────────────────────

export async function createInvite(spaceId: string, req: CreateInviteReq): Promise<Invite> {
  return post<Invite>(`/spaces/${spaceId}/invites`, req);
}

export async function listInvites(spaceId: string, signal?: AbortSignal): Promise<Invite[]> {
  const data = await get<{ invites: Invite[] }>(`/spaces/${spaceId}/invites`, undefined, signal);
  return data.invites ?? [];
}

export async function revokeInvite(spaceId: string, inviteId: string): Promise<void> {
  return del<void>(`/spaces/${spaceId}/invites/${inviteId}`);
}

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  return post<AcceptInviteResult>(`/invites/${encodeURIComponent(token)}/accept`);
}

// ─── Org picker (proxied to octo-server) ─────────────────────────────────────

/**
 * List every member of the caller's current octo space, for the org picker's
 * fetch-once-then-filter-locally flow. Scoped by the `X-Space-Id` header the
 * request interceptor injects (the octo space id, NOT the drive `space_id`);
 * drive proxies to octo-server and pages the roster exhaustively. Candidates
 * carry uid + name only — pinyin/keyword matching happens client-side.
 *
 * `total`, when present, is the authoritative roster size. The caller uses it
 * only as a completeness hint: a missing/non-numeric total, or one that
 * disagrees with the delivered count, surfaces a non-blocking "possibly
 * incomplete" notice — it still caches and shows the delivered roster rather
 * than failing closed on an unversioned field.
 */
export async function listOrgMembers(signal?: AbortSignal): Promise<OrgSearchResponse> {
  return get<OrgSearchResponse>('/org/members', undefined, signal);
}

export type { DriveRole };
