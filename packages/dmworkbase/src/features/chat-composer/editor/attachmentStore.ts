export interface AttachmentStoreTopItem {
  id: string;
  previewUrl?: string;
}

export interface AttachmentStoreOptions {
  revokeObjectURL?: (url: string) => void;
}

type AttachmentStoreListener<TTop> = (items: readonly TTop[]) => void;

/**
 * Owns composer attachment resources independently from React and Tiptap.
 * Taking items transfers ownership to a send attempt; restoring transfers it
 * back. Only resources still owned by the store are released by remove/clear.
 */
export class ChatComposerAttachmentStore<
  TTop extends AttachmentStoreTopItem,
> {
  readonly attachmentFiles = new Map<string, File>();
  private topItems: TTop[] = [];
  private readonly listeners = new Set<AttachmentStoreListener<TTop>>();
  private readonly revokeObjectURL: (url: string) => void;

  constructor(options: AttachmentStoreOptions = {}) {
    this.revokeObjectURL =
      options.revokeObjectURL ??
      ((url) => {
        if (typeof URL !== "undefined" && URL.revokeObjectURL) {
          URL.revokeObjectURL(url);
        }
      });
  }

  subscribe(listener: AttachmentStoreListener<TTop>): () => void {
    this.listeners.add(listener);
    listener(this.snapshotTopAttachments());
    return () => this.listeners.delete(listener);
  }

  snapshotTopAttachments(): readonly TTop[] {
    return [...this.topItems];
  }

  addInlineFile(id: string, file: File): void {
    this.attachmentFiles.set(id, file);
  }

  appendTopAttachment(item: TTop): void {
    this.topItems = [...this.topItems, item];
    this.notify();
  }

  removeTopAttachment(id: string): boolean {
    const removed = this.topItems.filter((candidate) => candidate.id === id);
    if (removed.length === 0) return false;
    this.topItems = this.topItems.filter((candidate) => candidate.id !== id);
    const urls = new Set(
      removed.flatMap(({ previewUrl }) => (previewUrl ? [previewUrl] : [])),
    );
    urls.forEach((url) => this.revokeObjectURL(url));
    this.notify();
    return true;
  }

  /** Transfer selected top attachments from the store to a send attempt. */
  takeTopAttachments(ids?: readonly string[]): TTop[] {
    if (this.topItems.length === 0) return [];
    const wanted = ids ? new Set(ids) : undefined;
    const taken = wanted
      ? this.topItems.filter(({ id }) => wanted.has(id))
      : this.topItems;
    if (taken.length === 0) return [];
    this.topItems = wanted
      ? this.topItems.filter(({ id }) => !wanted.has(id))
      : [];
    this.notify();
    return taken;
  }

  /** Transfer attempt-owned attachments back into the composer. */
  restoreTopAttachments(items: readonly TTop[], offset = 0): number {
    if (items.length === 0) return 0;
    const seenIds = new Set(this.topItems.map(({ id }) => id));
    const fresh = items.filter(({ id }) => {
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
    if (fresh.length === 0) return 0;
    const index = Math.min(Math.max(0, offset), this.topItems.length);
    this.topItems = [
      ...this.topItems.slice(0, index),
      ...fresh,
      ...this.topItems.slice(index),
    ];
    this.notify();
    return fresh.length;
  }

  clear(): void {
    const urls = new Set(
      this.topItems.flatMap(({ previewUrl }) =>
        previewUrl ? [previewUrl] : [],
      ),
    );
    this.topItems = [];
    this.attachmentFiles.clear();
    urls.forEach((url) => this.revokeObjectURL(url));
    this.notify();
  }

  private notify(): void {
    const snapshot = this.snapshotTopAttachments();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
