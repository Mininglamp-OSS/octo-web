import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => ({
  prepareUpload: vi.fn(),
  putToPresignedUrl: vi.fn(),
  confirmUpload: vi.fn(),
}));

import * as api from '../../api/driveApi';
import { useUpload } from '../useUpload';
import type { PrepareUploadResp } from '../../bridge/types';

function makeFile(name = 'a.pdf', body = 'hello', type = 'application/pdf'): File {
  return new File([body], name, { type });
}

function prepResp(over: Partial<PrepareUploadResp> = {}): PrepareUploadResp {
  return {
    file_id: 42,
    status: 'pending',
    upload_url: 'https://storage.example.com/presigned-put',
    object_path: 'sp/2026/a.pdf',
    content_type: 'application/pdf',
    max_file_size: 5,
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(api.prepareUpload).mockReset();
  vi.mocked(api.putToPresignedUrl).mockReset();
  vi.mocked(api.confirmUpload).mockReset();
});

describe('useUpload', () => {
  it('runs prepare → put → confirm and reports done + refresh', async () => {
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockImplementation(async (_url, _file, opts) => {
      opts.onProgress?.(40);
      opts.onProgress?.(100);
    });
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
    const onUploaded = vi.fn();

    const { result } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));

    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));

    expect(api.prepareUpload).toHaveBeenCalledWith({
      space_id: 'sp',
      parent_id: 0,
      name: 'a.pdf',
      size: 5,
      content_type: 'application/pdf',
    });
    expect(api.putToPresignedUrl).toHaveBeenCalledWith(
      'https://storage.example.com/presigned-put',
      expect.any(File),
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
    expect(api.confirmUpload).toHaveBeenCalledWith(42, { actual_size: 5 });
    expect(result.current.items[0].progress).toBe(100);
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('advances progress while uploading', async () => {
    let report: (p: number) => void = () => {};
    let finishPut: () => void = () => {};
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockImplementation(
      (_url, _file, opts) =>
        new Promise<void>((resolve) => {
          report = opts.onProgress!;
          finishPut = resolve;
        }),
    );
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));

    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));
    act(() => report(55));
    await waitFor(() => expect(result.current.items[0].progress).toBe(55));

    act(() => finishPut());
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));
  });

  it('stops at prepare failure without touching storage', async () => {
    vi.mocked(api.prepareUpload).mockRejectedValue(new Error('prep boom'));

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));

    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    expect(result.current.items[0].error).toBe('prep boom');
    expect(api.putToPresignedUrl).not.toHaveBeenCalled();
    expect(api.confirmUpload).not.toHaveBeenCalled();
  });

  it('stops at put failure without confirming', async () => {
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockRejectedValue(new Error('put boom'));

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));

    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    expect(result.current.items[0].error).toBe('put boom');
    expect(api.confirmUpload).not.toHaveBeenCalled();
  });

  it('surfaces confirm failure and skips refresh', async () => {
    const onUploaded = vi.fn();
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockRejectedValue(new Error('confirm boom'));

    const { result } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));

    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    expect(result.current.items[0].error).toBe('confirm boom');
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('retries a failed item through the full flow', async () => {
    vi.mocked(api.prepareUpload)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    act(() => result.current.retry(id));
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    expect(api.prepareUpload).toHaveBeenCalledTimes(2);
    expect(api.confirmUpload).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses a done row after the delay', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
      vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
      vi.mocked(api.confirmUpload).mockResolvedValue({} as never);

      const { result } = renderHook(() => useUpload(vi.fn()));
      // advanceTimersByTimeAsync(1) drains the prepare→put→confirm microtask
      // chain (it has no timers) without firing the 2.5s auto-dismiss yet.
      await act(async () => {
        result.current.addFiles([makeFile()], 'sp', 0);
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.items[0]?.status).toBe('done');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.items).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an error row (no auto-dismiss) so it stays retryable', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.prepareUpload).mockRejectedValue(new Error('prep boom'));

      const { result } = renderHook(() => useUpload(vi.fn()));
      await act(async () => {
        result.current.addFiles([makeFile()], 'sp', 0);
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.items[0]?.status).toBe('error');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(result.current.items[0]?.status).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes bytes only through the isolated putToPresignedUrl primitive (M-3)', async () => {
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp({ upload_url: 'https://s3.example.com/safe' }));
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));

    // The only channel touching object storage is putToPresignedUrl — which
    // (per driveApi) uses a fresh interceptor-free axios so no session token
    // crosses the storage origin. The hook must not smuggle auth into the PUT:
    // its opts carry only content headers + progress/abort, never token/headers.
    expect(api.putToPresignedUrl).toHaveBeenCalledTimes(1);
    const [url, , opts] = vi.mocked(api.putToPresignedUrl).mock.calls[0];
    expect(url).toBe('https://s3.example.com/safe');
    const allowed = ['contentType', 'contentDisposition', 'onProgress', 'signal'];
    expect(Object.keys(opts).every((k) => allowed.includes(k))).toBe(true);
    expect(JSON.stringify(opts)).not.toContain('token');
  });
});
