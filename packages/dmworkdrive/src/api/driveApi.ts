import axios from 'axios';
import { WKApp, buildAcceptLanguage } from '@octo/base';
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
  OrgSearchParams,
} from '../bridge/types';

/**
 * Isolated axios instance for the drive service.
 *
 * Kept separate from WKApp.apiClient's singleton (which is pinned to octo-server
 * at '/api/v1/') because drive is a distinct service reached at '/v1/drive/*'.
 * baseURL stays "" so requests are same-origin in the browser and the dev/nginx
 * proxy routes '/v1/drive' to the drive service. Mirrors dmworktodo's matterAxios.
 */
const driveAxios = axios.create({ baseURL: '' });

// Inject auth headers at request time (so the token stays fresh after refresh).
driveAxios.interceptors.request.use((config) => {
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

// Mirror APIClient: an expired token (401) logs the user out.
driveAxios.interceptors.response.use(undefined, (err) => {
  if (err?.response?.status === 401) {
    WKApp.shared.logout();
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
  const msg = data?.message || (err instanceof Error ? err.message : 'Request failed');
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

export async function listMembers(spaceId: string): Promise<Member[]> {
  const data = await get<{ members: Member[] }>(`/spaces/${spaceId}/members`);
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

export async function getDownloadUrl(fileId: number): Promise<DownloadResp> {
  return get<DownloadResp>(`/files/${fileId}/download`);
}

/**
 * Reject any presigned URL that isn't https (or http on localhost for dev
 * proxies). Defense-in-depth before PUTting bytes straight to object storage:
 * a misconfigured/compromised backend could point the URL at an internal or
 * plaintext host. Exported so the upload hook can validate early.
 */
export function assertSafeUploadURL(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DriveApiError('invalid upload url', 'unsafe_upload_url');
  }
  if (u.protocol === 'https:') return;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return;
  throw new DriveApiError('unsafe upload url', 'unsafe_upload_url');
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
  assertSafeUploadURL(uploadUrl);
  const headers: Record<string, string> = { 'Content-Type': opts.contentType };
  if (opts.contentDisposition) {
    headers['Content-Disposition'] = opts.contentDisposition;
  }
  const rawAxios = axios.create();
  const resp = await rawAxios.put(uploadUrl, file, {
    headers,
    timeout: 2 * 60 * 1000,
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

/** Recipient-side public access (no auth required by the backend). */
export async function accessShareByToken(token: string, password?: string): Promise<ShareAccess> {
  return post<ShareAccess>(`/public/shares/${token}/access`, password ? { password } : undefined);
}

/**
 * Recipient-side public download (no auth). Reuses the same token+password+expiry
 * check as accessShareByToken, then returns the anonymous object-storage URL
 * persisted at upload time so an external receiver downloads the bytes directly.
 */
export async function downloadShareByToken(
  token: string,
  password?: string,
): Promise<ShareDownload> {
  return post<ShareDownload>(
    `/public/shares/${token}/download`,
    password ? { password } : undefined,
  );
}

// ─── Invite ───────────────────────────────────────────────────────────────

export async function createInvite(spaceId: string, req: CreateInviteReq): Promise<Invite> {
  return post<Invite>(`/spaces/${spaceId}/invites`, req);
}

export async function listInvites(spaceId: string): Promise<Invite[]> {
  const data = await get<{ invites: Invite[] }>(`/spaces/${spaceId}/invites`);
  return data.invites ?? [];
}

export async function revokeInvite(spaceId: string, inviteId: string): Promise<void> {
  return del<void>(`/spaces/${spaceId}/invites/${inviteId}`);
}

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  return post<AcceptInviteResult>(`/invites/${token}/accept`);
}

// ─── Org picker (proxied to octo-server) ─────────────────────────────────────

/**
 * Org-member picker source. A non-empty `q` keyword-searches octo-server
 * (single-user lookup); an empty `q` lists the caller's current octo space
 * members (drive branches on the X-Space-Id header the interceptor sends).
 */
export async function searchOrgUser(
  params: OrgSearchParams,
  signal?: AbortSignal,
): Promise<OrgSearchResponse> {
  return get<OrgSearchResponse>(
    '/org/search',
    params as unknown as Record<string, unknown>,
    signal,
  );
}

export type { DriveRole };
