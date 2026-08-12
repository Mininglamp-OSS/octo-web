export interface ComposeRecoveryRecord {
  channelKey: string;
  attemptId: string;
}

export interface ComposeRecoveryStoreOptions<T extends ComposeRecoveryRecord> {
  maxChannels?: number;
  maxRecordsPerChannel?: number;
  ttlMs?: number;
  now?: () => number;
  dispose?: (record: T) => void;
}

interface StoredRecovery<T> {
  record: T;
  createdAt: number;
}

interface RecoveryBucket<T> {
  records: StoredRecovery<T>[];
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
export class ComposeRecoveryStore<T extends ComposeRecoveryRecord> {
  private readonly buckets = new Map<string, RecoveryBucket<T>>();
  private readonly listeners = new Map<string, Set<RecoveryListener>>();
  private readonly maxChannels: number;
  private readonly maxRecordsPerChannel: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly disposeRecord: (record: T) => void;

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
    this.pruneExpired(this.now(), false, channelKey);
    return (
      this.buckets.get(channelKey)?.records.map(({ record }) => record) ?? []
    );
  }

  add(record: T): boolean {
    const now = this.now();
    this.pruneExpired(now, true);

    let bucket = this.buckets.get(record.channelKey);
    if (!bucket) {
      this.ensureChannelCapacity();
      bucket = { records: [], touchedAt: now };
      this.buckets.set(record.channelKey, bucket);
    }
    if (
      bucket.records.some(
        ({ record: item }) => item.attemptId === record.attemptId
      )
    ) {
      return false;
    }

    while (bucket.records.length >= this.maxRecordsPerChannel) {
      const evicted = bucket.records.shift();
      if (evicted) this.disposeRecord(evicted.record);
    }
    bucket.records.push({ record, createdAt: now });
    bucket.touchedAt = now;
    this.notify(record.channelKey);
    return true;
  }

  /** Remove successfully restored records without disposing transferred resources. */
  consume(channelKey: string, attemptIds: readonly string[]): void {
    const bucket = this.buckets.get(channelKey);
    if (!bucket || attemptIds.length === 0) return;

    const consumed = new Set(attemptIds);
    const remaining = bucket.records.filter(
      ({ record }) => !consumed.has(record.attemptId)
    );
    if (remaining.length === bucket.records.length) return;

    if (remaining.length === 0) this.buckets.delete(channelKey);
    else bucket.records = remaining;
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
      bucket.records.forEach((stored) => {
        if (now - stored.createdAt >= this.ttlMs) {
          this.disposeRecord(stored.record);
        } else {
          live.push(stored);
        }
      });
      if (live.length === bucket.records.length) return;
      if (live.length === 0) this.buckets.delete(channelKey);
      else bucket.records = live;
      if (notify) this.notify(channelKey);
    });
  }

  private notify(channelKey: string): void {
    this.listeners.get(channelKey)?.forEach((listener) => listener());
  }
}
