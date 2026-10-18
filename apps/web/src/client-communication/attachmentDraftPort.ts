import type { ChatComposerAttachmentDraftPort, RestoredLocalAttachmentDraft } from "@octo/base/src/features/chat-composer/local-drafts";
import { AttachmentDraftCleanup, type AttachmentCleanupRequest } from "./attachmentDraftCleanup";
import type { DraftOpenInput, DraftReference, LocalAttachmentDraftBridge } from "./attachmentDraftContract";

/** UI receipts and pending requests only; Client decides durable eligibility. */
export function createClientAttachmentDraftPort(
  api: LocalAttachmentDraftBridge, context: DraftOpenInput, isActive: () => boolean,
  timeoutMs = 10_000,
  cleanup = new AttachmentDraftCleanup(),
): ChatComposerAttachmentDraftPort {
  type Entry = { receipt?: DraftReference; saving?: Promise<boolean>; observed: boolean;
    removeNeeded: boolean; removal?: AttachmentCleanupRequest };
  const entries = new Map<string, Entry>();
  const preparing = new Set<Entry>();
  const scope = JSON.stringify(context);
  let opened: ReturnType<LocalAttachmentDraftBridge["open"]> | undefined;
  let nextPosition = 0;
  const report = (error: unknown) => console.warn("[attachment-drafts] Client operation failed", error);
  const bounded = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Attachment Client operation timed out")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const open = () => opened ??= bounded(api.open(context)).catch(error => { opened = undefined; throw error; });
  const remove = (id: string, entry: Entry): Promise<void> => {
    entry.removeNeeded = true;
    entry.removal ??= cleanup.add(scope, [id], [id], async () => {
      try {
        await entry.saving;
        cleanup.assertActive();
        // A lost stage reply needs a fresh snapshot to find the stored revision.
        if (!entry.receipt) opened = undefined;
        // Reacquire a rejected lease on retry. A new editor may have revoked it.
        const snapshot = await open();
        cleanup.assertActive();
        const reference = entry.receipt ?? snapshot.attachments.find(item => item.attachment.id === id)?.attachment;
        if (reference) await bounded(api.remove({ leaseId: snapshot.leaseId,
          attachments: [{ id, revision: reference.revision }] }));
        entry.removeNeeded = false;
        entry.receipt = undefined;
        if (entries.get(id) === entry) entries.delete(id);
      } catch (error) { opened = undefined; throw error; }
    });
    const operation = entry.removal.run();
    void operation.catch(report);
    return operation;
  };
  const stage = (input: RestoredLocalAttachmentDraft, position?: number): Promise<boolean> => {
    if (!isActive()) return Promise.resolve(false);
    const { id, file, source } = input;
    const previous = entries.get(id);
    if (previous && !previous.removeNeeded) {
      if (previous.saving) return previous.saving;
      if (previous.receipt) return Promise.resolve(true);
    }
    const priorCleanup = cleanup.pending(scope, [id]);
    const entry: Entry = { observed: true, removeNeeded: false };
    entries.set(id, entry);
    const saving = (async () => {
      try {
        if (previous?.removeNeeded) await remove(id, previous);
        await cleanup.retry(priorCleanup);
        const snapshot = await open();
        if (!isActive()) return false;
        nextPosition = Math.max(nextPosition, ...snapshot.attachments.map(item => item.attachment.position + 1));
        const receipt = await bounded(api.stage({ leaseId: snapshot.leaseId,
          attachment: { id, position: position ?? nextPosition++, name: file.name, mimeType: file.type,
            size: file.size, lastModified: file.lastModified, source }, bytes: await file.arrayBuffer() }));
        entry.receipt = { id, revision: receipt.revision };
        return true;
      } catch (error) { report(error); return false; }
    })();
    entry.saving = saving;
    void saving.finally(() => { entry.saving = undefined; });
    return saving;
  };
  return {
    async restore() {
      if (!isActive()) return { attachments: [], failedCount: 0 };
      await cleanup.retry(cleanup.pending(scope)).catch(report);
      if (!isActive()) return { attachments: [], failedCount: 0 };
      opened = undefined;
      const result = await open();
      if (!isActive()) return { attachments: [], failedCount: 0 };
      const attachments = [...result.attachments].sort((a, b) => a.attachment.position - b.attachment.position)
        .flatMap(({ attachment, bytes }) => {
          nextPosition = Math.max(nextPosition, attachment.position + 1);
          if (entries.has(attachment.id) || cleanup.hidden(scope, attachment.id)) return [];
          entries.set(attachment.id, { receipt: { id: attachment.id, revision: attachment.revision }, observed: false, removeNeeded: false });
          return [{ id: attachment.id, position: attachment.position, source: attachment.source,
            file: new File([new Uint8Array(bytes)], attachment.name, { type: attachment.mimeType, lastModified: attachment.lastModified }) }];
        });
      return { attachments, failedCount: result.failedCount };
    },
    stage,
    syncLive(ids, files = []) {
      if (!isActive()) return;
      const live = new Set(ids);
      // Undo can restore a node whose disk copy was explicitly removed. The
      // composer still owns its File and supplies it here for re-staging.
      for (const file of files) {
        const entry = entries.get(file.id);
        if (!entry || (!preparing.has(entry) && (entry.removeNeeded || (!entry.receipt && !entry.saving)))) void stage(file);
      }
      for (const [id, entry] of entries) {
        if (live.has(id)) entry.observed = true;
        else if (entry.observed) void remove(id, entry).catch(report);
      }
    },
    async discardUnready(ids) {
      // Capture exactly this confirmation's work. In-flight staging is retained.
      for (const [id, entry] of entries) {
        if (entry.removeNeeded || (ids.includes(id) && !entry.receipt && !entry.saving && !preparing.has(entry))) {
          void remove(id, entry).catch(report);
        }
      }
      const attempted = cleanup.pending(scope);
      try { await cleanup.retry(attempted); }
      finally {
        // Waive only navigation, never ownership. New tasks are not part of this
        // confirmation; failed tasks remain retryable across editor unmounts.
        attempted.forEach(task => { task.waived = true; });
      }
    },
    beginSend(ids, files = []) {
      // Capture undo-restored Files synchronously, before React's live-sync effect.
      for (const file of files) {
        const entry = entries.get(file.id);
        if (!entry || (!preparing.has(entry) && (entry.removeNeeded || !entry.receipt))) void stage(file);
      }
      const selected = ids.map(id => entries.get(id));
      const duplicate = selected.some(entry => entry && preparing.has(entry));
      if (!duplicate) selected.forEach(entry => {
        if (entry) { preparing.add(entry); entry.observed = false; }
      });
      let requestId = "";
      let requested = false;
      const prepare = (async () => {
        if (duplicate) throw new Error("Attachment already being submitted");
        if (!isActive()) throw new Error("Attachment editor expired");
        requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
        await cleanup.retry(cleanup.pending(scope, ids));
        await Promise.all(selected.map(entry => entry?.saving));
        const { leaseId } = await open();
        if (!isActive()) throw new Error("Attachment editor expired");
        requested = true;
        return bounded(api.prepareSend({ leaseId, requestId,
          attachments: ids.map((id, index) => selected[index]?.receipt ?? { id }) }));
      })();
      const ready = prepare.then(() => {});
      void ready.catch(report);
      let settled: Promise<void> | undefined;
      let settlement: AttachmentCleanupRequest | undefined;
      return {
        ready,
        settle(keepAttachmentIds) {
          if (settled) return settled;
          settled = (async () => {
            try {
              let sendId = requestId;
              try { sendId = (await prepare).sendId; }
              catch { /* Cancel an uncertain reservation using its stable request id. */ }
              if (requested) {
                settlement ??= cleanup.add(scope, ids, ids.filter(id => !keepAttachmentIds.includes(id)), async () => {
                  cleanup.assertActive();
                  await bounded(api.settleSend({ sendId, keepAttachmentIds: [...keepAttachmentIds] }));
                });
                await settlement.run();
              }
              if (!duplicate) selected.forEach((entry, index) => {
                if (!entry) return;
                if (!keepAttachmentIds.includes(ids[index]) && entries.get(ids[index]) === entry && !entry.removeNeeded) entries.delete(ids[index]);
              });
            } finally {
              if (!duplicate) selected.forEach(entry => { if (entry) preparing.delete(entry); });
              await Promise.all([...entries].filter(([, entry]) => entry.removeNeeded).map(([id, entry]) => remove(id, entry)));
            }
          })();
          void settled.catch(() => { settled = undefined; });
          return settled;
        },
      };
    },
    canLeave(ids) {
      return !isActive() || (!cleanup.pending(scope).some(task => !task.waived) &&
        ids.every(id => !!entries.get(id)?.receipt && !entries.get(id)?.removeNeeded));
    },
  };
}
