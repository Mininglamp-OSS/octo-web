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
import { WKApp } from '@octo/base';
import * as driveApi from '../driveApi';
import { DriveApiError, assertSafeUploadURL, putToPresignedUrl } from '../driveApi';

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

  it('accessShareByToken hits the public route, omitting body when no password', async () => {
    inst.post.mockResolvedValue(ok({ file_id: 1 }));
    await driveApi.accessShareByToken('tok');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/public/shares/tok/access', undefined);
    await driveApi.accessShareByToken('tok', 'pw');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/public/shares/tok/access', { password: 'pw' });
  });

  it('downloadShareByToken POSTs the public download route, omitting body when no password', async () => {
    inst.post.mockResolvedValue(ok({ url: 'https://s/dl', filename: 'a.txt', content_type: 'text/plain' }));
    const res = await driveApi.downloadShareByToken('tok');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/public/shares/tok/download', undefined);
    expect(res.url).toBe('https://s/dl');
    await driveApi.downloadShareByToken('tok', 'pw');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/public/shares/tok/download', { password: 'pw' });
  });

  it('acceptInvite POSTs /invites/:token/accept', async () => {
    inst.post.mockResolvedValue(ok({ space_id: 's1', role: 'editor', already_member: false }));
    await driveApi.acceptInvite('tok');
    expect(inst.post).toHaveBeenCalledWith('/v1/drive/invites/tok/accept', undefined);
  });

  it('searchOrgUser GETs /org/search with an empty q to list team members', async () => {
    inst.get.mockResolvedValue(ok({ candidates: [{ uid: 'u1' }, { uid: 'u2' }], total: 2 }));
    const res = await driveApi.searchOrgUser({ q: '   ' });
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/org/search', {
      params: { q: '   ' },
    });
    expect(res.total).toBe(2);
  });

  it('searchOrgUser GETs /org/search for a non-empty query', async () => {
    inst.get.mockResolvedValue(ok({ candidates: [{ uid: 'u1' }], total: 1 }));
    const res = await driveApi.searchOrgUser({ q: 'bob', limit: 20 });
    expect(inst.get).toHaveBeenCalledWith('/v1/drive/org/search', {
      params: { q: 'bob', limit: '20' },
    });
    expect(res.total).toBe(1);
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
  it('injects token + X-Space-Id + Accept-Language at request time', () => {
    const requestUse = inst.interceptors.request.use as ReturnType<typeof vi.fn>;
    const onRequest = requestUse.mock.calls[0][0];
    const config = onRequest({ headers: {} });
    expect(config.headers.token).toBe('test-token-abc');
    expect(config.headers['X-Space-Id']).toBe('space-123');
    expect(config.headers['Accept-Language']).toBeTruthy();
  });

  it('logs out on 401', async () => {
    const logout = vi.spyOn(WKApp.shared, 'logout');
    const responseUse = inst.interceptors.response.use as ReturnType<typeof vi.fn>;
    const onError = responseUse.mock.calls[0][1];
    await expect(onError({ response: { status: 401 } })).rejects.toBeDefined();
    expect(logout).toHaveBeenCalled();
    logout.mockRestore();
  });
});

describe('assertSafeUploadURL', () => {
  it('accepts https', () => {
    expect(() => assertSafeUploadURL('https://storage.example.com/x')).not.toThrow();
  });
  it('accepts http on localhost', () => {
    expect(() => assertSafeUploadURL('http://localhost:9000/x')).not.toThrow();
    expect(() => assertSafeUploadURL('http://127.0.0.1:9000/x')).not.toThrow();
  });
  it('rejects http on a remote host', () => {
    expect(() => assertSafeUploadURL('http://evil.example.com/x')).toThrow(DriveApiError);
  });
  it('rejects a non-URL', () => {
    expect(() => assertSafeUploadURL('not a url')).toThrow(DriveApiError);
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
  });

  it('refuses an unsafe URL and never PUTs', async () => {
    await expect(
      putToPresignedUrl('http://evil.example.com/obj', new Blob(['x']), { contentType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'unsafe_upload_url' });
    expect(inst.put).not.toHaveBeenCalled();
  });

  it('throws when storage returns a non-2xx status', async () => {
    inst.put.mockResolvedValue({ status: 403 });
    await expect(
      putToPresignedUrl('https://storage.example.com/obj', new Blob(['x']), { contentType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'upload_failed' });
  });
});
