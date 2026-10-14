/** Session-owned transport outbox. Client remains authoritative for disk state. */
export interface AttachmentCleanupRequest {
  ids: readonly string[];
  hiddenIds: readonly string[];
  waived: boolean;
  run(): Promise<void>;
}

export class AttachmentDraftCleanup {
  private scopes = new Map<string, Set<AttachmentCleanupRequest>>();
  private disposed = false;

  assertActive() {
    if (this.disposed) throw new Error("Attachment draft session expired");
  }

  add(scope: string, ids: readonly string[], hiddenIds: readonly string[], perform: () => Promise<void>): AttachmentCleanupRequest {
    this.assertActive();
    let pending: Promise<void> | undefined;
    let acknowledged = false;
    const request: AttachmentCleanupRequest = {
      ids: [...ids], hiddenIds: [...hiddenIds], waived: false,
      run: () => {
        if (pending) return pending;
        if (acknowledged) return Promise.resolve();
        pending = Promise.resolve().then(() => {
          this.assertActive();
          return perform();
        }).then(() => {
          acknowledged = true;
          const tasks = this.scopes.get(scope);
          tasks?.delete(request);
          if (!tasks?.size) this.scopes.delete(scope);
        }).finally(() => { pending = undefined; });
        return pending;
      },
    };
    let tasks = this.scopes.get(scope);
    if (!tasks) this.scopes.set(scope, tasks = new Set());
    tasks.add(request);
    return request;
  }

  pending(scope: string, ids?: readonly string[]) {
    return [...(this.scopes.get(scope) ?? [])].filter(task => !ids || task.ids.some(id => ids.includes(id)));
  }

  async retry(tasks: AttachmentCleanupRequest[]) {
    const results = await Promise.allSettled(tasks.map(task => task.run()));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  hidden(scope: string, id: string) {
    return this.pending(scope).some(task => task.hiddenIds.includes(id));
  }

  dispose() {
    this.disposed = true;
    this.scopes.clear();
  }
}
