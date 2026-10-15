import type { DraftRecord } from "./model";

export class DraftConflictError extends Error {
  constructor() {
    super("Draft changed in another window");
    this.name = "DraftConflictError";
  }
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
    private readonly name = "octo-conversation-drafts"
  ) {}

  private open(): Promise<IDBDatabase> {
    return (this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory().open(this.name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const drafts = db.createObjectStore("drafts", { keyPath: "key" });
        drafts.createIndex("scope", "scope");
        drafts.createIndex("account", "account");
        const files = db.createObjectStore("attachments", { keyPath: "key" });
        files.createIndex("conversation", "conversation");
        files.createIndex("account", "account");
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
  async write(
    store: "drafts" | "attachments",
    records: (DraftRecord | StoredAttachment)[],
    remove: string[] = []
  ): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const target = tx.objectStore(store);
      records.forEach((record) => target.put(record));
      remove.forEach((key) => target.delete(key));
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error("Draft write failed"));
    });
  }
  async writeDraft(
    record: DraftRecord,
    expectedRevision: number
  ): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts");
      const request = store.get(record.key);
      let conflict = false;
      request.onsuccess = () => {
        if ((request.result?.revision ?? 0) !== expectedRevision) {
          conflict = true;
          tx.abort();
        } else store.put(record);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          conflict
            ? new DraftConflictError()
            : tx.error ?? new Error("Draft write failed")
        );
    });
  }
  async changeAttachments(
    conversation: string,
    change: (records: StoredAttachment[]) => StoredAttachment[]
  ): Promise<StoredAttachment[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("attachments", "readwrite");
      const store = tx.objectStore("attachments");
      const request = store.index("conversation").getAll(conversation);
      let updated: StoredAttachment[] = [];
      request.onsuccess = () => {
        try {
          const previous: StoredAttachment[] = request.result;
          updated = change(previous);
          const remaining = new Set(updated.map((item) => item.key));
          previous.forEach((item) => {
            if (!remaining.has(item.key)) store.delete(item.key);
          });
          updated.forEach((item) => store.put(item));
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      tx.oncomplete = () => resolve(updated);
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error("Attachment write failed"));
    });
  }
  async clearAccount(account: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["drafts", "attachments"], "readwrite");
      for (const name of ["drafts", "attachments"]) {
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
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
}
