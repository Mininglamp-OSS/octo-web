import { vi, describe, it, expect, beforeEach } from 'vitest';
import React, { StrictMode, useEffect } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * React 18 StrictMode regression for the drive upload hook (PR #1202, I-1).
 *
 * The package's own useUpload.test.ts runs on the in-house react-dom@17 harness,
 * which never double-invokes effects — so it cannot catch a `mounted` ref that
 * is set false in cleanup but not re-armed in setup. The real app wraps its tree
 * in <React.StrictMode> on react@18 (apps/web/src/index.tsx), where dev runs
 * effects setup→cleanup→setup on the SAME hook instance (same refs). If the flag
 * is not re-armed, it stays false for the whole real lifetime and silently
 * suppresses every post-confirm refresh and stale-pending retry.
 *
 * This file runs in apps/web's react@18 vitest (its config aliases `react` to
 * react@18 across the whole graph, drive source included), wraps the hook in
 * <StrictMode>, and PROVES the double-invoke actually happens (setup counter
 * === 2) before asserting the behaviour. A plain unmount→remount would mint a
 * fresh ref and miss the bug; only cleanup→setup on one instance exercises it.
 *
 * Verified to fail against the pre-fix hook (mounted never re-armed): the
 * refresh assertion sees 0 calls and the retry never reaches 'done'.
 */

vi.mock('@octo/drive/src/api/driveApi', () => {
  class DriveApiError extends Error {
    code?: string;
    status?: number;
    constructor(message?: string, code?: string, status?: number) {
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

vi.mock('@octo/drive/src/utils/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@octo/base', () => ({ t: (k: string) => k }));

import * as api from '@octo/drive/src/api/driveApi';
import { useUpload } from '@octo/drive/src/hooks/useUpload';
import type { PrepareUploadResp } from '@octo/drive/src/bridge/types';

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

const StrictWrapper = ({ children }: { children: React.ReactNode }) => (
  <StrictMode>{children}</StrictMode>
);

beforeEach(() => {
  vi.mocked(api.prepareUpload).mockReset();
  vi.mocked(api.putToPresignedUrl).mockReset();
  vi.mocked(api.confirmUpload).mockReset();
  vi.mocked(api.cancelUpload).mockReset();
});

describe('useUpload under React 18 StrictMode (I-1)', () => {
  it('re-arms mounted across setup→cleanup→setup: a successful upload still refreshes', async () => {
    vi.mocked(api.prepareUpload).mockResolvedValue(prepResp());
    vi.mocked(api.putToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
    const onUploaded = vi.fn();

    // A sibling effect counts setups so we prove StrictMode really double-invokes
    // in this env — otherwise the behavioural assertion below would be vacuous.
    let setups = 0;
    const { result } = renderHook(
      () => {
        useEffect(() => {
          setups += 1;
        }, []);
        return useUpload(onUploaded);
      },
      { wrapper: StrictWrapper },
    );
    expect(setups).toBe(2);

    await act(async () => {
      result.current.addFiles([makeFile()], 'sp', 0);
    });
    await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));

    // With the bug (mounted stuck false after the StrictMode remount) refreshOnce
    // suppresses this — it would be 0.
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('re-arms mounted so a stale-pending retry re-prepares instead of bailing', async () => {
    vi.mocked(api.prepareUpload)
      .mockResolvedValueOnce(prepResp({ file_id: 42 }))
      .mockResolvedValueOnce(prepResp({ file_id: 99 }));
    vi.mocked(api.putToPresignedUrl)
      .mockRejectedValueOnce(new Error('put boom'))
      .mockResolvedValue(undefined);
    vi.mocked(api.confirmUpload).mockResolvedValue({} as never);
    vi.mocked(api.cancelUpload).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpload(vi.fn()), { wrapper: StrictWrapper });
    await act(async () => {
      result.current.addFiles([makeFile()], 'sp', 0);
    });
    await waitFor(() => expect(result.current.items[0]?.status).toBe('error'));

    const { id } = result.current.items[0];
    await act(async () => {
      result.current.retry(id);
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));

    // retryRun awaits bestEffortCancel(42); its post-await guard is
    // `!mounted.current || !jobs.has(id)`. With the bug (mounted false) it bails
    // here and never re-prepares — prepare would stay at 1 call and status never
    // reaches 'done'.
    expect(api.cancelUpload).toHaveBeenCalledWith(42);
    expect(api.prepareUpload).toHaveBeenCalledTimes(2);
    expect(api.confirmUpload).toHaveBeenCalledWith(99, { actual_size: 5 });
  });
});
