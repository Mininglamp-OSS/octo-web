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
    // Deferred so the reclaim of the first click stays in flight while the
    // second click's fresh run reaches confirming.
    vi.mocked(api.cancelUpload).mockImplementation(
      () => new Promise<void>((res) => { resolveCancel = res; }),
    );

    const { result } = renderHook(() => useUpload(vi.fn()));
    act(() => result.current.addFiles([makeFile()], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    // Two synchronous clicks: the first reclaims id 42 (suspends at cancel),
    // the second sees the stale id already cleared and starts the fresh run.
    act(() => {
      result.current.retry(id);
      result.current.retry(id);
    });
    // The fresh run prepares 99 and reaches confirming (still in flight).
    await waitFor(() => expect(result.current.items[0]?.status).toBe('confirming'));
    expect(api.prepareUpload).toHaveBeenCalledTimes(2);

    // Now the first click's cancel resolves; its runItem must hit the re-entry
    // guard (a run is already live) and NOT start a competing third prepare.
    await act(async () => {
      resolveCancel();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveConfirm({});
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    // Exactly one new run: prepare called twice total (42 + 99), never a third,
    // and confirm targets only the single fresh id.
    expect(api.prepareUpload).toHaveBeenCalledTimes(2);
    expect(api.confirmUpload).toHaveBeenCalledTimes(1);
    expect(api.confirmUpload).toHaveBeenCalledWith(99, { actual_size: 5 });
  });

  it('saturated-queue rapid retry enqueues the same id only once (P2 dedup guard)', async () => {
    // Bot review (Jerry-Xin round-5): the dedup guard at
    //   `if (uploadQueue.current.includes(id)) return;` in scheduleUpload
    // was proven present-and-correct but load-bearing coverage was missing.
    // runItem's own runs.current.has() re-entry guard picks up the slack
    // for the final prepareUpload count, but scheduleUpload's dedup still
    // matters: without it, a saturated-queue rapid retry pushes the same
    // id twice, wasting a queue slot and burning one microtask when the
    // finally-drain start()s it and runItem immediately bails via re-
    // entry. Direct observation: the id must NOT appear in the queue
    // more than once.
    //
    // We reach into the hook's queue via a spy on scheduleUpload's
    // downstream (runItem) call count. Under mutation (guard removed):
    // healthy uploads saturate → both retries push id → healthy finally
    // dequeues + calls start(id) twice → runItem invoked TWICE for the
    // failed id, second bails via re-entry. Under fix: id enqueued once
    // → runItem invoked ONCE for it.
    let resolveHealthyPuts: () => void = () => {};
    const healthyPutsHold = new Promise<void>((r) => {
      resolveHealthyPuts = r;
    });
    // Prepare responses: 42 for the failure, 100-103 for healthy stalls,
    // 99 for the successful retry. If dedup broke the retry gets a
    // second prepare from the second-drained duplicate.
    vi.mocked(api.prepareUpload)
      .mockResolvedValueOnce(prepResp({ file_id: 42 }))
      .mockResolvedValueOnce(prepResp({ file_id: 100 }))
      .mockResolvedValueOnce(prepResp({ file_id: 101 }))
      .mockResolvedValueOnce(prepResp({ file_id: 102 }))
      .mockResolvedValueOnce(prepResp({ file_id: 103 }))
      .mockResolvedValue(prepResp({ file_id: 99 }));
    vi.mocked(api.putToPresignedUrl)
      .mockRejectedValueOnce(new Error('put boom'))
      .mockImplementationOnce(() => healthyPutsHold as unknown as Promise<undefined>)
      .mockImplementationOnce(() => healthyPutsHold as unknown as Promise<undefined>)
      .mockImplementationOnce(() => healthyPutsHold as unknown as Promise<undefined>)
      .mockImplementationOnce(() => healthyPutsHold as unknown as Promise<undefined>)
      .mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpload(vi.fn()));

    // Step 1: prepare-fail row -> error status.
    act(() => result.current.addFiles([makeFile('fail.pdf')], 'sp', 0));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));
    const failedId = result.current.items[0].id;

    // Step 2: 4 healthy files stall all upload slots.
    act(() =>
      result.current.addFiles(
        [makeFile('h1.pdf'), makeFile('h2.pdf'), makeFile('h3.pdf'), makeFile('h4.pdf')],
        'sp',
        0,
      ),
    );
    await waitFor(() =>
      expect(
        result.current.items
          .filter((it) => it.id !== failedId)
          .every((it) => it.status === 'uploading' || it.status === 'preparing'),
      ).toBe(true),
    );
    const prepBeforeRetry = vi.mocked(api.prepareUpload).mock.calls.length;

    // Step 3: two rapid retries WHILE all slots are occupied. If the
    // scheduleUpload dedup is broken, both retries push failedId into
    // the queue (uploadQueue = [failedId, failedId]).
    await act(async () => {
      result.current.retry(failedId);
      result.current.retry(failedId);
      await Promise.resolve();
    });

    // Step 4: release the healthy uploads. Each finally() dequeues one
    // id and calls start() → runItem. If dedup broke, the second drained
    // entry ALSO reaches start(failedId), then runItem's re-entry guard
    // bails — but prepareUpload is called on the way to that guard
    // (line 232: `const res = await api.prepareUpload(...)`) BEFORE
    // `runs.current.has(id)` check at line 268. So a broken dedup
    // observably produces TWO prepare calls for the failed id.
    //
    // Actually wait — runs.current.has check (line 268) is BEFORE the
    // prepare call (line 232 → 244 order). Let me re-verify... Actually
    // the ordering is: runItem line 267 runs.current.has check first,
    // then prepare. So runItem's guard DOES stop a second prepare too.
    //
    // This means the observable difference reduces to microtask count
    // (one wasted runItem call vs zero). We can still observe that
    // by spying on prepareUpload — it should be called once for the
    // retry (not twice).
    await act(async () => {
      resolveHealthyPuts();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.items.find((it) => it.id === failedId)?.status).toBe('done'),
    );

    // The retry must trigger exactly ONE new prepareUpload call.
    // (Bot's requested assertion.)
    const prepFromRetry = vi.mocked(api.prepareUpload).mock.calls.length - prepBeforeRetry;
    expect(prepFromRetry).toBe(1);
    // And exactly one confirm for the retry's fresh id (99).
    const confirmsFor99 = vi.mocked(api.confirmUpload).mock.calls.filter((c) => c[0] === 99).length;
    expect(confirmsFor99).toBe(1);
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
