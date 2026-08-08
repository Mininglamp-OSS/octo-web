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

  it('confirm-wins race refreshes exactly once — confirm completes, then cancel 409', async () => {
    let resolveConfirm: (b: unknown) => void = () => {};
    let rejectCancel: (e: unknown) => void = () => {};
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockImplementation(
      () => new Promise((res) => { resolveConfirm = res; }) as never,
    );
    vi.mocked(api.cancelUpload).mockImplementation(
      () => new Promise((_res, rej) => { rejectCancel = rej; }),
    );
    const onUploaded = vi.fn();

    const { result } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('confirming'));

    const { id } = result.current.items[0];
    await act(async () => {
      result.current.dismiss(id);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(api.cancelUpload).toHaveBeenCalledWith(42);

    // Confirm resolves FIRST → runItem's cancelled branch refreshes.
    await act(async () => {
      resolveConfirm({});
      await Promise.resolve();
      await Promise.resolve();
    });
    // Then the cancel 409 lands — its refresh must be deduped by the run.
    await act(async () => {
      rejectCancel(new DriveApiError('conflict', 'conflict', 409));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(result.current.items).toHaveLength(0);
    expect(Toast.error).not.toHaveBeenCalled();
  });

  it('confirm-wins race refreshes exactly once — cancel 409 first, then confirm completes', async () => {
    let resolveConfirm: (b: unknown) => void = () => {};
    let rejectCancel: (e: unknown) => void = () => {};
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockImplementation(
      () => new Promise((res) => { resolveConfirm = res; }) as never,
    );
    vi.mocked(api.cancelUpload).mockImplementation(
      () => new Promise((_res, rej) => { rejectCancel = rej; }),
    );
    const onUploaded = vi.fn();

    const { result } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('confirming'));

    const { id } = result.current.items[0];
    await act(async () => {
      result.current.dismiss(id);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(api.cancelUpload).toHaveBeenCalledWith(42);

    // Cancel 409 lands FIRST → bestEffortCancel refreshes.
    await act(async () => {
      rejectCancel(new DriveApiError('conflict', 'conflict', 409));
      await Promise.resolve();
      await Promise.resolve();
    });
    // Then confirm resolves — runItem's cancelled branch must not refresh again.
    await act(async () => {
      resolveConfirm({});
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onUploaded).toHaveBeenCalledTimes(1);
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

  it('a PUT-failed error row retains its pending id, and dismiss reclaims it', async () => {
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp({ file_id: 42 }));
    vi.mocked(api.putToPresignedUrl).mockRejectedValue(new Error('put boom'));
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    // The failed run must NOT have cancelled yet — the id is held on the Job so
    // a later dismiss/retry can still reclaim the leaked pending record.
    expect(api.cancelUpload).not.toHaveBeenCalled();

    const { id } = result.current.items[0];
    await act(async () => {
      result.current.dismiss(id);
      await Promise.resolve();
    });

    expect(api.cancelUpload).toHaveBeenCalledWith(42);
    await waitFor(() => expect(result.current.items).toHaveLength(0));
  });

  it('retry reclaims the stale pending id BEFORE re-preparing a fresh one', async () => {
    vi.mocked(api.prepareUpload)
      .mockResolvedValueOnce(prepResp({ file_id: 42 }))
      .mockResolvedValueOnce(prepResp({ file_id: 99 }));
    vi.mocked(api.putToPresignedUrl)
      .mockRejectedValueOnce(new Error('put boom'))
      .mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    act(() => result.current.retry(id));
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    // Stale id reclaimed, and the reclaim happened before the second prepare.
    expect(api.cancelUpload).toHaveBeenCalledWith(42);
    expect(api.prepareUpload).toHaveBeenCalledTimes(2);
    const cancelOrder = vi.mocked(api.cancelUpload).mock.invocationCallOrder[0];
    const reprepareOrder = vi.mocked(api.prepareUpload).mock.invocationCallOrder[1];
    expect(cancelOrder).toBeLessThan(reprepareOrder);
    // Confirm targets the FRESH id, never the reclaimed one.
    expect(api.confirmUpload).toHaveBeenCalledWith(99, { actual_size: 5 });
  });

  it('retry cleanup 409 (old run already confirmed) aborts retry, drops the row, refreshes once', async () => {
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp({ file_id: 42 }));
    vi.mocked(api.putToPresignedUrl).mockRejectedValue(new Error('put boom'));
    vi.mocked(api.cancelUpload).mockRejectedValue(new DriveApiError('conflict', 'conflict', 409));
    const onUploaded = vi.fn();

    const { result } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    await act(async () => {
      result.current.retry(id);
      await Promise.resolve();
      await Promise.resolve();
    });

    // 409 => the old run really confirmed: no second prepare (would duplicate
    // the file), row removed, real list refreshed exactly once.
    expect(api.prepareUpload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('retry survives a non-409 cancel failure: re-prepares a fresh id, never reuses the old, no id in the warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.mocked(api.prepareUpload)
        .mockResolvedValueOnce(prepResp({ file_id: 42 }))
        .mockResolvedValueOnce(prepResp({ file_id: 99 }));
      vi.mocked(api.putToPresignedUrl)
        .mockRejectedValueOnce(new Error('put boom'))
        .mockResolvedValue(undefined);
      vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
      vi.mocked(api.cancelUpload).mockRejectedValue(new Error('network down'));

      const { result } = renderHook(() => useUpload(vi.fn()));
      act(() => result.current.addFiles([makeFile()], 'sp', 0));
      await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

      const { id } = result.current.items[0];
      act(() => result.current.retry(id));
      await waitFor(() => expect(result.current.items[0].status).toBe('done'));

      expect(api.cancelUpload).toHaveBeenCalledWith(42);
      expect(api.prepareUpload).toHaveBeenCalledTimes(2);
      // Fresh id used, the failed-cancel old id (42) is never reused.
      expect(api.confirmUpload).toHaveBeenCalledWith(99, { actual_size: 5 });
      // The breadcrumb must not leak the file id / name / url / token.
      expect(warn).toHaveBeenCalled();
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain('cancel-upload failed');
      expect(line).toContain('kind=');
      expect(line).not.toContain('42');
      expect(line).not.toContain('a.pdf');
      expect(line.toLowerCase()).not.toContain('http');
      expect(line.toLowerCase()).not.toContain('token');
    } finally {
      warn.mockRestore();
    }
  });

  it('unmount during confirming does not refresh when confirm later resolves', async () => {
    let resolveConfirm: (b: unknown) => void = () => {};
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockImplementation(
      () => new Promise((res) => { resolveConfirm = res; }) as never,
    );
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);
    const onUploaded = vi.fn();

    const { result, unmount } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('confirming'));

    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    // Confirm resolves AFTER unmount — the cancelled + unmounted run must stay silent.
    await act(async () => {
      resolveConfirm({});
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onUploaded).not.toHaveBeenCalled();
    // Unmount still fire-and-forget reclaims the known pending id.
    expect(api.cancelUpload).toHaveBeenCalledWith(42);
  });

  it('unmount then a cancel-409 does not refresh', async () => {
    let rejectCancel: (e: unknown) => void = () => {};
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockImplementation(
      (_url, _file, opts) =>
        new Promise<void>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('canceled')));
        }),
    );
    vi.mocked(api.cancelUpload).mockImplementation(
      () => new Promise((_res, rej) => { rejectCancel = rej; }),
    );
    const onUploaded = vi.fn();

    const { result, unmount } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('uploading'));

    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    // A 409 landing after unmount (confirm won) must not refresh a dead component.
    await act(async () => {
      rejectCancel(new DriveApiError('conflict', 'conflict', 409));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('terminal-error row unmount reclaims the retained pending id (P1-1)', async () => {
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp({ file_id: 42 }));
    vi.mocked(api.putToPresignedUrl).mockRejectedValue(new Error('put boom'));
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);

    const { result, unmount } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    // Held, not cancelled yet — the id lives on the Job for a later reclaim.
    expect(api.cancelUpload).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    // Leaving the page directly must reclaim the retained pending id even though
    // no live RunCtl exists for the error row.
    expect(api.cancelUpload).toHaveBeenCalledWith(42);
    expect(api.cancelUpload).toHaveBeenCalledTimes(1);
  });

  it('retry awaiting cancel then unmount: bails with no re-prepare, stale id cancelled once (P1-2/3)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let resolveCancel: () => void = () => {};
      vi.mocked(api.prepareUpload).mockResolvedValue(prepResp({ file_id: 42 }));
      vi.mocked(api.putToPresignedUrl).mockRejectedValue(new Error('put boom'));
      vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
      vi.mocked(api.cancelUpload).mockImplementation(
        () => new Promise<void>((res) => { resolveCancel = res; }),
      );

      const { result, unmount } = renderHook(() => useUpload(vi.fn()));
      act(() => result.current.addFiles([makeFile()], 'sp', 0));
      await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

      const { id } = result.current.items[0];
      // retry reclaims stale id 42 and suspends at the cancel await.
      act(() => result.current.retry(id));
      await waitFor(() => expect(api.cancelUpload).toHaveBeenCalledWith(42));

      // Unmount while the retry is still awaiting the cancel.
      await act(async () => {
        unmount();
        await Promise.resolve();
      });
      // Cancel resolves AFTER unmount — retryRun must bail before re-preparing.
      await act(async () => {
        resolveCancel();
        await Promise.resolve();
        await Promise.resolve();
      });

      // No second run, no confirm, and the stale id was cancelled exactly once
      // (retryRun cleared it up-front so unmount cleanup didn't re-cancel it).
      expect(api.prepareUpload).toHaveBeenCalledTimes(1);
      expect(api.putToPresignedUrl).toHaveBeenCalledTimes(1);
      expect(api.confirmUpload).not.toHaveBeenCalled();
      expect(api.cancelUpload).toHaveBeenCalledTimes(1);
      // No setState-after-unmount warning slipped through.
      const warned = err.mock.calls.some((c) => String(c[0]).includes('unmount'));
      expect(warned).toBe(false);
    } finally {
      err.mockRestore();
    }
  });

  it('retry awaiting cancel, unmount, then cancel-409: no setItems/refresh after unmount (P1-2)', async () => {
    let rejectCancel: (e: unknown) => void = () => {};
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp({ file_id: 42 }));
    vi.mocked(api.putToPresignedUrl).mockRejectedValue(new Error('put boom'));
    vi.mocked(api.cancelUpload).mockImplementation(
      () => new Promise((_res, rej) => { rejectCancel = rej; }),
    );
    const onUploaded = vi.fn();

    const { result, unmount } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    act(() => result.current.retry(id));
    await waitFor(() => expect(api.cancelUpload).toHaveBeenCalledWith(42));

    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    // 409 = the old run actually confirmed. retryRun's confirmWon branch would
    // otherwise delete the row + refresh — but after unmount the post-await
    // guard must bail before any setItems / onUploaded on a dead component.
    await act(async () => {
      rejectCancel(new DriveApiError('conflict', 'conflict', 409));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('concurrent (double-click) retry starts only one new run (P1-4)', async () => {
    // Two synchronous Retry clicks on a prepare-failed row. The first
    // reclaims id 42 and awaits cancel. The second is BLOCKED by the
    // retriesInFlight guard (added in round-6 to fix the cancel-409
    // double-confirm race — see the 'rapid retry + cancel-409' test
    // below). Only the first click drives the fresh run once cancel
    // resolves. Net: exactly one new run, one confirm on id 99.
    let resolveCancel: () => void = () => {};
    let resolveConfirm: (b: unknown) => void = () => {};
    vi.mocked(api.prepareUpload)
      .mockResolvedValueOnce(prepResp({ file_id: 42 }))
      .mockResolvedValue(prepResp({ file_id: 99 }));
    vi.mocked(api.putToPresignedUrl)
      .mockRejectedValueOnce(new Error('put boom'))
      .mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockImplementation(
      () => new Promise((res) => { resolveConfirm = res; }) as never,
    );
    // Deferred so the reclaim of the first click stays in flight while
    // the second click hits the retriesInFlight guard and no-ops.
    vi.mocked(api.cancelUpload).mockImplementation(
      () => new Promise<void>((res) => { resolveCancel = res; }),
    );

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    // Two synchronous clicks: the first reclaims id 42 (suspends at
    // cancel), the second is no-op due to retriesInFlight guard.
    act(() => {
      result.current.retry(id);
      result.current.retry(id);
    });
    // No new run yet — first click is still awaiting cancel, second is
    // gated. Only prepare 42 has been called (the initial failed run).
    expect(api.prepareUpload).toHaveBeenCalledTimes(1);
    // Row is 'preparing' because retryRun patched it before awaiting.
    expect(result.current.items[0]?.status).toBe('preparing');

    // Cancel resolves successfully (no confirmWon). First click continues
    // and calls scheduleUpload → prepare 99 → PUT → confirm.
    await act(async () => {
      resolveCancel();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items[0]?.status).toBe('confirming'));
    expect(api.prepareUpload).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveConfirm({});
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    // Exactly one new run: prepare called twice total (42 + 99), never a
    // third, and confirm targets only the single fresh id.
    expect(api.prepareUpload).toHaveBeenCalledTimes(2);
    expect(api.confirmUpload).toHaveBeenCalledTimes(1);
    expect(api.confirmUpload).toHaveBeenCalledWith(99, { actual_size: 5 });
  });

  it('rapid retry + cancel-409 must not double-confirm (P1 · silent double-write)', async () => {
    // Bot review lml2468 round-6: two synchronous Retry clicks where the
    // FIRST cleanup returns 409 (old id already confirmed on server) would
    // silently upload the file TWICE. The first Retry cleared pendingFileId,
    // yielded on await cancelUpload(42). The second Retry saw runs empty
    // and pendingFileId undefined → straight to scheduleUpload → prepare
    // 99 + PUT + confirm 99. Then cancel(42) resolves with 409, first
    // Retry runs confirmWon branch: deletes the row and refreshes. Net:
    // server has 42 AND 99 confirmed but only one row was ever on screen.
    //
    // Fix: retriesInFlight Set ref guards retryRun so a rapid second call
    // for the same id no-ops while cleanup is still awaited.
    let resolveCancel: (v: unknown) => void = () => {};
    vi.mocked(api.prepareUpload)
      .mockResolvedValueOnce(prepResp({ file_id: 42 }))
      .mockResolvedValue(prepResp({ file_id: 99 }));
    vi.mocked(api.putToPresignedUrl)
      .mockRejectedValueOnce(new Error('put boom'))
      .mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
    // Deferred so we can control 409 arrival timing.
    vi.mocked(api.cancelUpload).mockImplementation(
      () =>
        new Promise((_res, rej) => {
          resolveCancel = rej;
        }),
    );
    const onUploaded = vi.fn();

    const { result } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    const { id } = result.current.items[0];

    // Two synchronous Retry clicks. First reclaims id 42 (suspends at
    // cancel await). WITHOUT the fix, second click bypasses the retry
    // gate (runs.has=false, pendingFileId=undefined) and starts a fresh
    // run → prepares 99 → PUT succeeds → confirms 99.
    // WITH the fix, second click hits retriesInFlight.has(id) === true
    // and no-ops.
    act(() => {
      result.current.retry(id);
      result.current.retry(id);
    });

    // Now resolve the first click's cancel with 409 (confirm won on
    // server). First click sees confirmWon → delete row + refresh.
    await act(async () => {
      resolveCancel(new DriveApiError('conflict', 'conflict', 409));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Row was removed by first click's confirmWon branch.
    await waitFor(() => expect(result.current.items).toHaveLength(0));
    // Exactly one refresh (the confirmWon branch), NOT a second one from
    // a competing run.
    expect(onUploaded).toHaveBeenCalledTimes(1);

    // Critical invariant: confirmUpload must NEVER have been called.
    // Under the bug it would have been called with (99). With the fix,
    // the second Retry never started a fresh run, so no confirm at all.
    expect(api.confirmUpload).not.toHaveBeenCalled();
    // And prepareUpload was called exactly once (the initial addFiles
    // attempt), not twice.
    expect(api.prepareUpload).toHaveBeenCalledTimes(1);
  });

  it('prepare-fail + saturated queue + sequential retry: no duplicate upload (P1 dedup guard)', async () => {
    // Bot review Jerry-Xin round-6: after retriesInFlight landed, the
    // scheduleUpload includes-guard was removed as apparently redundant.
    // Jerry-Xin proved it wasn't — for the prepare-failure retry path
    // ONLY (PUT-failure works). The failing walk:
    //
    // 1. Row fails during prepareUpload → pendingFileId never set.
    // 2. 4 healthy uploads saturate MAX_CONCURRENT_UPLOADS (4).
    // 3. First Retry: retryRun takes stalePending===undefined branch
    //    (no await), calls scheduleUpload(id) SYNCHRONOUSLY, then
    //    finally clears retriesInFlight in the SAME tick.
    // 4. Second synchronous Retry: retriesInFlight.has(id) === false
    //    (just cleared). Falls through to scheduleUpload → id is
    //    already in queue, but without the includes-guard it gets
    //    pushed AGAIN → queue = [id, id].
    // 5. Slots drain one at a time (sequential drain). First entry's
    //    runItem completes → finally deletes runs[id] → shift pulls
    //    the second entry → runs.has(id)===false → full prepare + PUT
    //    + confirm on a SECOND file id. Server: two copies. UI: one row.
    //
    // Fix: restore `if (uploadQueue.current.includes(id)) return;` in
    // scheduleUpload. This test measures the sequential-drain case
    // directly with ONE hold-promise per stalled slot so each finally
    // fires in its own microtask.
    const holds: Array<() => void> = [];
    const makeHold = () =>
      new Promise<undefined>((r) => {
        holds.push(() => r(undefined));
      });

    // Prepare responses: id 42 for the initial prepare-fail attempt
    // (fails), then 100-103 for the four healthy files, then 99 for
    // the retry. If the guard is broken, the SEQUENTIAL second drain
    // re-prepares with the next id (98) — that's the tell-tale.
    vi.mocked(api.prepareUpload)
      .mockRejectedValueOnce(new Error('prepare boom'))
      .mockResolvedValueOnce(prepResp({ file_id: 100 }))
      .mockResolvedValueOnce(prepResp({ file_id: 101 }))
      .mockResolvedValueOnce(prepResp({ file_id: 102 }))
      .mockResolvedValueOnce(prepResp({ file_id: 103 }))
      .mockResolvedValueOnce(prepResp({ file_id: 99 }))
      .mockResolvedValueOnce(prepResp({ file_id: 98 }))
      .mockResolvedValue(prepResp({ file_id: 97 }));
    vi.mocked(api.putToPresignedUrl)
      // Each healthy upload holds on ITS OWN promise so slots drain
      // one at a time when released.
      .mockImplementationOnce(() => makeHold())
      .mockImplementationOnce(() => makeHold())
      .mockImplementationOnce(() => makeHold())
      .mockImplementationOnce(() => makeHold())
      // Retry's PUT (once it starts) succeeds immediately.
      .mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpload(vi.fn()));

    // Step 1: prepare-fail row -> error status, no pendingFileId.
    act(() => result.current.addFiles([makeFile('fail.pdf')], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    const failedId = result.current.items[0].id;

    // Step 2: 4 healthy files, each pinned on its own hold, saturate
    // the concurrency cap.
    act(() =>
      result.current.addFiles(
        [makeFile('h1.pdf'), makeFile('h2.pdf'), makeFile('h3.pdf'), makeFile('h4.pdf')],
        'sp',
        0,
      ),
    );
    await waitFor(() => expect(holds.length).toBe(4));
    const prepBeforeRetry = vi.mocked(api.prepareUpload).mock.calls.length;

    // Step 3: two synchronous Retry clicks. This is the exact scenario
    // Jerry-Xin flagged: prepare-failure path doesn't await, so
    // retriesInFlight is cleared before the second click checks it.
    await act(async () => {
      result.current.retry(failedId);
      result.current.retry(failedId);
      await Promise.resolve();
    });

    // Step 4: release ONE slot. First entry drains, its runItem runs to
    // done (prepare 99 → PUT → confirm), then its .finally shifts the
    // next queue entry — which is the DUPLICATE failedId if the guard
    // is missing.
    await act(async () => {
      holds[0]!();
      // Drain enough microtasks for the retry run to complete AND for
      // its finally to attempt draining the (potentially duplicated)
      // queue entry.
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.items.find((it) => it.id === failedId)?.status).toBe('done'),
    );

    // With the guard: prepareUpload for the retry was called ONCE (99).
    // Without: TWICE (99 + 98) — a duplicate file uploaded.
    const prepFromRetry = vi.mocked(api.prepareUpload).mock.calls.length - prepBeforeRetry;
    expect(prepFromRetry).toBe(1);
    // confirmUpload called with 99 exactly once, NEVER with 98.
    const confirmIds = vi.mocked(api.confirmUpload).mock.calls.map((c) => c[0]);
    expect(confirmIds.filter((x) => x === 99)).toHaveLength(1);
    expect(confirmIds).not.toContain(98);

    // Cleanup: release remaining healthy holds so the test doesn't leak.
    holds.slice(1).forEach((r) => r());
  });

  it('terminal-error dismiss, then unmount, then cancel-409: no refresh (mounted guard)', async () => {
    let rejectCancel: (e: unknown) => void = () => {};
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp({ file_id: 42 }));
    vi.mocked(api.putToPresignedUrl).mockRejectedValue(new Error('put boom'));
    vi.mocked(api.cancelUpload).mockImplementation(
      () => new Promise((_res, rej) => { rejectCancel = rej; }),
    );
    const onUploaded = vi.fn();

    const { result, unmount } = renderHook(() => useUpload(onUploaded));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    // Dismiss the error row: reclaims id 42 (cancel in flight), row removed.
    await act(async () => {
      result.current.dismiss(id);
      await Promise.resolve();
    });
    expect(api.cancelUpload).toHaveBeenCalledWith(42);

    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    // The 409 (confirm won) lands after unmount — its refresh must be suppressed
    // by the mounted guard rather than refreshing a dead component.
    await act(async () => {
      rejectCancel(new DriveApiError('conflict', 'conflict', 409));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onUploaded).not.toHaveBeenCalled();
  });
});
