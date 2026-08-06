import { describe, it, expect, vi } from 'vitest';
import { runBatch } from '../runBatch';
import type { DriveEntry, FileType } from '../../bridge/types';

function entry(id: number, name: string = `n${id}`, type: FileType = 'blob'): DriveEntry {
  return {
    id,
    space_id: 'sp',
    parent_id: 0,
    name,
    is_folder: type === 'folder',
    type,
    size: 100,
    source: 'user-upload',
    owner_uid: 'u',
    created_at: '',
    updated_at: '2026-07-23T10:00:00.000Z',
  };
}

describe('runBatch', () => {
  it('returns empty results for an empty batch', async () => {
    const op = vi.fn().mockResolvedValue(undefined);
    const r = await runBatch([], op);
    expect(r.succeeded).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(op).not.toHaveBeenCalled();
  });

  it('all-success: every entry lands in succeeded, none in failed', async () => {
    const items = [entry(1), entry(2), entry(3)];
    const op = vi.fn().mockResolvedValue(undefined);
    const r = await runBatch(items, op);
    expect(r.succeeded).toHaveLength(3);
    expect(r.failed).toHaveLength(0);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('partial-failure: one failure does not cancel the rest', async () => {
    const items = [entry(1), entry(2), entry(3)];
    const op = vi.fn(async (e: DriveEntry) => {
      if (e.id === 2) throw new Error('boom');
    });
    const r = await runBatch(items, op, { concurrency: 1 });
    expect(r.succeeded.map((e) => e.id)).toEqual([1, 3]);
    expect(r.failed.map((f) => f.entry.id)).toEqual([2]);
    expect(r.failed[0].error).toBe('boom');
  });

  it('unwraps DriveApiError-shaped errors via .message', async () => {
    const items = [entry(1)];
    const op = vi.fn(async () => {
      throw { message: 'permission_denied', status: 403 };
    });
    const r = await runBatch(items, op);
    expect(r.failed[0].error).toBe('permission_denied');
  });

  it('falls back to "unknown error" for objects without message', async () => {
    const items = [entry(1)];
    const op = vi.fn(async () => {
      throw {};
    });
    const r = await runBatch(items, op);
    expect(r.failed[0].error).toBe('unknown error');
  });

  it('honours concurrency cap: never more than N in flight at once', async () => {
    const items = [entry(1), entry(2), entry(3), entry(4), entry(5), entry(6)];
    let inFlight = 0;
    let maxInFlight = 0;
    const op = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    await runBatch(items, op, { concurrency: 2 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('runs serially when concurrency is 1', async () => {
    const items = [entry(1), entry(2), entry(3)];
    const order: number[] = [];
    const op = vi.fn(async (e: DriveEntry) => {
      order.push(e.id);
      await new Promise((r) => setTimeout(r, 5));
    });
    await runBatch(items, op, { concurrency: 1 });
    expect(order).toEqual([1, 2, 3]);
  });

  it('fires onSettled for each item, in completion order', async () => {
    const items = [entry(1), entry(2)];
    const settled: number[] = [];
    const op = vi.fn(async (e: DriveEntry) => {
      if (e.id === 1) throw new Error('nope');
    });
    await runBatch(items, op, {
      concurrency: 1,
      onSettled: (r) => settled.push(r.entry.id),
    });
    expect(settled).toEqual([1, 2]);
  });

  it('a throwing onSettled callback does not abort the batch', async () => {
    const items = [entry(1), entry(2)];
    const op = vi.fn().mockResolvedValue(undefined);
    const r = await runBatch(items, op, {
      onSettled: () => {
        throw new Error('callback crashed');
      },
    });
    expect(r.succeeded).toHaveLength(2);
  });

  it('results array preserves the original entry order', async () => {
    const items = [entry(10), entry(20), entry(30)];
    const op = vi.fn(async (e: DriveEntry) => {
      // Delay id=10 so it settles LAST — results should still be in input order.
      if (e.id === 10) await new Promise((r) => setTimeout(r, 20));
    });
    const r = await runBatch(items, op, { concurrency: 3 });
    expect(r.results.map((res) => res.entry.id)).toEqual([10, 20, 30]);
  });
});
