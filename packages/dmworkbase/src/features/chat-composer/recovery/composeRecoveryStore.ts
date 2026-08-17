export interface ComposeRecoveryStoreRecord {
  channelKey: string;
  attemptId: string;
}

export interface ComposeRecoveryPendingDraft {
  attemptId: string;
  draftText: string;
}

export type ComposeRecoveryDraftSource = "live" | "pending" | "empty";

export interface ComposeRecoveryDraftState {
  revision: number;
  draft: string;
  source: ComposeRecoveryDraftSource;
  pendingAttemptIds: string[];
}

export interface RecordComposeRecoveryDraft {
  draft: string;
  source: ComposeRecoveryDraftSource;
  pendingDrafts?: readonly ComposeRecoveryPendingDraft[];
}

export interface ComposeRecoveryStoreOptions<
  T extends ComposeRecoveryStoreRecord
> {
  maxChannels?: number;
  /** Soft cap; actively claimed records are never evicted and may exceed it temporarily. */
  maxRecordsPerChannel?: number;
  ttlMs?: number;
  now?: () => number;
  dispose?: (record: T) => void;
}

interface StoredRecovery<T> {
  record: T;
  createdAt: number;
  claimedBy?: symbol;
}

interface StoredDraftState extends ComposeRecoveryDraftState {
  pendingDrafts: ComposeRecoveryPendingDraft[];
  touchedAt: number;
}

interface RecoveryBucket<T> {
  records: StoredRecovery<T>[];
  draftState?: StoredDraftState;
  draftRevisionLeases: Map<number, number>;
  touchedAt: number;
}

type RecoveryListener = () => void;

const DEFAULT_MAX_CHANNELS = 50;
const DEFAULT_MAX_RECORDS_PER_CHANNEL = 20;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * Session-scoped handoff for composes whose original editor was destroyed.
 * Records remain ordered by arrival and notify whichever Conversation instance
 * currently owns the channel, rather than the stale instance that reported the
 * failure.
 */
export class ComposeRecoveryStore<T extends ComposeRecoveryStoreRecord> {
  private readonly buckets = new Map<string, RecoveryBucket<T>>();
  private readonly listeners = new Map<string, Set<RecoveryListener>>();
  private readonly maxChannels: number;
  private readonly maxRecordsPerChannel: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly disposeRecord: (record: T) => void;
  private nextDraftRevision = 1;

  constructor(options: ComposeRecoveryStoreOptions<T> = {}) {
    this.maxChannels = Math.max(
      1,
      Math.floor(options.maxChannels ?? DEFAULT_MAX_CHANNELS)
    );
    this.maxRecordsPerChannel = Math.max(
      1,
      Math.floor(
        options.maxRecordsPerChannel ?? DEFAULT_MAX_RECORDS_PER_CHANNEL
      )
    );
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
    this.now = options.now ?? Date.now;
    this.disposeRecord = options.dispose ?? (() => undefined);
  }

  subscribe(channelKey: string, listener: RecoveryListener): () => void {
    const listeners = this.listeners.get(channelKey) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channelKey, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(channelKey);
    };
  }

  list(channelKey: string): readonly T[] {
    return (
      this.buckets.get(channelKey)?.records.map(({ record }) => record) ?? []
    );
  }

  /** Capture the current session revision for a send's draft baseline. */
  captureDraftRevision(channelKey: string, draft: string): number {
    const now = this.now();
    this.pruneExpired(now, true, channelKey);
    const bucket = this.ensureBucket(channelKey, now);
    if (!bucket.draftState || bucket.draftState.draft !== draft) {
      this.setDraftState(
        bucket,
        {
          draft,
          source: draft.trim() === "" ? "empty" : "live",
        },
        now
      );
    }
    const revision = bucket.draftState!.revision;
    bucket.draftRevisionLeases.set(
      revision,
      (bucket.draftRevisionLeases.get(revision) ?? 0) + 1
    );
    return revision;
  }

  releaseDraftRevision(channelKey: string, revision: number): void {
    const bucket = this.buckets.get(channelKey);
    const count = bucket?.draftRevisionLeases.get(revision);
    if (!bucket || !count) return;
    if (count === 1) bucket.draftRevisionLeases.delete(revision);
    else bucket.draftRevisionLeases.set(revision, count - 1);
    this.deleteEmptyBucket(channelKey, bucket);
  }

  recordDraft(channelKey: string, record: RecordComposeRecoveryDraft): number {
    const now = this.now();
    this.pruneExpired(now, true);
    const bucket = this.ensureBucket(channelKey, now);
    this.setDraftState(bucket, record, now);
    return bucket.draftState!.revision;
  }

  draftState(channelKey: string): ComposeRecoveryDraftState | undefined {
    this.pruneExpired(this.now(), true, channelKey);
    const state = this.buckets.get(channelKey)?.draftState;
    if (!state) return undefined;
    return {
      revision: state.revision,
      draft: state.draft,
      source: state.source,
      pendingAttemptIds: [...state.pendingAttemptIds],
    };
  }

  /** Match only an exact provisional draft still owned by pending attempts. */
  matchPendingDraft(channelKey: string, draft: string): readonly string[] {
    const state = this.draftState(channelKey);
    if (state?.source !== "pending" || state.draft !== draft) return [];
    return state.pendingAttemptIds;
  }

  /** Exclusively reserve available records for one mounted consumer. */
  claim(channelKey: string, owner: symbol): readonly T[] {
    this.pruneExpired(this.now(), false, channelKey);
    const bucket = this.buckets.get(channelKey);
    if (!bucket) return [];

    bucket.records.forEach((stored) => {
      if (!stored.claimedBy) stored.claimedBy = owner;
    });
    return bucket.records
      .filter(({ claimedBy }) => claimedBy === owner)
      .map(({ record }) => record);
  }

  add(record: T): boolean {
    const now = this.now();
    this.pruneExpired(now, true);

    const bucket = this.ensureBucket(record.channelKey, now);
    if (
      bucket.records.some(
        ({ record: item }) => item.attemptId === record.attemptId
      )
    ) {
      return false;
    }

    while (bucket.records.length >= this.maxRecordsPerChannel) {
      const evictIndex = bucket.records.findIndex(
        ({ claimedBy }) => !claimedBy
      );
      if (evictIndex < 0) break;
      const evicted = bucket.records[evictIndex];
      if (
        evicted &&
        bucket.draftState?.pendingAttemptIds.includes(evicted.record.attemptId)
      ) {
        const invalidated = this.invalidateDraftRecovery(bucket, now);
        if (invalidated.has(record.attemptId)) {
          this.notify(record.channelKey);
          return false;
        }
        continue;
      }
      const [removed] = bucket.records.splice(evictIndex, 1);
      if (removed) this.disposeRecord(removed.record);
    }
    bucket.records.push({ record, createdAt: now });
    bucket.touchedAt = now;
    this.notify(record.channelKey);
    return true;
  }

  /** Remove successfully restored records without disposing transferred resources. */
  consume(
    channelKey: string,
    owner: symbol,
    attemptIds: readonly string[],
    hydratedDraft?: string
  ): void {
    const bucket = this.buckets.get(channelKey);
    if (!bucket || attemptIds.length === 0) return;

    const consumed = new Set(attemptIds);
    const remaining = bucket.records.filter(
      ({ record, claimedBy }) =>
        claimedBy !== owner || !consumed.has(record.attemptId)
    );
    if (remaining.length === bucket.records.length) return;

    bucket.records = remaining;
    if (hydratedDraft !== undefined) {
      this.setDraftState(
        bucket,
        {
          draft: hydratedDraft,
          source: hydratedDraft.trim() === "" ? "empty" : "live",
        },
        this.now()
      );
    } else {
      this.invalidateDraftRecovery(bucket, this.now(), attemptIds);
    }
    this.deleteEmptyBucket(channelKey, bucket);
    this.notify(channelKey);
  }

  /** Release unacknowledged claims so another consumer can recover them. */
  release(channelKey: string, owner: symbol): void {
    const bucket = this.buckets.get(channelKey);
    if (!bucket) return;
    let released = false;
    bucket.records.forEach((stored) => {
      if (stored.claimedBy === owner) {
        stored.claimedBy = undefined;
        released = true;
      }
    });
    if (!released) return;
    this.pruneExpired(this.now(), false, channelKey);
    this.notify(channelKey);
  }

  clearChannel(channelKey: string): void {
    const bucket = this.buckets.get(channelKey);
    if (!bucket) return;
    bucket.records.forEach(({ record }) => this.disposeRecord(record));
    this.buckets.delete(channelKey);
    this.notify(channelKey);
  }

  clearAll(): void {
    const channelKeys = Array.from(this.buckets.keys());
    this.buckets.forEach((bucket) => {
      bucket.records.forEach(({ record }) => this.disposeRecord(record));
    });
    this.buckets.clear();
    channelKeys.forEach((channelKey) => this.notify(channelKey));
  }

  private ensureChannelCapacity(): void {
    while (this.buckets.size >= this.maxChannels) {
      let oldest: [string, RecoveryBucket<T>] | undefined;
      this.buckets.forEach((bucket, channelKey) => {
        if (
          bucket.records.some(({ claimedBy }) => claimedBy) ||
          bucket.draftRevisionLeases.size > 0
        ) {
          return;
        }
        if (!oldest || bucket.touchedAt < oldest[1].touchedAt) {
          oldest = [channelKey, bucket];
        }
      });
      if (!oldest) return;
      const [channelKey, bucket] = oldest;
      bucket.records.forEach(({ record }) => this.disposeRecord(record));
      this.buckets.delete(channelKey);
      this.notify(channelKey);
    }
  }

  private ensureBucket(channelKey: string, now: number): RecoveryBucket<T> {
    let bucket = this.buckets.get(channelKey);
    if (bucket) return bucket;
    this.ensureChannelCapacity();
    bucket = {
      records: [],
      draftRevisionLeases: new Map(),
      touchedAt: now,
    };
    this.buckets.set(channelKey, bucket);
    return bucket;
  }

  private setDraftState(
    bucket: RecoveryBucket<T>,
    record: RecordComposeRecoveryDraft,
    now: number
  ): void {
    const pendingDrafts =
      record.source === "pending"
        ? (record.pendingDrafts ?? []).filter(
            ({ draftText }) => draftText.trim() !== ""
          )
        : [];
    const source =
      pendingDrafts.length > 0
        ? record.source
        : record.draft.trim() === ""
        ? "empty"
        : "live";
    bucket.draftState = {
      revision: this.nextDraftRevision++,
      draft: record.draft,
      source,
      pendingAttemptIds: pendingDrafts.map(({ attemptId }) => attemptId),
      pendingDrafts: pendingDrafts.map(({ attemptId, draftText }) => ({
        attemptId,
        draftText,
      })),
      touchedAt: now,
    };
    bucket.touchedAt = now;
  }

  private removeDraftOwners(
    bucket: RecoveryBucket<T>,
    attemptIds: readonly string[],
    now: number
  ): void {
    const state = bucket.draftState;
    if (!state || attemptIds.length === 0) return;
    const removed = new Set(attemptIds);
    if (!state.pendingDrafts.some(({ attemptId }) => removed.has(attemptId))) {
      return;
    }
    bucket.draftState = {
      ...state,
      revision: this.nextDraftRevision++,
      source: state.draft.trim() === "" ? "empty" : "live",
      pendingAttemptIds: [],
      pendingDrafts: [],
      touchedAt: now,
    };
    bucket.touchedAt = now;
  }

  /**
   * Once one text-owning recovery is unavailable, the provisional remote
   * draft becomes the canonical fallback. Keeping sibling recoveries would
   * prepend duplicate text to that full draft, so they are disposed together.
   */
  private invalidateDraftRecovery(
    bucket: RecoveryBucket<T>,
    now: number,
    attemptIds?: readonly string[]
  ): Set<string> {
    const state = bucket.draftState;
    const owned = new Set(state?.pendingAttemptIds ?? []);
    if (
      !state ||
      owned.size === 0 ||
      (attemptIds && !attemptIds.some((attemptId) => owned.has(attemptId)))
    ) {
      return new Set();
    }

    const remaining: StoredRecovery<T>[] = [];
    bucket.records.forEach((stored) => {
      if (owned.has(stored.record.attemptId)) {
        this.disposeRecord(stored.record);
      } else {
        remaining.push(stored);
      }
    });
    bucket.records = remaining;
    this.removeDraftOwners(bucket, [...owned], now);
    return owned;
  }

  private deleteEmptyBucket(
    channelKey: string,
    bucket: RecoveryBucket<T>
  ): void {
    if (
      bucket.records.length === 0 &&
      !bucket.draftState &&
      bucket.draftRevisionLeases.size === 0
    ) {
      this.buckets.delete(channelKey);
    }
  }

  private pruneExpired(
    now: number,
    notify: boolean,
    onlyChannelKey?: string
  ): void {
    if (this.ttlMs <= 0) return;
    const buckets = onlyChannelKey
      ? ([[onlyChannelKey, this.buckets.get(onlyChannelKey)]] as const)
      : Array.from(this.buckets.entries());
    buckets.forEach(([channelKey, bucket]) => {
      if (!bucket) return;
      const live: StoredRecovery<T>[] = [];
      const expiredAttemptIds: string[] = [];
      bucket.records.forEach((stored) => {
        if (!stored.claimedBy && now - stored.createdAt >= this.ttlMs) {
          this.disposeRecord(stored.record);
          expiredAttemptIds.push(stored.record.attemptId);
        } else {
          live.push(stored);
        }
      });
      let recordsChanged = live.length !== bucket.records.length;
      if (recordsChanged) bucket.records = live;

      const state = bucket.draftState;
      if (state && state.source === "pending") {
        // Pending ownership represents a still-running attempt and therefore
        // does not expire by age alone. Once a recovery exists, its
        // expiry/eviction removes the matching owner atomically.
        const invalidated = this.invalidateDraftRecovery(
          bucket,
          now,
          expiredAttemptIds
        );
        if (invalidated.size > 0) recordsChanged = true;
      } else if (
        state &&
        now - state.touchedAt >= this.ttlMs &&
        live.length === 0 &&
        !bucket.draftRevisionLeases.has(state.revision)
      ) {
        bucket.draftState = undefined;
      }

      this.deleteEmptyBucket(channelKey, bucket);
      if (recordsChanged && notify) this.notify(channelKey);
    });
  }

  private notify(channelKey: string): void {
    this.listeners.get(channelKey)?.forEach((listener) => listener());
  }
}
