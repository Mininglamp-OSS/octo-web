import type { ChatComposerAttachmentDraftPort, RestoredLocalAttachmentDraft } from "@octo/base/src/features/chat-composer/local-drafts";
import type { DraftOpenInput, DraftReference, LocalAttachmentDraftBridge } from "./attachmentDraftContract";

/** UI receipts and pending requests only; Client decides durable eligibility. */
export function createClientAttachmentDraftPort(
  api: LocalAttachmentDraftBridge, context: DraftOpenInput, isActive: () => boolean,
  timeoutMs = 10_000,
): ChatComposerAttachmentDraftPort {
  type Entry = { receipt?: DraftReference; saving?: Promise<boolean>; observed: boolean;
    removeNeeded: boolean; removing?: Promise<void> };
  const entries = new Map<string, Entry>();
  const preparing = new Set<Entry>();
  const settlements = new Map<string, { ids: readonly string[]; run: () => Promise<void> }>();
  let opened: ReturnType<LocalAttachmentDraftBridge["open"]> | undefined;
  let nextPosition = 0;
  const report = (error: unknown) => console.warn("[attachment-drafts] Client operation failed", error);
  const bounded = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Attachment Client operation timed out")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const open = () => opened ??= bounded(api.open(context)).catch(error => { opened = undefined; throw error; });
  const flushSettlements = async (ids?: readonly string[]) => {
    const results = await Promise.allSettled([...settlements.values()]
      .filter(operation => !ids || operation.ids.some(id => ids.includes(id)))
      .map(operation => operation.run()));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
  const remove = (id: string, entry: Entry): Promise<void> => {
    entry.removeNeeded = true;
    if (entry.removing) return entry.removing;
    const operation = (async () => {
      await entry.saving;
      // Even a failed/lost stage reply can have written bytes. Client resolves
      // pending stage operations before this removal; unknown receipts need an open.
      if (entry.receipt) {
        await bounded(api.remove({ leaseId: (await open()).leaseId, attachments: [entry.receipt] }));
      } else {
        const snapshot = await bounded(api.open(context));
        opened = Promise.resolve(snapshot);
        const stored = snapshot.attachments.find(item => item.attachment.id === id);
        if (stored) await bounded(api.remove({ leaseId: snapshot.leaseId, attachments: [{ id, revision: stored.attachment.revision }] }));
      }
      entry.removeNeeded = false;
      entry.receipt = undefined;
      if (entries.get(id) === entry) entries.delete(id);
    })();
    entry.removing = operation;
    void operation.finally(() => { entry.removing = undefined; }).catch(report);
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
    const entry: Entry = { observed: true, removeNeeded: false };
    entries.set(id, entry);
    const saving = (async () => {
      try {
        if (previous?.removeNeeded) await remove(id, previous);
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
      const result = await open();
      if (!isActive()) return { attachments: [], failedCount: 0 };
      const attachments = [...result.attachments].sort((a, b) => a.attachment.position - b.attachment.position)
        .flatMap(({ attachment, bytes }) => {
          nextPosition = Math.max(nextPosition, attachment.position + 1);
          if (entries.has(attachment.id)) return [];
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
      // Captured navigation must finish its outstanding deletion even if its UI
      // has since become inactive. Client still validates the captured session.
      const discarded = [...entries].filter(([id, entry]) =>
        entry.removeNeeded || (ids.includes(id) && !entry.receipt && !preparing.has(entry)));
      // Explicit confirmation is a terminal UI decision. Try every cleanup even
      // if settlement fails; Client retains received intents and owns retries.
      const results = await Promise.allSettled([
        flushSettlements(), ...discarded.map(([id, entry]) => remove(id, entry)),
      ]);
      settlements.clear();
      for (const [id, entry] of discarded) if (entries.get(id) === entry) entries.delete(id);
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
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
      const requestId = crypto.randomUUID().replace(/-/g, "");
      let requested = false;
      const prepare = (async () => {
        if (duplicate) throw new Error("Attachment already being submitted");
        if (!isActive()) throw new Error("Attachment editor expired");
        await flushSettlements(ids);
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
      return {
        ready,
        settle(keepAttachmentIds) {
          if (settled) return settled;
          settled = (async () => {
            try {
              try { await prepare; } catch { /* Cancel an uncertain reservation using its stable request id. */ }
              if (requested) {
                const operation = async () => {
                  await bounded(api.settleSend({ sendId: requestId, keepAttachmentIds: [...keepAttachmentIds] }));
                  settlements.delete(requestId);
                };
                settlements.set(requestId, { ids, run: operation });
                await operation();
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
      return !isActive() || (settlements.size === 0 && ![...entries.values()].some(entry => entry.removeNeeded) &&
        ids.every(id => !!entries.get(id)?.receipt && !entries.get(id)?.removeNeeded));
    },
  };
}
