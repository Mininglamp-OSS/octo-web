import type { ChatComposerAttachmentDraftPort } from "@octo/base/src/features/chat-composer/local-drafts";
import type { DraftOpenInput, DraftReference, LocalAttachmentDraftBridge } from "./attachmentDraftContract";

/** Editor-local receipts only. Eligibility, versions and send ownership live in Client. */
export function createClientAttachmentDraftPort(
  api: LocalAttachmentDraftBridge, context: DraftOpenInput, isActive: () => boolean,
): ChatComposerAttachmentDraftPort {
  type Entry = { receipt?: DraftReference; saving?: Promise<boolean>; observed: boolean; removed: boolean };
  const entries = new Map<string, Entry>();
  const preparing = new Set<Entry>();
  let opened: ReturnType<LocalAttachmentDraftBridge["open"]> | undefined;
  let nextPosition = 0;
  const open = () => opened ??= api.open(context);
  const report = (error: unknown) => console.warn("[attachment-drafts] Client operation failed", error);
  const remove = async (id: string, entry: Entry) => {
    if (entry.removed) return;
    entry.removed = true;
    await entry.saving;
    if (!entry.receipt) { entries.delete(id); return; }
    try {
      await api.remove({ leaseId: (await open()).leaseId, attachments: [entry.receipt] });
      if (entries.get(id) === entry) entries.delete(id);
    } catch (error) { entry.removed = false; report(error); }
  };
  return {
    async restore() {
      if (!isActive()) return { attachments: [], failedCount: 0 };
      const result = await open();
      if (!isActive()) return { attachments: [], failedCount: 0 };
      const attachments = result.attachments.flatMap(({ attachment, bytes }) => {
        nextPosition = Math.max(nextPosition, attachment.position + 1);
        if (entries.has(attachment.id)) return [];
        entries.set(attachment.id, { receipt: { id: attachment.id, revision: attachment.revision }, observed: false, removed: false });
        return [{ id: attachment.id, position: attachment.position, source: attachment.source,
          file: new File([new Uint8Array(bytes)], attachment.name, { type: attachment.mimeType, lastModified: attachment.lastModified }) }];
      });
      return { attachments, failedCount: result.failedCount };
    },
    async stage({ id, file, source }, position) {
      if (!isActive()) return false;
      const existing = entries.get(id);
      if (existing && !existing.removed) return existing.saving ?? !!existing.receipt;
      const entry: Entry = { observed: true, removed: false };
      entries.set(id, entry);
      entry.saving = (async () => {
        try {
          const { leaseId } = await open();
          if (!isActive()) return false;
          const receipt = await api.stage({ leaseId, attachment: { id, position: position ?? nextPosition++,
            name: file.name, mimeType: file.type, size: file.size, lastModified: file.lastModified, source }, bytes: await file.arrayBuffer() });
          entry.receipt = { id, revision: receipt.revision };
          return true;
        } catch (error) { report(error); return false; }
      })();
      return entry.saving;
    },
    syncLive(ids) {
      if (!isActive()) return;
      const live = new Set(ids);
      for (const [id, entry] of entries) {
        if (live.has(id)) entry.observed = true;
        else if (entry.observed && !preparing.has(entry)) void remove(id, entry);
      }
    },
    discardUnready(ids) {
      for (const id of ids) {
        const entry = entries.get(id);
        if (entry && !entry.receipt && !preparing.has(entry)) void remove(id, entry);
      }
    },
    beginSend(ids) {
      const selected = ids.map(id => entries.get(id));
      const duplicate = selected.some(entry => entry && preparing.has(entry));
      if (!duplicate) selected.forEach(entry => { if (entry) preparing.add(entry); });
      const prepare = (async () => {
        if (duplicate) throw new Error("Attachment already being submitted");
        if (!isActive()) throw new Error("Attachment editor expired");
        await Promise.all(selected.map(entry => entry?.saving));
        if (selected.some(entry => !entry?.receipt || entry.removed)) throw new Error("Attachment persistence incomplete");
        const { leaseId } = await open();
        if (!isActive()) throw new Error("Attachment editor expired");
        return api.prepareSend({ leaseId, attachments: selected.map(entry => entry!.receipt!) });
      })();
      const ready = prepare.then(() => {});
      void ready.catch(report);
      return {
        ready,
        async settle(keepAttachmentIds) {
          let send: { sendId: string };
          try { send = await prepare; }
          catch {
            if (!duplicate) selected.forEach(entry => { if (entry) preparing.delete(entry); });
            return;
          }
          await api.settleSend({ sendId: send.sendId, keepAttachmentIds: [...keepAttachmentIds] });
          selected.forEach((entry, index) => {
            if (!entry) return;
            preparing.delete(entry);
            const id = ids[index];
            if (!keepAttachmentIds.includes(id) && entries.get(id) === entry) entries.delete(id);
          });
        },
      };
    },
    canLeave(ids) { return ids.every(id => !!entries.get(id)?.receipt && !entries.get(id)?.removed); },
  };
}
