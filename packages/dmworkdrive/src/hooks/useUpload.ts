import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@octo/base';
import * as api from '../api/driveApi';
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

/**
 * Type-2 upload state machine (spec §4.2).
 *
 * Composes the three audited driveApi primitives — prepareUpload →
 * putToPresignedUrl → confirmUpload — into a per-file state machine with
 * progress and per-step retry. The direct-to-storage PUT MUST go through
 * `putToPresignedUrl` (M-3): it owns the interceptor-free axios instance and
 * URL safety check, so no session token ever crosses the storage origin. This
 * hook only orchestrates state; it never touches storage directly.
 *
 * @param onUploaded Invoked after each file is confirmed, so the caller can
 *   refresh the file list.
 */
export function useUpload(onUploaded: () => void): UseUpload {
  const [items, setItems] = useState<UploadItem[]>([]);
  const jobs = useRef<Map<string, Job>>(new Map());
  // Pending auto-dismiss timers, keyed by item id, so we can cancel them on
  // manual dismiss and on unmount (avoids setState-on-unmounted + double free).
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    jobs.current.delete(id);
    setItems((list) => list.filter((it) => it.id !== id));
  }, []);

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
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
    },
    [],
  );

  const runItem = useCallback(
    async (id: string) => {
      const job = jobs.current.get(id);
      if (!job) return;
      const { file, spaceId, parentId } = job;
      try {
        patch(id, { status: 'preparing', progress: 0, error: undefined });
        const prep = await api.prepareUpload({
          space_id: spaceId,
          parent_id: parentId,
          name: file.name,
          size: file.size,
          content_type: file.type || 'application/octet-stream',
        });

        patch(id, { status: 'uploading', progress: 0 });
        await api.putToPresignedUrl(prep.upload_url, file, {
          contentType: prep.content_type,
          contentDisposition: prep.content_disposition,
          onProgress: (percent) => patch(id, { progress: percent }),
        });

        patch(id, { status: 'confirming' });
        await api.confirmUpload(prep.file_id, { actual_size: file.size });

        patch(id, { status: 'done', progress: 100 });
        onUploadedRef.current();
        scheduleAutoDismiss(id);
      } catch (err: unknown) {
        const msg = (err as Error)?.message || t('drive.upload.failed');
        patch(id, { status: 'error', error: msg });
        Toast.error(msg);
      }
    },
    [patch, scheduleAutoDismiss],
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
