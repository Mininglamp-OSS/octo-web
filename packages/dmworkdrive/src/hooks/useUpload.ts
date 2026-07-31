import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
import { DriveApiError } from '../api/driveApi';
import { Toast } from '../utils/toast';

export type UploadStatus = 'preparing' | 'uploading' | 'confirming' | 'done' | 'error';

/** A single in-flight (or finished) upload, as shown in the progress panel. */
export interface UploadItem {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0–100, meaningful while `status === 'uploading'`. */
  progress: number;
  error?: string;
}

export interface UseUpload {
  items: UploadItem[];
  /** Queue files for upload into the given space/folder; each runs independently. */
  addFiles: (files: FileList | File[], spaceId: string, parentId: number) => void;
  /** Restart a failed item's full flow (presigned URLs expire, so we re-prepare). */
  retry: (id: string) => void;
  /** Drop a finished/failed item from the panel. */
  dismiss: (id: string) => void;
}

let seq = 0;
const nextId = (): string => `u${(seq += 1)}`;

/** Delay before a successfully finished row auto-removes itself from the panel. */
const AUTO_DISMISS_MS = 2500;

/** Retry-time job context kept out of React state (file + target never change). */
interface Job {
  file: File;
  spaceId: string;
  parentId: number;
}

type RunPhase = 'preparing' | 'uploading' | 'confirming' | 'settled';

/**
 * Per-run control record kept in a ref (not React state): the cancel path reads
 * and mutates it synchronously across the prepare→PUT→confirm await points, and
 * it must not trigger re-renders. One live record per in-flight item id; the run
 * deletes it in `finally`, so its presence == "a run is still in flight".
 */
interface RunCtl {
  /** Aborts the in-flight PUT (the only step wired to a signal). */
  controller: AbortController;
  phase: RunPhase;
  /** Set once prepareUpload returns; undefined while prepare is still in flight. */
  fileId?: number;
  /** User asked to cancel; the run bails at the next checkpoint. */
  cancelled: boolean;
}

/**
 * Type-2 upload state machine (spec §4.2) with best-effort pending cleanup on
 * cancel (spec §2 D-3).
 *
 * Composes the three audited driveApi primitives — prepareUpload →
 * putToPresignedUrl → confirmUpload — into a per-file state machine with
 * progress and per-step retry. The direct-to-storage PUT MUST go through
 * `putToPresignedUrl` (M-3): it owns the interceptor-free axios instance and
 * URL safety check, so no session token ever crosses the storage origin. This
 * hook only orchestrates state; it never touches storage directly.
 *
 * Cancel is race-aware. Because prepare/confirm have no abort signal, cancel is
 * expressed as a `cancelled` flag on the run's RunCtl plus checkpoints in the
 * flow, rather than by aborting every request:
 *   - cancel while preparing: no file_id yet, so the flow best-effort cancels
 *     once prepare returns and never starts the PUT;
 *   - cancel while uploading: abort the PUT and best-effort cancel the file_id;
 *   - cancel while confirming: best-effort cancel races confirm — a 409 means
 *     confirm won, so we refresh to show the confirmed file instead of pretending
 *     it was cancelled (never deleting a confirmed row).
 * A failed cancel (network/5xx) is swallowed: the backend's confirmed-only read
 * filter is the final safety net, so a pending record never surfaces regardless.
 *
 * @param onUploaded Invoked after each file is confirmed, so the caller can
 *   refresh the file list.
 */
export function useUpload(onUploaded: () => void): UseUpload {
  const [items, setItems] = useState<UploadItem[]>([]);
  const jobs = useRef<Map<string, Job>>(new Map());
  // Live run-control records, keyed by item id (see RunCtl). Presence means a
  // run is still in flight; a settled/errored run removes its own entry.
  const runs = useRef<Map<string, RunCtl>>(new Map());
  // Pending auto-dismiss timers, keyed by item id, so we can cancel them on
  // manual dismiss and on unmount (avoids setState-on-unmounted + double free).
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }, []);

  // Best-effort cancel of a known pending file_id. Idempotent on the backend
  // (204 even if already gone). A 409 means confirm-upload won the race, so the
  // file is genuinely confirmed — refresh the list to reflect it rather than
  // leaving a phantom-removed row. Every other failure is swallowed: the
  // backend confirmed-only filter keeps any orphan pending invisible, so we
  // never alarm the user with a misleading "cancel failed".
  const bestEffortCancel = useCallback(async (fileId: number) => {
    try {
      await api.cancelUpload(fileId);
    } catch (err) {
      if (err instanceof DriveApiError && err.status === 409) {
        onUploadedRef.current();
      }
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const timer = timers.current.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
      const ctl = runs.current.get(id);
      if (ctl && ctl.phase !== 'settled') {
        // In-flight row: this is a genuine cancel, not just a panel dismiss.
        ctl.cancelled = true;
        ctl.controller.abort(); // stop an in-flight PUT
        // If prepare already handed us a file_id, best-effort clean up the
        // pending record now (in the confirm phase this races confirm; a 409 is
        // handled as "confirm won"). While prepare is still in flight there is
        // no id yet — the run itself cancels once prepare returns.
        if (ctl.fileId !== undefined) {
          void bestEffortCancel(ctl.fileId);
        }
      }
      jobs.current.delete(id);
      setItems((list) => list.filter((it) => it.id !== id));
    },
    [bestEffortCancel],
  );

  // Auto-remove a successfully finished row after a short delay so the panel
  // doesn't accumulate stale "done" banners. Only 'done' rows schedule this;
  // 'error' rows stay put for the user to read + retry.
  const scheduleAutoDismiss = useCallback(
    (id: string) => {
      const existing = timers.current.get(id);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.current.delete(id);
        dismiss(id);
      }, AUTO_DISMISS_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((tm) => clearTimeout(tm));
      timers.current.clear();
      runs.current.forEach((ctl) => {
        ctl.cancelled = true;
        ctl.controller.abort();
        // Reclaim the pending record if we already have an id. Fire-and-forget
        // with no 409 refresh: the component is gone, there is nothing to
        // refresh, and we must not setState after unmount.
        if (ctl.fileId !== undefined) {
          void api.cancelUpload(ctl.fileId).catch(() => {});
        }
      });
      runs.current.clear();
    },
    [],
  );

  const runItem = useCallback(
    async (id: string) => {
      const job = jobs.current.get(id);
      if (!job) return;
      const { file, spaceId, parentId } = job;
      // Fresh control record per run (retry re-prepares, so it gets a new one).
      const ctl: RunCtl = { controller: new AbortController(), phase: 'preparing', cancelled: false };
      runs.current.set(id, ctl);
      try {
        patch(id, { status: 'preparing', progress: 0, error: undefined });
        const prep = await api.prepareUpload({
          space_id: spaceId,
          parent_id: parentId,
          name: file.name,
          size: file.size,
          content_type: file.type || 'application/octet-stream',
        });
        ctl.fileId = prep.file_id;
        // Cancel arrived while preparing: we now have a file_id, so best-effort
        // clean up the pending record and never start the PUT.
        if (ctl.cancelled) {
          void bestEffortCancel(prep.file_id);
          return;
        }

        ctl.phase = 'uploading';
        patch(id, { status: 'uploading', progress: 0 });
        await api.putToPresignedUrl(prep.upload_url, file, {
          contentType: prep.content_type,
          contentDisposition: prep.content_disposition,
          onProgress: (percent) => patch(id, { progress: percent }),
          signal: ctl.controller.signal,
        });
        // Guards the narrow window where cancel lands just as the PUT resolves
        // (an abort mid-PUT throws instead and is handled in catch).
        if (ctl.cancelled) {
          void bestEffortCancel(prep.file_id);
          return;
        }

        ctl.phase = 'confirming';
        patch(id, { status: 'confirming' });
        await api.confirmUpload(prep.file_id, { actual_size: file.size });
        // Cancel raced confirm and confirm won: the file is really uploaded.
        // Surface the confirmed result (the row was already removed by dismiss)
        // instead of claiming a cancellation.
        if (ctl.cancelled) {
          onUploadedRef.current();
          return;
        }

        ctl.phase = 'settled';
        patch(id, { status: 'done', progress: 100 });
        onUploadedRef.current();
        scheduleAutoDismiss(id);
      } catch (err: unknown) {
        // Cancel/unmount teardown: the PUT abort (or a confirm that failed
        // because cancel won) is expected — the row is already gone and the
        // dismiss handler already issued the best-effort cancel, so don't flash
        // an error.
        if (ctl.cancelled || ctl.controller.signal.aborted) return;
        const msg = (err as Error)?.message || t('drive.upload.failed');
        patch(id, { status: 'error', error: msg });
        Toast.error(msg);
      } finally {
        runs.current.delete(id);
      }
    },
    [patch, scheduleAutoDismiss, bestEffortCancel],
  );

  const addFiles = useCallback(
    (files: FileList | File[], spaceId: string, parentId: number) => {
      const created = Array.from(files).map((file) => {
        const id = nextId();
        jobs.current.set(id, { file, spaceId, parentId });
        return { id, name: file.name, size: file.size, status: 'preparing' as const, progress: 0 };
      });
      if (!created.length) return;
      setItems((list) => [...list, ...created]);
      created.forEach((it) => void runItem(it.id));
    },
    [runItem],
  );

  const retry = useCallback((id: string) => void runItem(id), [runItem]);

  return { items, addFiles, retry, dismiss };
}
