import { DraftDatabase } from "./database";
import {
  cleanDraftDocument,
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
  private queues = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  private revisions = new Map<string, number>();
  private listeners = new Set<(change?: DraftChange) => void>();
  private epochs = new Map<string, number>();
  private loadedScopes = new Map<string, Promise<void>>();
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
  epoch(scope: DraftScope) {
    return this.epochs.get(draftAccountKey(scope)) ?? 0;
  }
  active(scope: DraftScope, epoch: number) {
    return this.epoch(scope) === epoch;
  }
  preview(scope: DraftScope, channel: DraftChannel) {
    return this.records.get(draftKey(scope, channel))?.preview;
  }
  loadScope(scope: DraftScope): Promise<void> {
    const key = draftScopeKey(scope);
    const epoch = this.epoch(scope);
    let loading = this.loadedScopes.get(key);
    if (!loading) {
      loading = this.database
        .list<DraftRecord>("drafts", "scope", key)
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
    draft: ConversationDraft
  ): Promise<void> {
    const key = draftKey(scope, channel);
    const epoch = this.epoch(scope);
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
      !this.failed.has(key)
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
    if (previous?.preview !== record.preview)
      this.notify({ scope: record.scope, key });
    return this.enqueue(key, async () => {
      if (!this.active(scope, epoch)) return;
      try {
        const expected = this.revisions.get(key) ?? 0;
        record.revision = expected + 1;
        await this.database.writeDraft(record, expected);
        this.revisions.set(key, record.revision);
        this.failed.delete(key);
      } catch (error) {
        this.failed.add(key);
        throw error;
      }
    });
  }
  async mergeConflict(
    scope: DraftScope,
    channel: DraftChannel,
    local: ConversationDraft
  ) {
    const key = draftKey(scope, channel);
    const epoch = this.epoch(scope);
    await this.flush(key).catch(() => {});
    const latest = await this.database.read<DraftRecord>("drafts", key);
    if (!this.active(scope, epoch)) throw new Error("Draft session expired");
    this.revisions.set(key, latest?.revision ?? 0);
    const merged =
      latest && JSON.stringify(latest.draft) !== JSON.stringify(local)
        ? mergeConflictingDrafts(local, latest.draft, latest.revision)
        : local;
    // Force a CAS write even if the local in-memory snapshot did not change.
    this.failed.add(key);
    await this.save(scope, channel, merged);
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
          this.failed.delete(key);
        },
        (error) => {
          this.failed.add(key);
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
    const account = draftAccountKey(scope);
    this.epochs.set(account, this.epoch(scope) + 1);
    for (const [key, record] of this.records)
      if (record.account === account) {
        this.records.delete(key);
        this.revisions.delete(key);
        this.failed.delete(key);
      }
    this.loadedScopes.clear();
    this.notify();
    await Promise.allSettled([...this.queues.values()]);
    const prefix =
      JSON.stringify([scope.server, scope.account]).slice(0, -1) + ",";
    for (const key of this.fileTasks.keys())
      if (key.startsWith(prefix)) {
        this.fileTasks.delete(key);
        this.failed.delete(key);
      }
    await this.database.clearAccount(account);
  }
}
export const conversationDrafts = new ConversationDraftRepository();
