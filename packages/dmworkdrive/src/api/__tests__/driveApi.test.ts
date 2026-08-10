import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock axios BEFORE importing the api layer. create() always returns the same
// stub instance so we can inspect calls to both the drive instance and the
// interceptor-free upload instance.
vi.mock('axios', () => {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return {
    default: {
      create: vi.fn(() => instance),
      isCancel: vi.fn(() => false),
    },
  };
});

import axios from 'axios';
import { WKApp, DEFAULT_REQUEST_TIMEOUT_MS } from '@octo/base';
import * as driveApi from '../driveApi';
import { DriveApiError, assertSafePresignedURL, putToPresignedUrl } from '../driveApi';

// Same stub instance returned by every axios.create() call.
const inst = (axios as unknown as { create: () => any }).create();

beforeEach(() => {
  inst.get.mockReset();
  inst.post.mockReset();
  inst.put.mockReset();
  inst.patch.mockReset();
  inst.delete.mockReset();
  (axios as unknown as { isCancel: any }).isCancel.mockReturnValue(false);
});

function ok(data: unknown) {
  return { data };
}

describe('request wrappers — path / method / unwrap', () => {
  it('listSpaces GETs /v1/drive/spaces and unwraps .spaces', async () => {
    inst.get.mockResolvedValue(ok({ spaces: [{ id: 's1' }] }));
    const res = await driveApi.listSpaces();
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/spaces', { params: {} });
    expect(res).toEqual([{ id: 's1' }]);
  });

  it('createSharedSpace POSTs body', async () => {
    inst.post.mockResolvedValue(ok({ id: 's2', name: 'X' }));
    const res = await driveApi.createSharedSpace({ name: 'X' });
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/spaces', { name: 'X' });
    expect(res).toEqual({ id: 's2', name: 'X' });
  });

  it('ensurePersonalSpace POSTs /spaces/personal with no body', async () => {
    inst.post.mockResolvedValue(ok({ id: 'p1' }));
    await driveApi.ensurePersonalSpace();
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/spaces/personal', undefined);
  });

  it('renameSpace PUTs to /spaces/:id', async () => {
    inst.put.mockResolvedValue(ok(undefined));
    await driveApi.renameSpace('s1', { name: 'New' });
    expect(inst.put).toHaveBeenCalledWith('/v1/drive/spaces/s1', { name: 'New' });
  });

  it('deleteSpace DELETEs /spaces/:id', async () => {
    inst.delete.mockResolvedValue(ok(undefined));
    await driveApi.deleteSpace('s1');
    expect(inst.delete).toHaveBeenCalledWith('/v1/drive/spaces/s1');
  });

  it('listMembers unwraps .members', async () => {
    inst.get.mockResolvedValue(ok({ members: [{ uid: 'u1' }] }));
    const res = await driveApi.listMembers('s1');
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/spaces/s1/members', { params: {} });
    expect(res).toEqual([{ uid: 'u1' }]);
  });

  it('updateMemberRole PUTs /spaces/:id/members/:uid', async () => {
    inst.put.mockResolvedValue(ok(undefined));
    await driveApi.updateMemberRole('s1', 'u1', { role: 'editor' });
    expect(inst.put).toHaveBeenCalledWith('/v1/drive/spaces/s1/members/u1', { role: 'editor' });
  });

  it('createFolder POSTs /folders', async () => {
    inst.post.mockResolvedValue(ok({ id: 10 }));
    await driveApi.createFolder({ space_id: 's1', parent_id: 0, name: 'f' });
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/folders', {
      space_id: 's1',
      parent_id: 0,
      name: 'f',
    });
  });

  it('listFolderChildren GETs /folders/:space/:parent and unwraps .files', async () => {
    inst.get.mockResolvedValue(ok({ files: [{ id: 1 }] }));
    const res = await driveApi.listFolderChildren('s1', 0);
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/folders/s1/0', { params: {} });
    expect(res).toEqual([{ id: 1 }]);
  });

  it('renameFolder / moveFolder use PATCH', async () => {
    inst.patch.mockResolvedValue(ok(undefined));
    await driveApi.renameFolder(5, { name: 'n' });
    expect(inst.patch).toHaveBeenCalledWith('/v1/drive/folders/5/rename', { name: 'n' });
    await driveApi.moveFolder(5, { parent_id: 2 });
    expect(inst.patch).toHaveBeenCalledWith('/v1/drive/folders/5/move', { parent_id: 2 });
  });

  it('moveFile / copyFile / renameFile use POST under /files/:id', async () => {
    inst.post.mockResolvedValue(ok({ root: { id: 9 }, total_rows: 3 }));
    await driveApi.moveFile(9, { parent_id: 1 });
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/files/9/move', { parent_id: 1 });
    const copy = await driveApi.copyFile(9, { parent_id: 1, name: 'c' });
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/files/9/copy', { parent_id: 1, name: 'c' });
    expect(copy).toEqual({ root: { id: 9 }, total_rows: 3 });
  });

  it('browse passes query params and returns the full response', async () => {
    const body = { entries: [], page: { data: [] }, filter: { type: '', source: '' } };
    inst.get.mockResolvedValue(ok(body));
    const res = await driveApi.browse({ space_id: 's1', parent_id: 0, type: 'all' });
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/browse', {
      params: { space_id: 's1', parent_id: '0', type: 'all' },
    });
    expect(res).toBe(body);
  });

  it('listMountableDocs GETs /mountable-docs', async () => {
    inst.get.mockResolvedValue(ok({ items: [], page: { data: [] }, total: 0 }));
    await driveApi.listMountableDocs({ space_id: 's1', page: 1, page_size: 50 });
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/mountable-docs', {
      params: { space_id: 's1', page: '1', page_size: '50' },
    });
  });

  it('mountDoc POSTs /docs', async () => {
    inst.post.mockResolvedValue(ok({ id: 1, doc_id: 'd1' }));
    await driveApi.mountDoc({ space_id: 's1', parent_id: 0, doc_id: 'd1', doc_title: 'T' });
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/docs', {
      space_id: 's1',
      parent_id: 0,
      doc_id: 'd1',
      doc_title: 'T',
    });
  });

  it('listMountedDocs sends space_id + parent_id defaulting to 0', async () => {
    inst.get.mockResolvedValue(ok({ docs: [] }));
    await driveApi.listMountedDocs('s1');
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/docs', {
      params: { space_id: 's1', parent_id: '0' },
    });
  });
});

describe('two-phase upload endpoints', () => {
  it('prepareUpload POSTs /files/prepare-upload', async () => {
    inst.post.mockResolvedValue(ok({ file_id: 7, upload_url: 'https://s/x' }));
    const res = await driveApi.prepareUpload({
      space_id: 's1',
      parent_id: 0,
      name: 'a.txt',
      size: 5,
      content_type: 'text/plain',
    });
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/files/prepare-upload', {
      space_id: 's1',
      parent_id: 0,
      name: 'a.txt',
      size: 5,
      content_type: 'text/plain',
    });
    expect(res.file_id).toBe(7);
  });

  it('confirmUpload POSTs /files/:id/confirm-upload (body optional)', async () => {
    inst.post.mockResolvedValue(ok({ id: 7, status: 'confirmed' }));
    await driveApi.confirmUpload(7);
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/files/7/confirm-upload', undefined);
    await driveApi.confirmUpload(7, { actual_size: 5 });
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/files/7/confirm-upload', { actual_size: 5 });
  });

  it('cancelUpload POSTs /files/:id/cancel-upload with no body', async () => {
    inst.post.mockResolvedValue(ok(undefined));
    await driveApi.cancelUpload(7);
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/files/7/cancel-upload', undefined);
  });

  it('cancelUpload surfaces a 409 (confirm already won) as a typed DriveApiError', async () => {
    inst.post.mockRejectedValue({ response: { status: 409, data: { error: 'conflict' } } });
    await expect(driveApi.cancelUpload(7)).rejects.toMatchObject({
      name: 'DriveApiError',
      status: 409,
      code: 'conflict',
    });
  });

  it('getDownloadUrl GETs /files/:id/download', async () => {
    inst.get.mockResolvedValue(ok({ url: 'https://s/dl', filename: 'a.txt' }));
    const res = await driveApi.getDownloadUrl(7);
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/files/7/download', { params: {} });
    expect(res.url).toBe('https://s/dl');
  });
});

describe('share / invite / org', () => {
  it('createShare POSTs /shares', async () => {
    inst.post.mockResolvedValue(ok({ id: 'sh1' }));
    await driveApi.createShare({ file_id: 1, permission: 'view', expires_in_seconds: 3600 });
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/shares', {
      file_id: 1,
      permission: 'view',
      expires_in_seconds: 3600,
    });
  });

  it('accessShareByToken hits the authed share-token route, omitting body when no password', async () => {
    inst.post.mockResolvedValue(ok({ file_id: 1 }));
    await driveApi.accessShareByToken('tok');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/shares/tok/access', undefined);
    await driveApi.accessShareByToken('tok', 'pw');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/shares/tok/access', { password: 'pw' });
  });

  it('downloadShareByToken POSTs the authed share-token download route, omitting body when no password', async () => {
    inst.post.mockResolvedValue(ok({ url: 'https://s/dl', filename: 'a.txt', content_type: 'text/plain' }));
    const res = await driveApi.downloadShareByToken('tok');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/shares/tok/download', undefined);
    expect(res.url).toBe('https://s/dl');
    await driveApi.downloadShareByToken('tok', 'pw');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/shares/tok/download', { password: 'pw' });
  });

  it('revokeShare DELETEs /shares/:id — the owner-side sibling of the token routes', async () => {
    inst.delete.mockResolvedValue(ok(undefined));
    await driveApi.revokeShare('sh1');
    expect(inst.delete).toHaveBeenCalledWith('/v1/drive/shares/sh1');
  });

  it('acceptInvite POSTs /invites/:token/accept', async () => {
    inst.post.mockResolvedValue(ok({ space_id: 's1', role: 'editor', already_member: false }));
    await driveApi.acceptInvite('tok');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/invites/tok/accept', undefined);
  });

  it('listOrgMembers GETs /org/members (space scoped by the X-Space-Id header)', async () => {
    inst.get.mockResolvedValue(ok({ candidates: [{ uid: 'u1' }, { uid: 'u2' }], total: 2 }));
    const res = await driveApi.listOrgMembers();
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/org/members', {
      params: {},
    });
    expect(res.total).toBe(2);
  });
});

describe('error mapping (flat envelope)', () => {
  it('maps { error, message } to DriveApiError with code + status', async () => {
    inst.post.mockRejectedValue({
      response: { status: 403, data: { error: 'permission_denied', message: 'nope' } },
    });
    await expect(driveApi.createSharedSpace({ name: 'X' })).rejects.toMatchObject({
      name: 'DriveApiError',
      code: 'permission_denied',
      status: 403,
      message: 'nope',
    });
  });

  it('falls back to the axios error message when no envelope', async () => {
    inst.get.mockRejectedValue(new Error('Network Error'));
    await expect(driveApi.listSpaces()).rejects.toBeInstanceOf(DriveApiError);
  });
});

describe('auth-header interceptor', () => {
  it('creates the drive axios instance with an explicit request timeout (N3 hardening)', () => {
    // The isolated instance must set DEFAULT_REQUEST_TIMEOUT_MS explicitly — it
    // doesn't inherit the singleton's timeout, so without this a drive call could
    // hang the UI forever. Assert the module-load create() carried the ceiling.
    const create = (axios as unknown as { create: ReturnType<typeof vi.fn> }).create;
    const configs = create.mock.calls.map((c) => c[0]).filter(Boolean);
    expect(
      configs.some((cfg: { timeout?: number }) => cfg?.timeout === DEFAULT_REQUEST_TIMEOUT_MS),
    ).toBe(true);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('injects token + X-Space-Id + Accept-Language at request time', () => {
    const requestUse = inst.interceptors.request.use as ReturnType<typeof vi.fn>;
    const onRequest = requestUse.mock.calls[0][0];
    const config = onRequest({ headers: {} });
    expect(config.headers.token).toBe('test-token-abc');
    expect(config.headers['X-Space-Id']).toBe('space-123');
    expect(config.headers['Accept-Language']).toBeTruthy();
  });

  it('reads the LATEST host X-Space-Id at request time, not a value captured earlier (F3)', () => {
    // The org-members fetch is scoped only by this header, so a host space switch
    // between two requests must be reflected — the interceptor reads
    // WKApp.shared.currentSpaceId on each call rather than closing over it.
    const requestUse = inst.interceptors.request.use as ReturnType<typeof vi.fn>;
    const onRequest = requestUse.mock.calls[0][0];
    const original = WKApp.shared.currentSpaceId;
    try {
      WKApp.shared.currentSpaceId = 'space-A';
      expect(onRequest({ headers: {} }).headers['X-Space-Id']).toBe('space-A');
      WKApp.shared.currentSpaceId = 'space-B';
      expect(onRequest({ headers: {} }).headers['X-Space-Id']).toBe('space-B');
    } finally {
      WKApp.shared.currentSpaceId = original;
    }
  });

  it('preserves a pre-set X-Space-Id header instead of clobbering it with the host tab (postWithSpace path)', () => {
    // save-to-drive posts into an arbitrary target space and passes the target
    // as a per-request X-Space-Id override. The interceptor must NOT overwrite
    // it with WKApp.shared.currentSpaceId, or the transfer's RequireSpace
    // middleware would reverse-check the wrong space and 403.
    const requestUse = inst.interceptors.request.use as ReturnType<typeof vi.fn>;
    const onRequest = requestUse.mock.calls[0][0];
    const original = WKApp.shared.currentSpaceId;
    try {
      WKApp.shared.currentSpaceId = 'host-space';
      const config = onRequest({ headers: { 'X-Space-Id': 'target-space' } });
      expect(config.headers['X-Space-Id']).toBe('target-space');
    } finally {
      WKApp.shared.currentSpaceId = original;
    }
  });

  it('logs out on a 401 from a normal drive API', async () => {
    const logout = vi.spyOn(WKApp.shared, 'logout');
    const responseUse = inst.interceptors.response.use as ReturnType<typeof vi.fn>;
    const onError = responseUse.mock.calls[0][1];
    await expect(
      onError({ response: { status: 401 }, config: { url: '/v1/drive/spaces' } }),
    ).rejects.toBeDefined();
    expect(logout).toHaveBeenCalled();
    logout.mockRestore();
  });

  it('does NOT log out on a share-token 401 carrying a business code (B1)', async () => {
    const logout = vi.spyOn(WKApp.shared, 'logout');
    const responseUse = inst.interceptors.response.use as ReturnType<typeof vi.fn>;
    const onError = responseUse.mock.calls[0][1];
    // Every share business code, on both share endpoints, is left for the page
    // to classify — the share rejected the caller, the octo session is fine.
    // A query string must not break the path match.
    for (const url of [
      '/v1/drive/shares/tok/access',
      '/v1/drive/shares/tok/download',
      '/v1/drive/shares/tok/access?x=1',
    ]) {
      for (const code of ['password_required', 'wrong_password', 'share_expired', 'not_found']) {
        await expect(
          onError({ response: { status: 401, data: { error: code } }, config: { url } }),
        ).rejects.toBeDefined();
      }
    }
    expect(logout).not.toHaveBeenCalled();
    logout.mockRestore();
  });

  it('the share-token exemption is anchored — owner-side and near-miss paths still log out', async () => {
    const logout = vi.spyOn(WKApp.shared, 'logout');
    const responseUse = inst.interceptors.response.use as ReturnType<typeof vi.fn>;
    const onError = responseUse.mock.calls[0][1];
    // Only `${BASE}/shares/:token/access|download` is exempt. The owner-side
    // siblings that share the prefix (list/create `/shares`, revoke
    // `/shares/:id`), a near-miss prefix, a nested extra segment and a
    // trailing slash are all genuine session 401s → global logout.
    const notExempt = [
      '/v1/drive/shares',
      '/v1/drive/shares?page=1',
      '/v1/drive/shares/sh1',
      '/v1/drive/shares/tok/access/',
      '/v1/drive/shares/tok/access/extra',
      '/v1/drive/sharesX/tok/access',
      '/v1/drive/public/shares/tok/access',
      '/v1/driveX/shares/tok/access',
      '/other/shares/tok/access',
      '/v1/drive/shares//access',
    ];
    for (const url of notExempt) {
      await expect(
        onError({ response: { status: 401, data: { error: 'not_found' } }, config: { url } }),
      ).rejects.toBeDefined();
    }
    expect(logout).toHaveBeenCalledTimes(notExempt.length);
    logout.mockRestore();
  });

  it('DOES log out on a share-token 401 that is a session failure, not a share code (B1)', async () => {
    const logout = vi.spyOn(WKApp.shared, 'logout');
    const responseUse = inst.interceptors.response.use as ReturnType<typeof vi.fn>;
    const onError = responseUse.mock.calls[0][1];
    // A genuine expired session on a share route (envelope `unauthorized`, or no
    // recognisable code at all) must still log out — the whole-path exemption
    // this replaces would have swallowed it.
    await expect(
      onError({
        response: { status: 401, data: { error: 'unauthorized' } },
        config: { url: '/v1/drive/shares/tok/access' },
      }),
    ).rejects.toBeDefined();
    await expect(
      onError({
        response: { status: 401 },
        config: { url: '/v1/drive/shares/tok/download' },
      }),
    ).rejects.toBeDefined();
    expect(logout).toHaveBeenCalledTimes(2);
    logout.mockRestore();
  });

  it('share access + download reject with a typed code and no logout on a business-code 401 (B1)', async () => {
    // Exercise the real functions end-to-end: a share-path 401 with a business
    // code surfaces as a DriveApiError carrying that code and must not tear down
    // the viewer's session.
    const logout = vi.spyOn(WKApp.shared, 'logout');
    inst.post.mockRejectedValue({
      response: { status: 401, data: { error: 'wrong_password', message: 'bad password' } },
      config: { url: '/v1/drive/shares/tok/access' },
    });
    await expect(driveApi.accessShareByToken('tok', 'nope')).rejects.toMatchObject({
      code: 'wrong_password',
      status: 401,
    });
    inst.post.mockRejectedValue({
      response: { status: 401, data: { error: 'share_expired', message: 'expired' } },
      config: { url: '/v1/drive/shares/tok/download' },
    });
    await expect(driveApi.downloadShareByToken('tok')).rejects.toMatchObject({
      code: 'share_expired',
      status: 401,
    });
    expect(logout).not.toHaveBeenCalled();
    logout.mockRestore();
  });

  it('shares run on the single authed drive instance — one request + one response interceptor (N2)', () => {
    // Share access/download require a valid Octo session, so they run on the SAME
    // authed driveAxios (no separate anonymous instance): one request interceptor
    // (token/X-Space-Id/Accept-Language) and one response interceptor registered at
    // module load. The response interceptor logs out on a normal 401 but exempts
    // only a share-route 401 whose envelope carries a share business code (B1).
    const requestUse = inst.interceptors.request.use as ReturnType<typeof vi.fn>;
    const responseUse = inst.interceptors.response.use as ReturnType<typeof vi.fn>;
    expect(requestUse.mock.calls.length).toBe(1);
    expect(responseUse.mock.calls.length).toBe(1);
    // That single request interceptor attaches the session token.
    const onRequest = requestUse.mock.calls[0][0];
    const cfg = onRequest({ headers: {} });
    expect(cfg.headers.token).toBe('test-token-abc');
    expect(cfg.headers['Accept-Language']).toBeTruthy();
  });
});

describe('assertSafePresignedURL', () => {
  it('accepts https', () => {
    expect(() => assertSafePresignedURL('https://storage.example.com/x')).not.toThrow();
  });
  it('accepts http on localhost', () => {
    expect(() => assertSafePresignedURL('http://localhost:9000/x')).not.toThrow();
    expect(() => assertSafePresignedURL('http://127.0.0.1:9000/x')).not.toThrow();
  });
  it('rejects http on a remote host', () => {
    expect(() => assertSafePresignedURL('http://evil.example.com/x')).toThrow(DriveApiError);
  });
  it('rejects a non-URL', () => {
    expect(() => assertSafePresignedURL('not a url')).toThrow(DriveApiError);
  });
});

describe('putToPresignedUrl — M-3 credential isolation', () => {
  it('PUTs bytes with echoed headers and NO credential headers', async () => {
    inst.put.mockResolvedValue({ status: 200 });
    const file = new Blob(['hello'], { type: 'text/plain' });
    await putToPresignedUrl('https://storage.example.com/obj', file, {
      contentType: 'text/plain',
      contentDisposition: 'attachment; filename="a.txt"',
    });
    expect(inst.put).toHaveBeenCalledTimes(1);
    const [url, body, config] = inst.put.mock.calls[0];
    expect(url).toBe('https://storage.example.com/obj');
    expect(body).toBe(file);
    expect(config.headers['Content-Type']).toBe('text/plain');
    expect(config.headers['Content-Disposition']).toBe('attachment; filename="a.txt"');
    // The credential headers the global singleton would have added must be absent.
    expect(config.headers.token).toBeUndefined();
    expect(config.headers['X-Space-Id']).toBeUndefined();
    // Raw bytes must not be JSON-transformed.
    expect(Array.isArray(config.transformRequest)).toBe(true);
    // B4: no time limit on the object-storage PUT — a large file over a slow link
    // can take minutes; opts.signal (AbortController) is the only cancel path.
    expect(config.timeout).toBe(0);
    expect(config.signal).toBeUndefined();
  });

  it('refuses an unsafe URL and never PUTs', async () => {
    await expect(
      putToPresignedUrl('http://evil.example.com/obj', new Blob(['x']), { contentType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'unsafe_presigned_url' });
    expect(inst.put).not.toHaveBeenCalled();
  });

  it('throws upload_failed on a non-2xx status — reachable because validateStatus resolves all', async () => {
    inst.put.mockResolvedValue({ status: 403 });
    await expect(
      putToPresignedUrl('https://storage.example.com/obj', new Blob(['x']), { contentType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'upload_failed' });
    // Without validateStatus, real axios rejects non-2xx before the manual 2xx
    // check runs — making that branch dead. Assert we opt into resolving every
    // status so the typed DriveApiError('upload_failed') is genuinely reachable.
    const [, , config] = inst.put.mock.calls[0];
    expect(config.validateStatus).toBeTypeOf('function');
    expect(config.validateStatus(500)).toBe(true);
    expect(config.validateStatus(200)).toBe(true);
  });
});

// ─── IM → drive transferred-state wire contract ────────────────────────────
//
// Pin the cross-service contract that the "already saved to my drive" check
// depends on. There is no codegen / OpenAPI between octo-drive and octo-web,
// so the frontend blind-reconstructs the backend's `source_key` from the IM
// message triple; any silent drift (delimiter, field order, id-field name,
// Space-prefix stripping) would fail 100% of lookups with no runtime signal.
// These tests give the contract CI-time enforcement.
//
// Backend anchor: octo-drive
//   - internal/modules/imtransfer/service.go `buildSourceKey`
//   - db/migrations/007_add_file_source_key.up.sql
//   - internal/modules/imtransfer/api.go   POST /blobs/im-transferred/batch
import {
  imTransferredSourceKey,
  normaliseImChannelID,
} from '../../bridge/types';
import { isDriveTransferSupportedChannel } from '@octo/base';

describe('IM -> drive transferred-state wire contract (source_key)', () => {
  it('transferFromIm POSTs /blobs/transfer-from-im with the IM message triple', async () => {
    inst.post.mockResolvedValue(ok({ id: 42, space_id: 'sp_personal', parent_id: 0 }));
    const req = {
      im_group_no: 'group_abc',
      im_channel_type: 2,
      im_msg_id: '17012345678901234',
      target_space_id: '',
      target_parent_id: 0,
    };
    await driveApi.transferFromIm(req);
    // Empty target_space_id → plain post (2-arg call); the request interceptor
    // fills X-Space-Id with the host tab's current space by default.
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/blobs/transfer-from-im', {
      im_group_no: 'group_abc',
      im_channel_type: 2,
      im_msg_id: '17012345678901234',
      target_space_id: '',
      target_parent_id: 0,
    });
    // No per-request config → no X-Space-Id override was set.
    const call = inst.post.mock.calls[0];
    expect(call.length).toBe(2);
  });

  it('transferFromIm passes target_space_id as an X-Space-Id header override', async () => {
    inst.post.mockResolvedValue(ok({ id: 99, space_id: 'sp_shared', parent_id: 0 }));
    const req = {
      im_group_no: 'group_abc',
      im_channel_type: 2,
      im_msg_id: '17012345678901234',
      target_space_id: 'sp_shared',
      target_parent_id: 42,
    };
    await driveApi.transferFromIm(req);
    // Non-empty target_space_id → the request must carry that target as
    // X-Space-Id so RequireSpace reverse-checks against MySpaces for the
    // TARGET space, not the host tab's current space. The interceptor is
    // configured to preserve a pre-set X-Space-Id header (see driveApi.ts).
    expect(inst.post).toHaveBeenCalledWith(
      '/v1/drive/blobs/transfer-from-im',
      req,
      { headers: { 'X-Space-Id': 'sp_shared' } },
    );
  });

  it('getAncestors GETs /files/:id/ancestors and unwraps .ancestors', async () => {
    inst.get.mockResolvedValue(ok({ ancestors: [{ id: 10, name: 'A' }, { id: 20, name: 'B' }] }));
    const res = await driveApi.getAncestors(42);
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/files/42/ancestors', { params: {} });
    expect(res).toEqual([{ id: 10, name: 'A' }, { id: 20, name: 'B' }]);
  });

  it('getAncestors returns [] for a root file (empty ancestors response)', async () => {
    inst.get.mockResolvedValue(ok({ ancestors: [] }));
    expect(await driveApi.getAncestors(1)).toEqual([]);
  });

  it('checkImTransferredBatch POSTs /blobs/im-transferred/batch with items[] triples', async () => {
    const sourceKeyA = '2#group_abc#111';
    const sourceKeyB = '1#peer_uid_xyz#222';
    inst.post.mockResolvedValue(ok({
      results: {
        [sourceKeyA]: { file_id: 42, space_id: 'sp_personal', parent_id: 0 },
        [sourceKeyB]: { file_id: 43, space_id: 'sp_personal', parent_id: 0 },
      },
    }));
    const items = [
      { im_group_no: 'group_abc',    im_channel_type: 2, im_msg_id: '111' },
      { im_group_no: 'peer_uid_xyz', im_channel_type: 1, im_msg_id: '222' },
    ];
    const res = await driveApi.checkImTransferredBatch(items);
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/blobs/im-transferred/batch', { items });
    expect(res[sourceKeyA]).toEqual({ file_id: 42, space_id: 'sp_personal', parent_id: 0 });
    expect(res[sourceKeyB]).toEqual({ file_id: 43, space_id: 'sp_personal', parent_id: 0 });
  });

  // Direct pin of the `source_key = "${channelType}#${channelID}#${msgID}"`
  // format. The frontend rebuilds this string in module.tsx
  // (`checkDriveTransferred` and `flushBatch`) to look up each card's status.
  // If the backend ever changes the delimiter or field order, that lookup
  // silently returns null for every card and every saved file shows
  // "Save to Drive" forever, with no error / warning / failing test —
  // the silent-total-failure mode the reviewer flagged.
  it('imTransferredSourceKey pins `${channelType}#${channelID}#${msgID}` format', () => {
    expect(imTransferredSourceKey({
      im_channel_type: 2,
      im_group_no: 'g_abc',
      im_msg_id: '17012345678901234',
    })).toBe('2#g_abc#17012345678901234');

    // Sub-thread composite channelID uses '____' as separator, which never
    // collides with the source_key delimiter '#'.
    expect(imTransferredSourceKey({
      im_channel_type: 5,
      im_group_no: 'group_xyz____2084892300504207360',
      im_msg_id: '42',
    })).toBe('5#group_xyz____2084892300504207360#42');

    // Person (DM): channelType=1. The im_group_no here is expected to be
    // pre-normalised (bare peer uid, no Space prefix); see normaliseImChannelID.
    expect(imTransferredSourceKey({
      im_channel_type: 1,
      im_group_no: 'peer_uid_xyz',
      im_msg_id: '42',
    })).toBe('1#peer_uid_xyz#42');
  });

  it('normaliseImChannelID strips Space prefix only for Person channelType', () => {
    const prefixed = 's0a1b2c3d4e5f60718293a4b5c6d7e8f9_alice';
    const bare = 'alice';
    // Person (channelType=1): strip the s<32-hex>_ Space prefix so backends
    // that key on the bare uid (octo-server `GetFakeChannelIDWith`,
    // `AreSpaceMembers`, `IsFriend`) match.
    expect(normaliseImChannelID(1, prefixed)).toBe(bare);
    // No prefix -> no-op.
    expect(normaliseImChannelID(1, bare)).toBe(bare);
    // Group / CommunityTopic: pass through unchanged (backend accepts prefixed
    // IDs for those paths per Service/ChannelSettingService.ts).
    expect(normaliseImChannelID(2, 'group_abc')).toBe('group_abc');
    expect(normaliseImChannelID(5, 'group_xyz____2084892300504207360')).toBe('group_xyz____2084892300504207360');
    // Malformed / not-quite-prefix strings are left untouched.
    expect(normaliseImChannelID(1, 's_alice')).toBe('s_alice');
    expect(normaliseImChannelID(1, 'salice')).toBe('salice');
  });

  it('isDriveTransferSupportedChannel gates to Person/Group/CommunityTopic only', () => {
    // Supported: 1=Person, 2=Group, 5=CommunityTopic.
    expect(isDriveTransferSupportedChannel(1)).toBe(true);
    expect(isDriveTransferSupportedChannel(2)).toBe(true);
    expect(isDriveTransferSupportedChannel(5)).toBe(true);
    // Unsupported (must not render the icon or fire the query):
    // 3 = ChannelTypeCustomerService is a live channel type in this repo,
    // and any future addition must be opted-in explicitly.
    expect(isDriveTransferSupportedChannel(3)).toBe(false);
    expect(isDriveTransferSupportedChannel(0)).toBe(false);
    expect(isDriveTransferSupportedChannel(4)).toBe(false);
    expect(isDriveTransferSupportedChannel(6)).toBe(false);
    expect(isDriveTransferSupportedChannel(999)).toBe(false);
  });
});
