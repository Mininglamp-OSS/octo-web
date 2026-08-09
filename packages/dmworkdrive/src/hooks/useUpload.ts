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
  /**
   * file_id of the current run's pending record, kept on the Job (not the
   * RunCtl) so it OUTLIVES a terminal error: the RunCtl is deleted in `finally`,
   * but the error row lingers in the UI and its later dismiss/retry still needs
   * this id to reclaim the leaked pending record. Set once prepare returns;
   * cleared on confirmed success and after a cancel is issued (204/409). No run
   * has prepared yet while undefined.
   */
  pendingFileId?: number;
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
  /** Guards `refreshOnce`: a single run refreshes the file list at most once,
   *  even when confirm-success and a cancel-409 both fire for the same run. */
  refreshed: boolean;
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
  // Flips false on unmount so no async continuation calls the parent's
  // onUploaded (a refresh) after the component is gone.
  const mounted = useRef(true);

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }, []);

  // Refresh the file list at most once per run. confirm-success and a
  // cancel-409 can both signal "the file is really confirmed" for the same run,
  // in either order; without this guard they would each fire onUploaded and
  // refresh twice. Per-run (not global) so independent uploads still each
  // refresh exactly once. Suppressed after unmount (nothing to refresh).
  const refreshOnce = useCallback((ctl: RunCtl) => {
    if (ctl.refreshed) return;
    ctl.refreshed = true;
    if (mounted.current) onUploadedRef.current();
  }, []);

  // Best-effort cancel of a pending file_id. Idempotent on the backend (204
  // even if already gone). A 409 means confirm-upload won the race, so the file
  // is genuinely confirmed — the caller's `onConfirmWon` reflects it (refresh /
  // stop retry) rather than leaving a phantom-removed row. Every other failure
  // (network / 5xx / 403) is swallowed for the user: the backend confirmed-only
  // read filter keeps any orphan pending invisible, and we cannot safely retry
  // cleanup here — but we log a fixed-format breadcrumb (status/code only,
  // never file name / URL / token / id) so a front/back publish-order mismatch
  // is still discoverable.
  const bestEffortCancel = useCallback(
    async (fileId: number, onConfirmWon?: () => void) => {
      try {
        await api.cancelUpload(fileId);
      } catch (err) {
        if (err instanceof DriveApiError && err.status === 409) {
          onConfirmWon?.();
          return;
        }
        const status = err instanceof DriveApiError ? err.status : undefined;
        const code = err instanceof DriveApiError ? err.code : undefined;
        // Non-DriveApiError (network/unknown): log only the error's structural
        // name (e.g. "TypeError"), never its message — a message could echo a
        // URL / token / file name back into the console.
        const kind = err instanceof Error ? err.name : 'unknown';
        console.warn(
          `[drive] cancel-upload failed (best-effort); kind=${kind} status=${status ?? 'n/a'} code=${code ?? 'n/a'}`,
        );
      }
    },
    [],
  );

  const dismiss = useCallback(
    (id: string) => {
      const timer = timers.current.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
      const ctl = runs.current.get(id);
      const job = jobs.current.get(id);
      if (ctl && ctl.phase !== 'settled') {
        // In-flight row: this is a genuine cancel, not just a panel dismiss.
        ctl.cancelled = true;
        ctl.controller.abort(); // stop an in-flight PUT
        // If prepare already handed us a file_id, best-effort clean up the
        // pending record now (in the confirm phase this races confirm; a 409 is
        // handled as "confirm won"). While prepare is still in flight there is
        // no id yet — the run itself cancels once prepare returns.
        if (ctl.fileId !== undefined) {
          void bestEffortCancel(ctl.fileId, () => refreshOnce(ctl));
        }
      } else if (job?.pendingFileId !== undefined) {
        // No live run (typically a terminal error row: the RunCtl was already
        // deleted in `finally`), but a prior run left a pending record behind.
        // Reclaim it. A 409 means that old run actually confirmed — refresh the
        // real list to surface the file instead of dropping it silently.
        void bestEffortCancel(job.pendingFileId, () => {
          if (mounted.current) onUploadedRef.current();
        });
      }
      jobs.current.delete(id);
      setItems((list) => list.filter((it) => it.id !== id));
    },
    [bestEffortCancel, refreshOnce],
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
    () => {
      // Re-arm on every effect setup. React 18 StrictMode runs effects
      // setup→cleanup→setup in dev on the SAME hook instance (same refs); the
      // cleanup below sets this false, so without re-arming here `mounted` would
      // stay false for the whole real lifetime and suppress every post-confirm
      // refresh / retry. Stable deps mean this never re-runs in production.
      mounted.current = true;
      return () => {
        mounted.current = false;
        timers.current.forEach((tm) => clearTimeout(tm));
        timers.current.clear();
        runs.current.forEach((ctl) => {
          ctl.cancelled = true;
          ctl.controller.abort();
          // Reclaim the pending record if we already have an id. Fire-and-forget
          // and no onConfirmWon: the component is gone, there is nothing to
          // refresh, and mounted is already false so any refresh would be
          // suppressed anyway. (Only surfaces the safe non-409 warn.)
          if (ctl.fileId !== undefined) {
            void bestEffortCancel(ctl.fileId);
          }
        });
        // Terminal-error rows have no live RunCtl (deleted in `finally`) but may
        // still retain a pending id on the Job. Reclaim those too so leaving the
        // page directly doesn't strand them. Skip ids already handled by a live
        // run above — a live run's ctl.fileId equals its job.pendingFileId, and
        // cancelling twice would fire a redundant request.
        jobs.current.forEach((job, id) => {
          if (!runs.current.has(id) && job.pendingFileId !== undefined) {
            void bestEffortCancel(job.pendingFileId);
          }
        });
        runs.current.clear();
        jobs.current.clear();
      };
    },
    [bestEffortCancel],
  );

  const runItem = useCallback(
    async (id: string) => {
      const job = jobs.current.get(id);
      if (!job) return;
      // Re-entry guard: a run is already in flight for this id (e.g. a fast
      // double-click on retry). Starting another would overwrite its RunCtl in
      // the map and leak a duplicate upload — bail instead.
      if (runs.current.has(id)) return;
      const { file, spaceId, parentId } = job;
      // Fresh control record per run (retry re-prepares, so it gets a new one).
      const ctl: RunCtl = { controller: new AbortController(), phase: 'preparing', cancelled: false, refreshed: false };
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
        // Persist on the Job too, so a later terminal error still exposes this
        // pending id to dismiss/retry after the RunCtl is gone.
        job.pendingFileId = prep.file_id;
        // Cancel arrived while preparing: we now have a file_id, so best-effort
        // clean up the pending record and never start the PUT.
        if (ctl.cancelled) {
          void bestEffortCancel(ctl.fileId, () => refreshOnce(ctl));
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
          void bestEffortCancel(ctl.fileId, () => refreshOnce(ctl));
          return;
        }

        ctl.phase = 'confirming';
        patch(id, { status: 'confirming' });
        await api.confirmUpload(prep.file_id, { actual_size: file.size });
        // Cancel raced confirm and confirm won: the file is really uploaded.
        // Surface the confirmed result (the row was already removed by dismiss)
        // instead of claiming a cancellation. refreshOnce dedupes against the
        // cancel-409 path, which signals the same "confirm won" outcome.
        if (ctl.cancelled) {
          refreshOnce(ctl);
          return;
        }

        ctl.phase = 'settled';
        // Confirmed: no pending record left to reclaim.
        job.pendingFileId = undefined;
        patch(id, { status: 'done', progress: 100 });
        refreshOnce(ctl);
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
    [patch, scheduleAutoDismiss, bestEffortCancel, refreshOnce],
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

  // Restart a failed item. Before the fresh prepare, best-effort reclaim the
  // pending record the failed run left behind so we don't leak it. A 409 means
  // that old run actually confirmed on the backend — starting a new upload
  // would duplicate the file, so we stop the retry, drop the row, and refresh
  // the real list to show the confirmed file. A non-409 cancel failure is
  // non-fatal: we still re-prepare (the backend confirmed-only filter hides the
  // orphan), and the fresh prepare produces a NEW id — the old one is never
  // reused. runItem then re-prepares from scratch.
  const retryRun = useCallback(
    async (id: string) => {
      // A run is already in flight for this id — don't start a competing one.
      if (runs.current.has(id)) return;
      const job = jobs.current.get(id);
      if (!job) return;
      // Take the stale id out and clear it BEFORE awaiting, so an interleaving
      // unmount cleanup won't also try to cancel it. Cancel is idempotent, but
      // one request is enough — this keeps a given stale id cancelled at most
      // once across the retry-await + unmount paths.
      const stalePending = job.pendingFileId;
      job.pendingFileId = undefined;
      if (stalePending !== undefined) {
        // Reflect the cleanup immediately: hide the error/retry affordance.
        patch(id, { status: 'preparing', progress: 0, error: undefined });
        let confirmWon = false;
        await bestEffortCancel(stalePending, () => {
          confirmWon = true;
        });
        // The await yielded: the component may have unmounted or the row may
        // have been dismissed. Bail before any new prepare/PUT/confirm or
        // setState so nothing runs against a dead component / removed item.
        if (!mounted.current || !jobs.current.has(id)) return;
        if (confirmWon) {
          jobs.current.delete(id);
          setItems((list) => list.filter((it) => it.id !== id));
          onUploadedRef.current();
          return;
        }
      }
      void runItem(id);
    },
    [bestEffortCancel, patch, runItem],
  );

  const retry = useCallback((id: string) => void retryRun(id), [retryRun]);

  return { items, addFiles, retry, dismiss };
}
