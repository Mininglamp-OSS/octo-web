import { DraftDatabase, type DraftSession } from "./database";
import {
  cleanDraftDocument,
  emptyConversationDraft,
  mergeConflictingDrafts,
  conversationDraftPreview,
  draftAccountKey,
  draftKey,
  draftScopeKey,
  type ConversationDraft,
  type DraftChannel,
  type DraftRecord,
  type DraftScope,
} from "./model";

export interface DraftChange {
  scope: string;
  key?: string;
}

/** Shared across composer unmounts. The list reads metadata, never attachment blobs. */
export class ConversationDraftRepository {
  readonly records = new Map<string, DraftRecord>();
  private documentOwners = new Map<string, AbortSignal | undefined>();
  private queues = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  private revisions = new Map<string, number>();
  private listeners = new Set<(change?: DraftChange) => void>();
  private epochs = new Map<string, number>();
  private loadedScopes = new Map<string, Promise<void>>();
  private sessions = new Map<string, Promise<DraftSession>>();
  private revocations?: BroadcastChannel;
  private fileTasks = new Map<string, Array<() => Promise<void>>>();
  constructor(readonly database = new DraftDatabase()) {}
  subscribe = (listener: (change?: DraftChange) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify(change?: DraftChange) {
    this.listeners.forEach((listener) => listener(change));
  }
  session(scope: DraftScope): Promise<DraftSession> {
    const account = draftAccountKey(scope);
    let session = this.sessions.get(account);
    if (!session) {
      session = this.database.session(account);
      this.sessions.set(account, session);
      // Keep failed captures pinned too: retrying could observe another
      // window's post-logout generation and authorize an old port. Ordinary
      // document reads remain retryable; an unknown session must use temporary
      // operation or a newly authenticated repository session.
      void session.catch(() => {});
    }
    if (
      !this.revocations &&
      typeof window !== "undefined" &&
      typeof window.BroadcastChannel === "function"
    ) {
      try {
        this.revocations = new window.BroadcastChannel(
          this.database.name + ":revocations"
        );
        this.revocations.onmessage = (event) => {
          const { account, generation } = event.data ?? {};
          if (typeof account !== "string" || typeof generation !== "number")
            return;
          const captured = this.sessions.get(account);
          void captured
            ?.then((session) => {
              if (session.generation < generation)
                this.invalidateAccount(account);
            })
            .catch(() => {});
        };
      } catch {
        // Notifications are optional; transaction-level generation checks still fence writers.
      }
    }
    return session;
  }
  private invalidateAccount(account: string) {
    this.epochs.set(account, (this.epochs.get(account) ?? 0) + 1);
    for (const [key, record] of this.records)
      if (record.account === account) {
        this.records.delete(key);
        this.documentOwners.delete(key);
        this.revisions.delete(key);
        this.failed.delete(key);
      }
    this.loadedScopes.clear();
    this.notify();
  }
  epoch(scope: DraftScope) {
    return this.epochs.get(draftAccountKey(scope)) ?? 0;
  }
  active(scope: DraftScope, epoch: number) {
    return this.epoch(scope) === epoch;
  }
  preview(scope: DraftScope, channel: DraftChannel) {
    return this.records.get(draftKey(scope, channel))?.preview;
  }
  durableRevision(scope: DraftScope, channel: DraftChannel) {
    return this.revisions.get(draftKey(scope, channel)) ?? 0;
  }
  loadScope(scope: DraftScope): Promise<void> {
    const key = draftScopeKey(scope);
    const epoch = this.epoch(scope);
    let loading = this.loadedScopes.get(key);
    if (!loading) {
      loading = this.session(scope)
        .then(() => this.database.list<DraftRecord>("drafts", "scope", key))
        .then((records) => {
          if (!this.active(scope, epoch)) return;
          records.forEach((record) => {
            if (!this.records.has(record.key)) {
              this.records.set(record.key, record);
              this.revisions.set(record.key, record.revision);
            }
          });
          this.notify({ scope: key });
        })
        .catch((error) => {
          this.loadedScopes.delete(key);
          throw error;
        });
      this.loadedScopes.set(key, loading);
    }
    return loading;
  }
  async load(
    scope: DraftScope,
    channel: DraftChannel
  ): Promise<ConversationDraft | undefined> {
    await this.loadScope(scope);
    return this.records.get(draftKey(scope, channel))?.draft;
  }
  save(
    scope: DraftScope,
    channel: DraftChannel,
    draft: ConversationDraft,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    const key = draftKey(scope, channel);
    const epoch = this.epoch(scope);
    const session = this.session(scope);
    const cleaned = {
      document: cleanDraftDocument(draft.document),
      topAttachments: draft.topAttachments.map((item) => ({ ...item })),
      ...(draft.recoveredAttemptIds?.length
        ? { recoveredAttemptIds: [...draft.recoveredAttemptIds] }
        : {}),
    };
    const previous = this.records.get(key);
    if (
      previous &&
      JSON.stringify(previous.draft) === JSON.stringify(cleaned) &&
      !this.failed.has(key) &&
      (!this.queues.has(key) || this.documentOwners.get(key) === signal)
    )
      return this.flush(key);
    const record: DraftRecord = {
      key,
      scope: draftScopeKey(scope),
      account: draftAccountKey(scope),
      revision: (previous?.revision ?? 0) + 1,
      draft: cleaned,
      preview: conversationDraftPreview(cleaned),
    };
    this.records.set(key, record);
    this.documentOwners.set(key, signal);
    if (previous?.preview !== record.preview)
      this.notify({ scope: record.scope, key });
    return this.enqueue(key, async () => {
      if (!this.active(scope, epoch) || signal?.aborted) return;
      try {
        const expected = this.revisions.get(key) ?? 0;
        record.revision = expected + 1;
        await this.database.writeDraft(record, expected, await session, signal);
        if (this.active(scope, epoch) && !signal?.aborted) {
          this.revisions.set(key, record.revision);
          this.failed.delete(key);
        }
      } catch (error) {
        // An explicitly abandoned compose must not poison later writers.
        if (signal?.aborted) return;
        if (this.active(scope, epoch)) this.failed.add(key);
        throw error;
      }
    });
  }
  forgetCancelledDocument(scope: DraftScope, channel: DraftChannel, signal: AbortSignal) {
    const key = draftKey(scope, channel);
    if (!signal.aborted || this.documentOwners.get(key) !== signal) return;
    // A new composer must reload the durable copy, not the abandoned optimistic
    // snapshot. Never evict another composer's newer snapshot.
    this.documentOwners.delete(key);
    this.records.delete(key);
    this.revisions.delete(key);
    this.failed.delete(key);
    this.loadedScopes.delete(draftScopeKey(scope));
    this.notify({ scope: draftScopeKey(scope), key });
    // Refresh inactive-row previews too, without overwriting a newer owner.
    void this.loadScope(scope).catch(() => {});
  }
  async consumeDocument(
    scope: DraftScope,
    channel: DraftChannel,
    expectedRevision: number
  ) {
    const key = draftKey(scope, channel);
    const epoch = this.epoch(scope);
    const tombstone = await this.database.consumeDraft(
      {
        key,
        scope: draftScopeKey(scope),
        account: draftAccountKey(scope),
        revision: expectedRevision + 1,
        draft: emptyConversationDraft(),
        preview: "",
        consumed: true,
      },
      expectedRevision,
      await this.session(scope)
    );
    if (!this.active(scope, epoch)) return;
    this.revisions.set(key, tombstone.revision);
    const current = this.records.get(key);
    if (!current || current.revision <= expectedRevision) {
      this.records.set(key, tombstone);
      this.documentOwners.delete(key);
      this.failed.delete(key);
      this.notify({ scope: draftScopeKey(scope), key });
    }
  }
  async mergeConflict(
    scope: DraftScope,
    channel: DraftChannel,
    local: ConversationDraft,
    signal?: AbortSignal
  ) {
    const key = draftKey(scope, channel);
    const epoch = this.epoch(scope);
    await this.flush(key).catch(() => {});
    const latest = await this.database.read<DraftRecord>("drafts", key);
    if (signal?.aborted) return;
    if (!this.active(scope, epoch)) throw new Error("Draft session expired");
    this.revisions.set(key, latest?.revision ?? 0);
    const merged =
      latest && JSON.stringify(latest.draft) !== JSON.stringify(local)
        ? mergeConflictingDrafts(local, latest.draft, latest.revision)
        : local;
    // Force a CAS write even if the local in-memory snapshot did not change.
    this.failed.add(key);
    await this.save(scope, channel, merged, signal);
  }
  enqueue(
    key: string,
    action: () => Promise<void>,
    retryOnFailure = true
  ): Promise<void> {
    // File mutations retain ownership until acknowledgement, including failed
    // remove/settle operations across editor unmounts. Documents can supersede
    // older failed snapshots; file deletions cannot be forgotten that way.
    let run = action;
    if (key.endsWith(":files")) {
      const tasks = this.fileTasks.get(key) ?? [];
      this.fileTasks.set(key, tasks);
      const task = async () => {
        try {
          await action();
        } catch (error) {
          if (!retryOnFailure) tasks.splice(tasks.indexOf(task), 1);
          throw error;
        }
      };
      tasks.push(task);
      run = async () => {
        while (tasks.includes(task)) {
          await tasks[0]();
          tasks.shift();
        }
        if (!tasks.length && this.fileTasks.get(key) === tasks)
          this.fileTasks.delete(key);
      };
    }
    const pending = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(run)
      .then(
        () => {
          if (this.queues.get(key) === pending) this.failed.delete(key);
        },
        (error) => {
          if (this.queues.get(key) === pending) this.failed.add(key);
          throw error;
        }
      );
    this.queues.set(key, pending);
    void pending
      .catch(() => {})
      .finally(() => {
        if (this.queues.get(key) === pending) this.queues.delete(key);
      });
    return pending;
  }
  async flush(key: string) {
    if (this.failed.has(key) && this.fileTasks.has(key))
      await this.enqueue(key, async () => {});
    let pending = this.queues.get(key);
    while (pending) {
      await pending;
      const next = this.queues.get(key);
      if (next === pending) break;
      pending = next;
    }
    if (this.failed.has(key)) throw new Error("Draft has not been saved");
  }
  saved(key: string) {
    return !this.queues.has(key) && !this.failed.has(key);
  }
  async clearAccount(scope: DraftScope) {
    void this.session(scope).catch(() => {});
    const account = draftAccountKey(scope);
    this.invalidateAccount(account);
    const prefix =
      JSON.stringify([scope.server, scope.account]).slice(0, -1) + ",";
    for (const key of new Set([
      ...this.queues.keys(),
      ...this.fileTasks.keys(),
      ...this.failed,
    ])) {
      if (key.startsWith(prefix)) {
        this.queues.delete(key);
        this.fileTasks.delete(key);
        this.failed.delete(key);
      }
    }
    // Do not wait for suspended writers. The shared generation and deletion
    // commit atomically; every late writer is fenced inside its transaction.
    const cleanup = this.database.clearAccount(account);
    const nextSession = cleanup.then(() => this.database.session(account));
    this.sessions.set(account, nextSession);
    void nextSession.catch(() => {});
    await cleanup;
    this.revocations?.postMessage(await nextSession);
  }
}
export const conversationDrafts = new ConversationDraftRepository();
