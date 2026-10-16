import {
  emptyConversationDraft,
  type ConversationDraft,
  type DraftRecord,
} from "./model";

export class DraftConflictError extends Error {
  constructor() {
    super("Draft changed in another window");
    this.name = "DraftConflictError";
  }
}

export class DraftSessionExpiredError extends Error {
  constructor() {
    super("Draft session expired");
    this.name = "DraftSessionExpiredError";
  }
}

export interface DraftSession {
  account: string;
  generation: number;
}

interface AttachmentIntent {
  key: string;
  conversation: string;
  account: string;
  removed: boolean;
  revision?: string;
}

const attachmentIntentKey = (conversation: string, id: string, revision: string) =>
  JSON.stringify([conversation, id, revision]);

function attachmentIds(draft?: ConversationDraft): Set<string> {
  const ids = new Set(draft?.topAttachments.map((item) => item.id));
  const visit = (node: ConversationDraft["document"]) => {
    if (node.type === "attachment" && typeof node.attrs?.id === "string")
      ids.add(node.attrs.id);
    node.content?.forEach(visit);
  };
  if (draft) visit(draft.document);
  return ids;
}

export interface StoredAttachment {
  key: string;
  conversation: string;
  account: string;
  id: string;
  file: Blob;
  name: string;
  lastModified: number;
  revision: string;
  source: "upload" | "paste";
  position: number;
  reserved?: string;
}

export class DraftDatabase {
  private opening?: Promise<IDBDatabase>;
  private connection?: IDBDatabase;
  constructor(
    private readonly factory: () => IDBFactory = () => indexedDB,
    readonly name = "octo-conversation-drafts"
  ) {}

  private open(): Promise<IDBDatabase> {
    return (this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory().open(this.name, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("drafts")) {
          const drafts = db.createObjectStore("drafts", { keyPath: "key" });
          drafts.createIndex("scope", "scope");
          drafts.createIndex("account", "account");
          const files = db.createObjectStore("attachments", { keyPath: "key" });
          files.createIndex("conversation", "conversation");
          files.createIndex("account", "account");
        }
        if (!db.objectStoreNames.contains("accounts"))
          db.createObjectStore("accounts", { keyPath: "account" });
        if (!db.objectStoreNames.contains("attachmentIntents")) {
          const intents = db.createObjectStore("attachmentIntents", {
            keyPath: "key",
          });
          intents.createIndex("conversation", "conversation");
          intents.createIndex("account", "account");
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        this.connection = db;
        db.onclose = () => this.invalidateConnection(db);
        db.onversionchange = () => {
          db.close();
          this.invalidateConnection(db);
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Draft database is blocked"));
    }).catch((error) => {
      this.opening = undefined;
      throw error;
    }));
  }

  private invalidateConnection(db: IDBDatabase): void {
    // A delayed close event from an older handle cannot evict its replacement.
    if (this.connection !== db) return;
    this.connection = undefined;
    this.opening = undefined;
  }

  private async transaction(
    stores: string | string[],
    mode: IDBTransactionMode = "readonly",
    signal?: AbortSignal
  ): Promise<IDBTransaction> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const db = await this.open();
      signal?.throwIfAborted();
      try {
        return db.transaction(stores, mode);
      } catch (error) {
        if ((error as { name?: string })?.name !== "InvalidStateError") throw error;
        this.invalidateConnection(db);
        // The close event may not have arrived yet. Retry transaction creation
        // once, before any work has started; never replay an uncertain write.
        if (attempt === 1) throw error;
      }
    }
  }

  async read<T>(
    store: "drafts" | "attachments",
    key: string
  ): Promise<T | undefined> {
    const tx = await this.transaction(store);
    return new Promise((resolve, reject) => {
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async list<T>(
    store: "drafts" | "attachments",
    index: string,
    value: string
  ): Promise<T[]> {
    const tx = await this.transaction(store);
    return new Promise((resolve, reject) => {
      const request = tx
        .objectStore(store)
        .index(index)
        .getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async session(account: string): Promise<DraftSession> {
    const tx = await this.transaction("accounts");
    return new Promise((resolve, reject) => {
      const request = tx
        .objectStore("accounts")
        .get(account);
      request.onsuccess = () =>
        resolve({ account, generation: request.result?.generation ?? 0 });
      request.onerror = () => reject(request.error);
    });
  }

  /** The generation check and mutation share a transaction with logout. A
   * suspended writer either commits before cleanup, or is rejected afterwards. */
  private async mutate<T>(
    stores: string[],
    session: DraftSession | undefined,
    change: (
      tx: IDBTransaction,
      result: (value: T) => void,
      fail: (error: unknown) => void
    ) => void,
    signal?: AbortSignal
  ): Promise<T> {
    const tx = await this.transaction(
      [...new Set([...stores, "accounts"])], "readwrite", signal
    );
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      let value: T;
      let failure: unknown;
      const fail = (error: unknown) => {
        failure = error;
        // The transaction may already have committed before cancellation.
        // Its oncomplete event still settles the mutation in that case.
        try { tx.abort(); } catch { /* already finished */ }
      };
      const cancel = () => fail(signal!.reason);
      const release = () => signal?.removeEventListener("abort", cancel);
      signal?.addEventListener("abort", cancel, { once: true });
      const apply = () => {
        try {
          change(
            tx,
            (next) => {
              value = next;
            },
            fail
          );
        } catch (error) {
          fail(error);
        }
      };
      if (session) {
        const request = tx.objectStore("accounts").get(session.account);
        request.onsuccess = () => {
          if ((request.result?.generation ?? 0) !== session.generation) {
            failure = new DraftSessionExpiredError();
            tx.abort();
          } else apply();
        };
      } else apply();
      tx.oncomplete = () => { release(); resolve(value!); };
      tx.onabort = tx.onerror = () => {
        release();
        reject(failure ?? tx.error ?? new Error("Draft write failed"));
      };
    });
  }

  async writeDraft(
    record: DraftRecord,
    expectedRevision: number,
    session: DraftSession,
    signal?: AbortSignal,
    attachmentRevisions?: ReadonlyMap<string, readonly string[]>
  ): Promise<void> {
    let conflict = false;
    // Membership changes and the document commit together, even if blob cleanup fails.
    await this.mutate<void>(["drafts", "attachmentIntents"], session, (tx) => {
      const store = tx.objectStore("drafts");
      const request = store.get(record.key);
      request.onsuccess = () => {
        if ((request.result?.revision ?? 0) !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        const previous = attachmentIds(request.result?.draft);
        const current = attachmentIds(record.draft);
        const intents = tx.objectStore("attachmentIntents");
        for (const id of new Set([...previous, ...current])) {
          // The writer owns a particular incarnation, not every future file
          // with this ID. Unknown bytes (including native-owned files) are not
          // evidence that a browser generation should be hidden.
          for (const revision of attachmentRevisions?.get(id) ?? []) {
            intents.put({
              key: attachmentIntentKey(record.key, id, revision),
              conversation: record.key,
              account: record.account,
              removed: !current.has(id),
              revision,
            } satisfies AttachmentIntent);
          }
        }
        store.put(record);
      };
    }, signal).catch((error) => {
      throw conflict ? new DraftConflictError() : error;
    });
  }

  async consumeDraft(
    record: DraftRecord,
    expectedRevision: number,
    session: DraftSession,
    retainedAttachmentIds: readonly string[] = [],
    attachmentRevisions?: ReadonlyMap<string, string>
  ): Promise<DraftRecord> {
    let conflict = false;
    const retained = new Set(retainedAttachmentIds);
    return this.mutate<DraftRecord>(
      ["drafts", "attachmentIntents", "attachments"],
      session,
      (tx, result) => {
        const store = tx.objectStore("drafts");
        const request = store.get(record.key);
        request.onsuccess = () => {
          const current = request.result as DraftRecord | undefined;
          const alreadyConsumed =
            current?.consumed && current.revision === expectedRevision + 1;
          if (!alreadyConsumed && (current?.revision ?? 0) !== expectedRevision) {
            conflict = true;
            tx.abort();
            return;
          }
          const consume = (revisions: ReadonlyMap<string, string>) => {
            const membership = alreadyConsumed
              ? retained
              : new Set([...attachmentIds(current?.draft), ...retained]);
            const intents = tx.objectStore("attachmentIntents");
            membership.forEach((id) => {
              const revision = revisions.get(id);
              // Without a concrete blob generation there is nothing durable to
              // delete, and a revisionless intent could hide a later replacement.
              if (!revision) return;
              intents.put({
                key: attachmentIntentKey(record.key, id, revision),
                conversation: record.key,
                account: record.account,
                removed: !retained.has(id),
                revision,
              } satisfies AttachmentIntent);
            });
            if (alreadyConsumed) {
              result(current);
              return;
            }
            const tombstone: DraftRecord = {
              ...record,
              revision: expectedRevision + 1,
              draft: emptyConversationDraft(),
              preview: "",
              consumed: true,
            };
            store.put(tombstone);
            result(tombstone);
          };
          const files = tx
            .objectStore("attachments")
            .index("conversation")
            .getAll(record.key);
          files.onsuccess = () =>
            consume(
              new Map(
                (files.result as StoredAttachment[])
                  .filter((item) =>
                    !attachmentRevisions ||
                    attachmentRevisions.get(item.id) === item.revision
                  )
                  .map((item) => [item.id, item.revision])
              )
            );
        };
      }
    ).catch((error) => {
      throw conflict ? new DraftConflictError() : error;
    });
  }

  async changeAttachments(
    conversation: string,
    change: (records: StoredAttachment[]) => StoredAttachment[],
    session: DraftSession
  ): Promise<StoredAttachment[]> {
    return this.mutate<StoredAttachment[]>(
      ["attachments", "attachmentIntents"],
      session,
      (tx, result, fail) => {
        const store = tx.objectStore("attachments");
        const request = store.index("conversation").getAll(conversation);
        const intents = tx.objectStore("attachmentIntents");
        const intentRequest = intents.index("conversation").getAll(conversation);
        intentRequest.onsuccess = () => {
          try {
            const previous: StoredAttachment[] = request.result;
            const decisions = new Map<string, AttachmentIntent>(
              intentRequest.result.map((intent: AttachmentIntent) => [intent.key, intent])
            );
            const updated = change(previous).flatMap((item) => {
              const old = previous.find(record => record.key === item.key);
              if (old?.revision === item.revision) return [item];
              const intent = decisions.get(attachmentIntentKey(conversation, item.id, item.revision))
                ?? decisions.get(item.key);
              // A stage accepted before removal keeps its revision on retry.
              // Do not let that late write recreate the removed generation.
              if (intent?.removed && intent.revision === item.revision)
                return old ? [old] : [];
              // Pre-fix revisionless tombstones cannot own a new generation.
              if (intent?.removed && !intent.revision) intents.delete(item.key);
              return [item];
            });
            const remaining = new Set(updated.map((item) => item.key));
            previous.forEach((item) => {
              if (!remaining.has(item.key)) store.delete(item.key);
            });
            updated.forEach((item) => store.put(item));
            result(updated);
          } catch (error) {
            fail(error);
          }
        };
      }
    );
  }

  async setAttachmentPresence(
    conversation: string,
    id: string,
    present: boolean,
    session: DraftSession,
    revision?: string
  ): Promise<void> {
    // Pending stages have their own revisions. Without one, removal has no
    // authority to hide either current bytes or a later same-ID replacement.
    if (!present && !revision) return;
    await this.mutate<void>(
      ["attachmentIntents", "attachments"],
      session,
      (tx) => {
        const key = JSON.stringify([conversation, id]);
        const request = tx.objectStore("attachments").get(key);
        request.onsuccess = () => {
          if (revision && request.result?.revision !== revision) return;
          const ownedRevision = revision ?? request.result?.revision;
          if (!ownedRevision) return;
          tx.objectStore("attachmentIntents").put({
            key: attachmentIntentKey(conversation, id, ownedRevision),
            conversation,
            account: session.account,
            removed: !present,
            revision: ownedRevision,
          } satisfies AttachmentIntent);
        };
      }
    );
  }

  /** Explicit recovery of the exact reservations shown to the user. A late
   * settlement or another window's newer reservation must not be changed. */
  async recoverAttachmentReservations(
    reservations: StoredAttachment[],
    session: DraftSession,
    revision: () => string
  ): Promise<void> {
    await this.mutate<void>(["attachments", "attachmentIntents"], session, (tx, _result, fail) => {
      const files = tx.objectStore("attachments");
      for (const snapshot of reservations) {
        const request = files.get(snapshot.key);
        request.onsuccess = () => {
          try {
            const current: StoredAttachment | undefined = request.result;
            if (!current?.reserved || current.reserved !== snapshot.reserved ||
                current.revision !== snapshot.revision) return;
            const recovered = { ...current, revision: revision() };
            delete recovered.reserved;
            files.put(recovered);
            // Sending may already have saved a document without this file.
            // The explicit recovery decision supersedes that removal intent.
            tx.objectStore("attachmentIntents").put({
              key: attachmentIntentKey(current.conversation, current.id, recovered.revision),
              conversation: current.conversation,
              account: current.account, removed: false, revision: recovered.revision,
            } satisfies AttachmentIntent);
          } catch (error) { fail(error); }
        };
      }
    });
  }

  async restoreAttachments(conversation: string): Promise<StoredAttachment[]> {
    const tx = await this.transaction(["attachments", "attachmentIntents"]);
    return new Promise((resolve, reject) => {
      const files = tx
        .objectStore("attachments")
        .index("conversation")
        .getAll(conversation);
      const intents = tx
        .objectStore("attachmentIntents")
        .index("conversation")
        .getAll(conversation);
      tx.oncomplete = () => {
        const decisions = new Map<string, AttachmentIntent>(
          intents.result.map((item: AttachmentIntent) => [item.key, item])
        );
        resolve(
          (files.result as StoredAttachment[])
            .filter((item) => {
              const intent = decisions.get(attachmentIntentKey(conversation, item.id, item.revision))
                ?? decisions.get(item.key);
              return (
                !item.reserved &&
                !(
                  intent?.removed &&
                  (!intent.revision || intent.revision === item.revision)
                )
              );
            })
            .sort((a, b) => a.position - b.position)
        );
      };
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }

  async clearAccount(account: string): Promise<void> {
    await this.mutate<void>(
      ["drafts", "attachments", "attachmentIntents"],
      undefined,
      (tx) => {
        const accounts = tx.objectStore("accounts");
        const generation = accounts.get(account);
        generation.onsuccess = () =>
          accounts.put({
            account,
            generation: (generation.result?.generation ?? 0) + 1,
          });
        for (const name of ["drafts", "attachments", "attachmentIntents"]) {
          const request = tx
            .objectStore(name)
            .index("account")
            .openCursor(account);
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
        }
      }
    );
  }
}
