import type { DriveEntry } from '../bridge/types';

/**
 * One item's outcome in a batch run.
 * The DriveEntry is carried through so callers can render human-readable
 * failure lists without having to re-lookup by id.
 */
export interface BatchItemResult {
  entry: DriveEntry;
  ok: boolean;
  /** Present when ok === false. */
  error?: string;
}

export interface RunBatchResult {
  succeeded: DriveEntry[];
  failed: Array<{ entry: DriveEntry; error: string }>;
  /** In-order results for callers that want to display per-item progress. */
  results: BatchItemResult[];
}

export interface RunBatchOptions {
  /**
   * Max requests in flight at once. Defaults to 4 — enough to hide network
   * latency for small batches while not hammering the backend for large ones.
   * Set to 1 to force serial execution.
   */
  concurrency?: number;
  /**
   * Called after each item settles (success OR failure). Use to drive
   * per-row UI (fade-out on success, restore on failure). Never throws;
   * the loop keeps going even if the callback does.
   */
  onSettled?: (result: BatchItemResult) => void;
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Run a per-item async operation across a batch with bounded concurrency.
 * Every item resolves independently — one failure never cancels the rest.
 * The backend has no batch delete / move / download endpoints today
 * (folder/service.go, file/service.go both mount single-id routes), so this
 * is what "batch" means at the front-end for now: N single calls with a
 * concurrency cap and an aggregated result.
 */
export async function runBatch(
  entries: DriveEntry[],
  op: (entry: DriveEntry) => Promise<unknown>,
  opts: RunBatchOptions = {},
): Promise<RunBatchResult> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const results: BatchItemResult[] = new Array(entries.length);
  let cursor = 0;

  const runOne = async (): Promise<void> => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const index = cursor++;
      if (index >= entries.length) return;
      const entry = entries[index];
      let outcome: BatchItemResult;
      try {
        await op(entry);
        outcome = { entry, ok: true };
      } catch (err) {
        outcome = { entry, ok: false, error: readError(err) };
      }
      results[index] = outcome;
      try {
        opts.onSettled?.(outcome);
      } catch {
        // Never let a caller's UI callback crash the batch loop.
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, () => runOne());
  await Promise.all(workers);

  const succeeded: DriveEntry[] = [];
  const failed: Array<{ entry: DriveEntry; error: string }> = [];
  for (const r of results) {
    if (!r) continue;
    if (r.ok) succeeded.push(r.entry);
    else failed.push({ entry: r.entry, error: r.error ?? 'unknown error' });
  }
  return { succeeded, failed, results };
}

/**
 * Read a stable error string out of an unknown thrown value. Prefer the
 * DriveApiError-shaped message (already localised where possible), fall
 * back to Error.message, then to the string form.
 */
function readError(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as { message?: unknown };
    if (typeof anyErr.message === 'string' && anyErr.message.length > 0) {
      return anyErr.message;
    }
  }
  if (typeof err === 'string' && err.length > 0) return err;
  return 'unknown error';
}
