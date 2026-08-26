const DATABASE_NAME = "octo-message-attention";
const DATABASE_VERSION = 1;
const CLAIM_STORE = "alert-claims";
const EXPIRES_INDEX = "expires-at";
const DEFAULT_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SETTLEMENT_MS = 500;
const DEFAULT_SUPPRESSION_GRACE_MS = 50;
const DEFAULT_MAX_CLAIM_RECORDS = 10_000;

export type AlertClaimState = "pending" | "suppressed" | "alerted";

interface StoredAlertClaim {
  key: string;
  state?: AlertClaimState;
  readyAt?: number;
  expiresAt: number;
}

export interface PreparedAlertClaim {
  state: AlertClaimState;
  readyAt: number;
}

export interface AlertClaimStore {
  prepare(
    key: string,
    readyAt: number,
    now?: number
  ): Promise<PreparedAlertClaim>;
  suppress(key: string, now?: number): Promise<boolean>;
  commit(key: string, now?: number): Promise<boolean>;
}

export interface SingleAlertRequest {
  accountId: string;
  messageId?: string;
  clientMsgNo?: string;
  shouldSuppress?: () => boolean | Promise<boolean>;
  /**
   * Subscribe while this request is pending so a tab that becomes foreground,
   * opens the conversation, or scrolls the message into view can persist the
   * suppression before a background tab reaches its commit deadline.
   */
  subscribeSuppressionChanges?: (listener: () => void) => () => void;
  isStillEligible?: () => boolean | Promise<boolean>;
  alert: () => void | Promise<void>;
}

type AlertBroadcastMessage =
  | { type: "candidate"; key: string }
  | {
      type: "settled";
      key: string;
      state: Exclude<AlertClaimState, "pending">;
    };

interface AlertBroadcastEvent {
  data: AlertBroadcastMessage;
}

interface AlertBroadcastChannel {
  postMessage(message: AlertBroadcastMessage): void;
  addEventListener?(
    type: "message",
    listener: (event: AlertBroadcastEvent) => void
  ): void;
  removeEventListener?(
    type: "message",
    listener: (event: AlertBroadcastEvent) => void
  ): void;
  close?(): void;
}

export interface SingleAlertCoordinatorOptions {
  claimStore: AlertClaimStore;
  channel?: AlertBroadcastChannel;
  settlementMs?: number;
  suppressionGraceMs?: number;
  now?: () => number;
  wait?: (delayMs: number) => Promise<void>;
}

export interface AlertClaimStoreOptions {
  ttlMs?: number;
  maxRecords?: number;
}

function normalizeStoredClaim(claim: StoredAlertClaim): PreparedAlertClaim {
  // Version 1 records created before the state machine were already terminal
  // claims. Treat them as alerted so an upgrade cannot replay old messages.
  const state = claim.state || "alerted";
  return {
    state,
    readyAt: claim.readyAt ?? 0,
  };
}

function createStoredClaim(
  key: string,
  state: AlertClaimState,
  now: number,
  ttlMs: number,
  readyAt = now
): StoredAlertClaim {
  return {
    key,
    state,
    readyAt,
    expiresAt: Math.max(now + ttlMs, readyAt + 1),
  };
}

function normalizeStoreOptions(
  options: AlertClaimStoreOptions
): Required<AlertClaimStoreOptions> {
  const ttlMs = options.ttlMs ?? DEFAULT_CLAIM_TTL_MS;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_CLAIM_RECORDS;
  return {
    ttlMs: Number.isFinite(ttlMs) ? Math.max(1, ttlMs) : DEFAULT_CLAIM_TTL_MS,
    maxRecords: Number.isFinite(maxRecords)
      ? Math.max(1, Math.floor(maxRecords))
      : DEFAULT_MAX_CLAIM_RECORDS,
  };
}

export function buildAlertClaimKey(
  request: Omit<SingleAlertRequest, "alert">
): string | undefined {
  const stableMessageId = request.messageId || request.clientMsgNo;
  if (!request.accountId || !stableMessageId) return undefined;
  return JSON.stringify([request.accountId, stableMessageId]);
}

export class SingleAlertCoordinator {
  private readonly claimStore: AlertClaimStore;
  private readonly channel?: AlertBroadcastChannel;
  private readonly settlementMs: number;
  private readonly suppressionGraceMs: number;
  private readonly now: () => number;
  private readonly wait: (delayMs: number) => Promise<void>;
  private readonly settledWaiters = new Map<string, Set<() => void>>();

  private readonly handleBroadcast = (event: AlertBroadcastEvent): void => {
    const message = event.data;
    if (!message || message.type !== "settled") return;
    for (const settle of this.settledWaiters.get(message.key) || []) settle();
  };

  constructor(options: SingleAlertCoordinatorOptions) {
    this.claimStore = options.claimStore;
    this.channel = options.channel;
    const settlementMs = options.settlementMs ?? DEFAULT_SETTLEMENT_MS;
    this.settlementMs = Number.isFinite(settlementMs)
      ? Math.max(0, settlementMs)
      : DEFAULT_SETTLEMENT_MS;
    const suppressionGraceMs =
      options.suppressionGraceMs ?? DEFAULT_SUPPRESSION_GRACE_MS;
    this.suppressionGraceMs = Number.isFinite(suppressionGraceMs)
      ? Math.max(0, suppressionGraceMs)
      : DEFAULT_SUPPRESSION_GRACE_MS;
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((delayMs) =>
        new Promise<void>((resolve) =>
          globalThis.setTimeout(resolve, delayMs)
        ));
    try {
      this.channel?.addEventListener?.("message", this.handleBroadcast);
    } catch {
      // BroadcastChannel is only a latency optimization. IndexedDB remains the
      // authority even if the channel is closed or unavailable.
    }
  }

  async runOnce(request: SingleAlertRequest): Promise<boolean> {
    const key = buildAlertClaimKey(request);
    if (!key) return false;

    const now = this.now();
    let prepared = await this.claimStore.prepare(
      key,
      now + this.settlementMs,
      now
    );
    if (prepared.state !== "pending") return false;

    let active = true;
    let suppressionQueue = Promise.resolve(false);
    const checkAndSuppress = (): Promise<boolean> => {
      suppressionQueue = suppressionQueue
        .catch(() => false)
        .then(async (alreadySuppressed) => {
          if (alreadySuppressed || !active || !request.shouldSuppress) {
            return alreadySuppressed;
          }
          if (!(await request.shouldSuppress())) return false;
          const suppressed = await this.claimStore.suppress(key, this.now());
          if (suppressed) {
            this.broadcast({
              type: "settled",
              key,
              state: "suppressed",
            });
          }
          return suppressed;
        });
      return suppressionQueue;
    };
    const suppressionChanged = () => {
      // Event callbacks cannot be awaited by the browser/mitt. Keep the check
      // serialized with the deadline path and absorb storage failures here;
      // the normal deadline recheck remains the final fallback.
      void checkAndSuppress().catch(() => undefined);
    };
    let unsubscribeSuppressionChanges: (() => void) | undefined;

    try {
      unsubscribeSuppressionChanges =
        request.subscribeSuppressionChanges?.(suppressionChanged);
      if (await checkAndSuppress()) return false;

      this.broadcast({ type: "candidate", key });
      while (prepared.state === "pending" && this.now() < prepared.readyAt) {
        await this.waitUntilReadyOrSettled(key, prepared.readyAt);
        // BroadcastChannel can wake this tab early, but only the shared store may
        // prove that another tab reached a terminal state. A lost or stale
        // broadcast therefore cannot create or suppress an alert by itself.
        prepared = await this.claimStore.prepare(
          key,
          prepared.readyAt,
          this.now()
        );
      }
      if (prepared.state !== "pending") return false;

      // Give foreground/viewport events that coincide with the settlement
      // deadline a short priority phase. Background tabs do not commit while a
      // newly-focused tab is still painting and persisting its suppression.
      if (request.subscribeSuppressionChanges && this.suppressionGraceMs > 0) {
        const suppressionDeadline = this.now() + this.suppressionGraceMs;
        while (this.now() < suppressionDeadline) {
          await this.waitUntilReadyOrSettled(key, suppressionDeadline);
          prepared = await this.claimStore.prepare(
            key,
            prepared.readyAt,
            this.now()
          );
          if (prepared.state !== "pending") return false;
        }
      }

      // Seal the local event source, then serialize against every suppression
      // check that was queued before the cutoff. This removes the local
      // check/commit gap; cross-tab suppression and commit remain ordered by
      // the shared IndexedDB readwrite transaction.
      unsubscribeSuppressionChanges?.();
      unsubscribeSuppressionChanges = undefined;
      if (await checkAndSuppress()) return false;
      prepared = await this.claimStore.prepare(
        key,
        prepared.readyAt,
        this.now()
      );
      if (prepared.state !== "pending") return false;

      if (request.isStillEligible && !(await request.isStillEligible())) {
        return false;
      }

      active = false;
      if (!(await this.claimStore.commit(key, this.now()))) return false;
      this.broadcast({ type: "settled", key, state: "alerted" });
      await request.alert();
      return true;
    } finally {
      active = false;
      unsubscribeSuppressionChanges?.();
    }
  }

  async claimOnly(
    request: Omit<SingleAlertRequest, "alert">
  ): Promise<boolean> {
    const key = buildAlertClaimKey(request);
    if (!key) return false;
    const suppressed = await this.claimStore.suppress(key, this.now());
    if (suppressed) {
      this.broadcast({
        type: "settled",
        key,
        state: "suppressed",
      });
    }
    return suppressed;
  }

  close(): void {
    try {
      this.channel?.removeEventListener?.("message", this.handleBroadcast);
    } catch {
      // The state machine does not rely on channel teardown succeeding.
    }
    for (const waiters of this.settledWaiters.values()) {
      for (const settle of waiters) settle();
    }
    this.settledWaiters.clear();
    try {
      this.channel?.close?.();
    } catch {
      // Closing an already closed channel is harmless to persisted decisions.
    }
  }

  private broadcast(message: AlertBroadcastMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A failed acceleration signal must not alter the IndexedDB decision.
    }
  }

  private async waitUntilReadyOrSettled(
    key: string,
    readyAt: number
  ): Promise<void> {
    const delayMs = Math.max(0, readyAt - this.now());
    if (delayMs === 0) return;
    if (!this.channel?.addEventListener) {
      await this.wait(delayMs);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let active = true;
      const finish = () => {
        if (!active) return;
        active = false;
        const waiters = this.settledWaiters.get(key);
        waiters?.delete(finish);
        if (waiters?.size === 0) this.settledWaiters.delete(key);
        resolve();
      };
      const waiters = this.settledWaiters.get(key) || new Set<() => void>();
      waiters.add(finish);
      this.settledWaiters.set(key, waiters);
      this.wait(delayMs).then(finish, (error: unknown) => {
        if (!active) return;
        active = false;
        waiters.delete(finish);
        if (waiters.size === 0) this.settledWaiters.delete(key);
        reject(error);
      });
    });
  }
}

export class InMemoryAlertClaimStore implements AlertClaimStore {
  private readonly claims = new Map<string, StoredAlertClaim>();
  private readonly ttlMs: number;
  private readonly maxRecords: number;

  constructor(options: AlertClaimStoreOptions = {}) {
    const normalized = normalizeStoreOptions(options);
    this.ttlMs = normalized.ttlMs;
    this.maxRecords = normalized.maxRecords;
  }

  async prepare(
    key: string,
    readyAt: number,
    now = Date.now()
  ): Promise<PreparedAlertClaim> {
    const existing = this.getActiveClaim(key, now);
    if (existing) {
      this.compact(now, key);
      return normalizeStoredClaim(existing);
    }
    const claim = createStoredClaim(key, "pending", now, this.ttlMs, readyAt);
    this.claims.set(key, claim);
    this.compact(now, key);
    return normalizeStoredClaim(claim);
  }

  async suppress(key: string, now = Date.now()): Promise<boolean> {
    const existing = this.getActiveClaim(key, now);
    if (existing && normalizeStoredClaim(existing).state === "alerted") {
      this.compact(now, key);
      return false;
    }
    this.claims.set(key, createStoredClaim(key, "suppressed", now, this.ttlMs));
    this.compact(now, key);
    return true;
  }

  async commit(key: string, now = Date.now()): Promise<boolean> {
    const existing = this.getActiveClaim(key, now);
    if (!existing) {
      this.compact(now);
      return false;
    }
    const normalized = normalizeStoredClaim(existing);
    if (normalized.state !== "pending" || normalized.readyAt > now) {
      this.compact(now, key);
      return false;
    }
    this.claims.set(key, createStoredClaim(key, "alerted", now, this.ttlMs));
    this.compact(now, key);
    return true;
  }

  private getActiveClaim(
    key: string,
    now: number
  ): StoredAlertClaim | undefined {
    const claim = this.claims.get(key);
    if (!claim || claim.expiresAt <= now) {
      this.claims.delete(key);
      return undefined;
    }
    return claim;
  }

  private compact(now: number, preserveKey?: string): void {
    for (const [key, claim] of this.claims) {
      if (claim.expiresAt <= now) this.claims.delete(key);
    }
    while (this.claims.size > this.maxRecords) {
      let oldest: StoredAlertClaim | undefined;
      for (const claim of this.claims.values()) {
        if (claim.key === preserveKey) continue;
        if (!oldest || claim.expiresAt < oldest.expiresAt) oldest = claim;
      }
      if (!oldest) break;
      this.claims.delete(oldest.key);
    }
  }
}

class ResilientAlertClaimStore implements AlertClaimStore {
  private readonly backendByKey = new Map<string, "primary" | "fallback">();

  constructor(
    private readonly primary: AlertClaimStore,
    private readonly fallback: AlertClaimStore
  ) {}

  private rememberBackend(key: string, backend: "primary" | "fallback"): void {
    this.backendByKey.delete(key);
    this.backendByKey.set(key, backend);
    if (this.backendByKey.size > DEFAULT_MAX_CLAIM_RECORDS) {
      const oldest = this.backendByKey.keys().next().value;
      if (oldest !== undefined) this.backendByKey.delete(oldest);
    }
  }

  async prepare(
    key: string,
    readyAt: number,
    now = Date.now()
  ): Promise<PreparedAlertClaim> {
    if (this.backendByKey.get(key) === "fallback") {
      return this.fallback.prepare(key, readyAt, now);
    }
    try {
      const prepared = await this.primary.prepare(key, readyAt, now);
      this.rememberBackend(key, "primary");
      return prepared;
    } catch {
      this.rememberBackend(key, "fallback");
      return this.fallback.prepare(key, readyAt, now);
    }
  }

  async suppress(key: string, now = Date.now()): Promise<boolean> {
    if (this.backendByKey.get(key) === "fallback") {
      return this.fallback.suppress(key, now);
    }
    try {
      return await this.primary.suppress(key, now);
    } catch {
      this.rememberBackend(key, "fallback");
      return this.fallback.suppress(key, now);
    }
  }

  async commit(key: string, now = Date.now()): Promise<boolean> {
    if (this.backendByKey.get(key) === "fallback") {
      return this.fallback.commit(key, now);
    }
    try {
      return await this.primary.commit(key, now);
    } catch {
      this.rememberBackend(key, "fallback");
      // A primary failure can occur after prepare succeeded. Seed the same
      // pending decision in memory before committing so this request does not
      // silently disappear merely because IndexedDB failed mid-flight.
      await this.fallback.prepare(key, now, now);
      return this.fallback.commit(key, now);
    }
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function runInTransaction<T>(
  transaction: IDBTransaction,
  operation: () => Promise<T>
): Promise<T> {
  const completed = transactionToPromise(transaction);
  try {
    const result = await operation();
    await completed;
    return result;
  } catch (error) {
    // Always observe transaction completion/abort. Otherwise a request or
    // cursor failure can leave the separately-created completion promise as an
    // unhandled rejection while the resilient store falls back successfully.
    try {
      await completed;
    } catch {
      // Preserve the original operation error.
    }
    throw error;
  }
}

function deleteCursorRecords(
  request: IDBRequest<IDBCursorWithValue | null>,
  shouldDelete: (claim: StoredAlertClaim) => boolean,
  limit = Number.POSITIVE_INFINITY
): Promise<number> {
  return new Promise((resolve, reject) => {
    let deleted = 0;
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || deleted >= limit) {
        resolve(deleted);
        return;
      }
      const claim = cursor.value as StoredAlertClaim;
      if (shouldDelete(claim)) {
        cursor.delete();
        deleted += 1;
      }
      cursor.continue();
    };
  });
}

export class IndexedDbAlertClaimStore implements AlertClaimStore {
  private databasePromise?: Promise<IDBDatabase>;
  private readonly ttlMs: number;
  private readonly maxRecords: number;

  constructor(
    private readonly indexedDb: IDBFactory,
    options: AlertClaimStoreOptions = {}
  ) {
    const normalized = normalizeStoreOptions(options);
    this.ttlMs = normalized.ttlMs;
    this.maxRecords = normalized.maxRecords;
  }

  async prepare(
    key: string,
    readyAt: number,
    now = Date.now()
  ): Promise<PreparedAlertClaim> {
    const database = await this.openDatabase();
    const transaction = database.transaction(CLAIM_STORE, "readwrite");
    return runInTransaction(transaction, async () => {
      const store = transaction.objectStore(CLAIM_STORE);
      const existing = await requestToPromise(
        store.get(key) as IDBRequest<StoredAlertClaim | undefined>
      );
      let prepared: PreparedAlertClaim;
      if (existing && existing.expiresAt > now) {
        prepared = normalizeStoredClaim(existing);
      } else {
        const claim = createStoredClaim(
          key,
          "pending",
          now,
          this.ttlMs,
          readyAt
        );
        store.put(claim);
        prepared = normalizeStoredClaim(claim);
      }
      await this.compact(store, now, key);
      return prepared;
    });
  }

  async suppress(key: string, now = Date.now()): Promise<boolean> {
    const database = await this.openDatabase();
    const transaction = database.transaction(CLAIM_STORE, "readwrite");
    return runInTransaction(transaction, async () => {
      const store = transaction.objectStore(CLAIM_STORE);
      const existing = await requestToPromise(
        store.get(key) as IDBRequest<StoredAlertClaim | undefined>
      );
      const active =
        existing && existing.expiresAt > now ? existing : undefined;
      const canSuppress =
        !active || normalizeStoredClaim(active).state !== "alerted";
      if (canSuppress) {
        store.put(createStoredClaim(key, "suppressed", now, this.ttlMs));
      }
      await this.compact(store, now, key);
      return canSuppress;
    });
  }

  async commit(key: string, now = Date.now()): Promise<boolean> {
    const database = await this.openDatabase();
    const transaction = database.transaction(CLAIM_STORE, "readwrite");
    return runInTransaction(transaction, async () => {
      const store = transaction.objectStore(CLAIM_STORE);
      const existing = await requestToPromise(
        store.get(key) as IDBRequest<StoredAlertClaim | undefined>
      );
      const normalized =
        existing && existing.expiresAt > now
          ? normalizeStoredClaim(existing)
          : undefined;
      const canCommit =
        normalized?.state === "pending" && normalized.readyAt <= now;
      if (canCommit) {
        store.put(createStoredClaim(key, "alerted", now, this.ttlMs));
      }
      await this.compact(store, now, canCommit ? key : undefined);
      return canCommit;
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(CLAIM_STORE)
          ? request.transaction!.objectStore(CLAIM_STORE)
          : database.createObjectStore(CLAIM_STORE, { keyPath: "key" });
        if (!store.indexNames.contains(EXPIRES_INDEX)) {
          store.createIndex(EXPIRES_INDEX, "expiresAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.databasePromise;
  }

  private async compact(
    store: IDBObjectStore,
    now: number,
    preserveKey?: string
  ): Promise<void> {
    await deleteCursorRecords(
      store.index(EXPIRES_INDEX).openCursor(IDBKeyRange.upperBound(now)),
      () => true
    );

    let count = await requestToPromise(store.count());
    if (count <= this.maxRecords) return;

    const excess = count - this.maxRecords;
    await deleteCursorRecords(
      store.index(EXPIRES_INDEX).openCursor(),
      (claim) => claim.key !== preserveKey,
      excess
    );

    // Records with malformed/missing expiresAt values are absent from the
    // index. Fall back to the object-store cursor so the hard cap still holds.
    count = await requestToPromise(store.count());
    if (count > this.maxRecords) {
      await deleteCursorRecords(
        store.openCursor(),
        (claim) => claim.key !== preserveKey,
        count - this.maxRecords
      );
    }
  }
}

export function createBrowserSingleAlertCoordinator(): SingleAlertCoordinator {
  const memoryStore = new InMemoryAlertClaimStore();
  const claimStore =
    typeof indexedDB === "undefined"
      ? memoryStore
      : new ResilientAlertClaimStore(
          new IndexedDbAlertClaimStore(indexedDB),
          memoryStore
        );
  const BrowserBroadcastChannel =
    typeof window === "undefined" ? undefined : window.BroadcastChannel;
  const channel = !BrowserBroadcastChannel
    ? undefined
    : new BrowserBroadcastChannel("octo-message-attention");
  return new SingleAlertCoordinator({ claimStore, channel });
}

let browserSingleAlertCoordinator: SingleAlertCoordinator | undefined;

export function getBrowserSingleAlertCoordinator(): SingleAlertCoordinator {
  if (!browserSingleAlertCoordinator) {
    browserSingleAlertCoordinator = createBrowserSingleAlertCoordinator();
  }
  return browserSingleAlertCoordinator;
}
