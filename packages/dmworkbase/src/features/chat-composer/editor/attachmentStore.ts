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
export class ChatComposerAttachmentStore<TTop extends AttachmentStoreTopItem> {
  readonly attachmentFiles = new Map<string, File>();
  private readonly inlinePreviewUrls = new Map<string, string>();
  private readonly leasedInlineIds = new Set<string>();
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

  addInlineFile(id: string, file: File, previewUrl?: string): void {
    this.assertInlineRegistration(id, file, previewUrl);
    this.attachmentFiles.set(id, file);
    if (previewUrl) {
      this.inlinePreviewUrls.set(id, previewUrl);
    }
    this.leasedInlineIds.delete(id);
  }

  addInlinePreviewUrl(id: string, previewUrl: string): void {
    this.assertInlineRegistration(id, undefined, previewUrl);
    this.inlinePreviewUrls.set(id, previewUrl);
    this.leasedInlineIds.delete(id);
  }

  takeInlineAttachments(ids: readonly string[]): void {
    ids.forEach((id) => {
      if (this.attachmentFiles.has(id) || this.inlinePreviewUrls.has(id)) {
        this.leasedInlineIds.add(id);
      }
    });
  }

  restoreInlineAttachments(ids: readonly string[]): void {
    ids.forEach((id) => this.leasedInlineIds.delete(id));
  }

  disposeInlineAttachment(id: string, fallbackPreviewUrl?: string): void {
    const previewUrl = this.inlinePreviewUrls.get(id) ?? fallbackPreviewUrl;
    this.attachmentFiles.delete(id);
    this.inlinePreviewUrls.delete(id);
    this.leasedInlineIds.delete(id);
    if (previewUrl) this.revokeObjectURL(previewUrl);
  }

  /** Transfer resources to recovery without revoking their object URLs. */
  handoffInlineAttachments(ids: readonly string[]): void {
    ids.forEach((id) => {
      this.attachmentFiles.delete(id);
      this.inlinePreviewUrls.delete(id);
      this.leasedInlineIds.delete(id);
    });
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
      removed.flatMap(({ previewUrl }) => (previewUrl ? [previewUrl] : []))
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

  /** Transfer restored top resources to recovery without disposing previews. */
  handoffTopAttachments(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const handedOff = new Set(ids);
    const remaining = this.topItems.filter(({ id }) => !handedOff.has(id));
    if (remaining.length === this.topItems.length) return;
    this.topItems = remaining;
    this.notify();
  }

  clear(): void {
    const urls = new Set<string>();
    this.inlinePreviewUrls.forEach((url, id) => {
      if (!this.leasedInlineIds.has(id)) urls.add(url);
    });
    this.topItems
      .flatMap(({ previewUrl }) => (previewUrl ? [previewUrl] : []))
      .forEach((url) => urls.add(url));

    const liveInlineIds = [...this.attachmentFiles.keys()].filter(
      (id) => !this.leasedInlineIds.has(id)
    );
    liveInlineIds.forEach((id) => {
      this.attachmentFiles.delete(id);
      this.inlinePreviewUrls.delete(id);
    });
    [...this.inlinePreviewUrls.keys()].forEach((id) => {
      if (!this.leasedInlineIds.has(id)) this.inlinePreviewUrls.delete(id);
    });
    this.topItems = [];
    urls.forEach((url) => this.revokeObjectURL(url));
    this.notify();
  }

  inlineResource(id: string): {
    file?: File;
    previewUrl?: string;
    leased: boolean;
  } {
    return {
      file: this.attachmentFiles.get(id),
      previewUrl: this.inlinePreviewUrls.get(id),
      leased: this.leasedInlineIds.has(id),
    };
  }

  validateInlineRegistration(
    id: string,
    file?: File,
    previewUrl?: string
  ): void {
    this.assertInlineRegistration(id, file, previewUrl);
  }

  private assertInlineRegistration(
    id: string,
    file: File | undefined,
    previewUrl: string | undefined
  ): void {
    if (this.leasedInlineIds.has(id)) {
      throw new Error(`cannot replace leased inline attachment: ${id}`);
    }
    const currentFile = this.attachmentFiles.get(id);
    if (currentFile && file && currentFile !== file) {
      throw new Error(`inline attachment already registered: ${id}`);
    }
    const currentPreviewUrl = this.inlinePreviewUrls.get(id);
    if (currentPreviewUrl && previewUrl && currentPreviewUrl !== previewUrl) {
      throw new Error(`inline attachment preview already registered: ${id}`);
    }
  }

  private notify(): void {
    const snapshot = this.snapshotTopAttachments();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
