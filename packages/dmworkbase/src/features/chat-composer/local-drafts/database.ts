import type { ConversationDraft, DraftRecord } from "./model";

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
        db.onversionchange = () => {
          db.close();
          this.opening = undefined;
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

  async read<T>(
    store: "drafts" | "attachments",
    key: string
  ): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async list<T>(
    store: "drafts" | "attachments",
    index: string,
    value: string
  ): Promise<T[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(store)
        .objectStore(store)
        .index(index)
        .getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async session(account: string): Promise<DraftSession> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("accounts")
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
    ) => void
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [...new Set([...stores, "accounts"])],
        "readwrite"
      );
      let value: T;
      let failure: unknown;
      const fail = (error: unknown) => {
        failure = error;
        tx.abort();
      };
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
      tx.oncomplete = () => resolve(value!);
      tx.onabort = tx.onerror = () =>
        reject(failure ?? tx.error ?? new Error("Draft write failed"));
    });
  }

  async writeDraft(
    record: DraftRecord,
    expectedRevision: number,
    session: DraftSession
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
          intents.put({
            key: JSON.stringify([record.key, id]),
            conversation: record.key,
            account: record.account,
            removed: !current.has(id),
          } satisfies AttachmentIntent);
        }
        store.put(record);
      };
    }).catch((error) => {
      throw conflict ? new DraftConflictError() : error;
    });
  }

  async changeAttachments(
    conversation: string,
    change: (records: StoredAttachment[]) => StoredAttachment[],
    session: DraftSession
  ): Promise<StoredAttachment[]> {
    return this.mutate<StoredAttachment[]>(
      ["attachments"],
      session,
      (tx, result, fail) => {
        const store = tx.objectStore("attachments");
        const request = store.index("conversation").getAll(conversation);
        request.onsuccess = () => {
          try {
            const previous: StoredAttachment[] = request.result;
            const updated = change(previous);
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
    await this.mutate<void>(
      ["attachmentIntents", "attachments"],
      session,
      (tx) => {
        const key = JSON.stringify([conversation, id]);
        const request = tx.objectStore("attachments").get(key);
        request.onsuccess = () => {
          if (revision && request.result?.revision !== revision) return;
          tx.objectStore("attachmentIntents").put({
            key,
            conversation,
            account: session.account,
            removed: !present,
            ...(revision ? { revision } : {}),
          } satisfies AttachmentIntent);
        };
      }
    );
  }

  async restoreAttachments(conversation: string): Promise<StoredAttachment[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["attachments", "attachmentIntents"]);
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
              const intent = decisions.get(item.key);
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
