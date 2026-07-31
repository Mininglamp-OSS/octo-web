import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '../../__tests__/harness';

vi.mock('../../api/driveApi', () => {
  // Local DriveApiError so the hook's `instanceof` + status branching (409 →
  // "confirm won the race") works against the mocked module.
  class DriveApiError extends Error {
    code?: string;
    status?: number;
    constructor(message: string, code?: string, status?: number) {
      super(message);
      this.name = 'DriveApiError';
      this.code = code;
      this.status = status;
    }
  }
  return {
    DriveApiError,
    prepareUpload: vi.fn(),
    putToPresignedUrl: vi.fn(),
    confirmUpload: vi.fn(),
    cancelUpload: vi.fn(),
  };
});

vi.mock('../../utils/toast', () => ({ Toast: { success: vi.fn(), error: vi.fn() } }));

import * as api from '../../api/driveApi';
import { DriveApiError } from '../../api/driveApi';
import { Toast } from '../../utils/toast';
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
  vi.mocked(api.cancelUpload).mockReset();
  vi.mocked(Toast.error).mockReset();
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

  it('aborts an in-flight PUT when the row is dismissed, without flashing an error (B4)', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    // Simulate a long PUT that only settles when its abort signal fires (like
    // axios cancelling the request).
    vi.mocked(api.putToPresignedUrl).mockImplementation(
      (_url, _file, opts) =>
        new Promise<void>((_resolve, reject) => {
          capturedSignal = opts.signal;
          opts.signal?.addEventListener('abort', () => reject(new Error('canceled')));
        }),
    );
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);
    const onUploaded = vi.fn();

    const { result } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));

    const { id } = result.current.items[0];
    await act(async () => {
      result.current.dismiss(id);
      await Promise.resolve();
    });

    expect(capturedSignal?.aborted).toBe(true);
    // Row removed, upload never confirmed, and the cancel must NOT surface as an
    // error toast or an onUploaded refresh — but it MUST best-effort reclaim the
    // known pending file_id on the backend.
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(api.cancelUpload).toHaveBeenCalledWith(42);
    expect(api.confirmUpload).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it('cancelling while preparing best-effort cancels once file_id lands and never PUTs', async () => {
    let resolvePrep: (r: PrepareUploadResp) => void = () => {};
    vi.mocked(api.prepareUpload).mockImplementation(
      () => new Promise<PrepareUploadResp>((res) => { resolvePrep = res; }),
    );
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('preparing'));

    const { id } = result.current.items[0];
    // Cancel BEFORE prepare returns: no file_id yet, so the row leaves the UI
    // immediately and cancel is deferred to when prepare resolves.
    act(() => result.current.dismiss(id));
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(api.cancelUpload).not.toHaveBeenCalled();

    await act(async () => {
      resolvePrep(prepResp());
      await Promise.resolve();
    });

    // The PUT must never start; the pending record is best-effort cancelled.
    expect(api.putToPresignedUrl).not.toHaveBeenCalled();
    await waitFor(() => expect(api.cancelUpload).toHaveBeenCalledWith(42));
  });

  it('cancelling while confirming: a 409 (confirm won) refreshes to the confirmed file', async () => {
    let resolveConfirm: (b: unknown) => void = () => {};
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockImplementation(
      () => new Promise((res) => { resolveConfirm = res; }) as never,
    );
    vi.mocked(api.cancelUpload).mockRejectedValue(new DriveApiError('conflict', 'conflict', 409));
    const onUploaded = vi.fn();

    const { result } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('confirming'));

    const { id } = result.current.items[0];
    await act(async () => {
      result.current.dismiss(id);
      await Promise.resolve();
    });

    // Row removed immediately; cancel raced confirm on the known file_id.
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(api.cancelUpload).toHaveBeenCalledWith(42);

    // Confirm then wins → the file is really confirmed; the list refreshes to
    // reflect it (never re-adding a phantom row or claiming a cancellation).
    await act(async () => {
      resolveConfirm({});
      await Promise.resolve();
    });
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(result.current.items).toHaveLength(0);
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it('a failed cancel (network/5xx) never blocks UI removal or alarms the user', async () => {
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockImplementation(
      (_url, _file, opts) =>
        new Promise<void>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('canceled')));
        }),
    );
    vi.mocked(api.cancelUpload).mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));

    const { id } = result.current.items[0];
    await act(async () => {
      result.current.dismiss(id);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(api.cancelUpload).toHaveBeenCalledWith(42);
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it('unmount aborts the PUT and best-effort cancels a known pending file_id', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockImplementation(
      (_url, _file, opts) =>
        new Promise<void>((_resolve, reject) => {
          capturedSignal = opts.signal;
          opts.signal?.addEventListener('abort', () => reject(new Error('canceled')));
        }),
    );
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);

    const { result, unmount } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(api.cancelUpload).toHaveBeenCalledWith(42);
  });

  it('retry creates a fresh prepare (new file_id), not reusing the cancelled pending', async () => {
    vi.mocked(api.prepareUpload)
      .mockResolvedValueOnce(prepResp({ file_id: 42 }))
      .mockResolvedValueOnce(prepResp({ file_id: 99 }));
    vi.mocked(api.putToPresignedUrl).mockRejectedValueOnce(new Error('put boom'));
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    act(() => result.current.retry(id));
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    // Second prepare produced a fresh file_id; confirm targets that new id.
    expect(api.prepareUpload).toHaveBeenCalledTimes(2);
    expect(api.confirmUpload).toHaveBeenCalledWith(99, { actual_size: 5 });
  });
});
