import type {
  ChatComposerAttachmentDraftPort,
  RestoredLocalAttachmentDraft,
} from "./contract";
import type { StoredAttachment } from "./database";
import {
  draftAccountKey,
  draftKey,
  type DraftScope,
  type DraftChannel,
} from "./model";
import {
  conversationDrafts,
  type ConversationDraftRepository,
} from "./repository";

// getRandomValues also works on HTTP intranet origins, unlike randomUUID.
const createRevision = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");

/** Browser equivalent of the Client attachment lifecycle; blobs never leave this device. */
export function createBrowserAttachmentDraftPort(
  scope: DraftScope,
  channel: DraftChannel,
  repository: ConversationDraftRepository = conversationDrafts
): ChatComposerAttachmentDraftPort {
  const conversation = draftKey(scope, channel);
  const epoch = repository.epoch(scope);
  const entries = new Map<string, StoredAttachment>();
  const saving = new Map<string, Promise<boolean>>();
  const observed = new Set<string>();
  const sending = new Set<string>();
  const liveFiles = new Map<string, RestoredLocalAttachmentDraft>();
  let live = new Set<string>();
  let opened: Promise<void> | undefined;
  let sequence = 0;
  const active = () => repository.active(scope, epoch);
  const key = (id: string) => JSON.stringify([conversation, id]);
  const open = () =>
    (opened ??= repository.database
      .list<StoredAttachment>("attachments", "conversation", conversation)
      .then((records) => {
        if (active())
          records.forEach((record) => {
            if (!entries.has(record.id)) entries.set(record.id, record);
          });
      })
      .catch((error) => {
        opened = undefined;
        throw error;
      }));
  const stage = (
    input: RestoredLocalAttachmentDraft,
    position?: number
  ): Promise<boolean> => {
    if (!active()) return Promise.resolve(false);
    const pending = saving.get(input.id);
    if (pending) return pending;
    observed.add(input.id);
    const operation = repository
      .enqueue(conversation + ":files", async () => {
        await open();
        if (!active()) throw new Error("Draft session expired");
        const record: StoredAttachment = {
          ...input,
          name: input.file.name,
          lastModified: input.file.lastModified,
          position: position ?? sequence++,
          revision: createRevision(),
          key: key(input.id),
          conversation,
          account: draftAccountKey(scope),
        };
        await repository.database.changeAttachments(conversation, (records) => [
          ...records.filter((item) => item.id !== input.id),
          record,
        ]);
        entries.set(input.id, record);
      })
      .then(
        () => true,
        () => false
      );
    saving.set(input.id, operation);
    void operation.finally(() => saving.delete(input.id));
    return operation;
  };
  const remove = (id: string) =>
    repository.enqueue(conversation + ":files", async () => {
      if (!active() || live.has(id)) return;
      const revision = entries.get(id)?.revision;
      await repository.database.changeAttachments(conversation, (records) =>
        records.filter((item) => item.id !== id || item.revision !== revision)
      );
      entries.delete(id);
      observed.delete(id);
      // Undo can occur after the transaction starts but before it completes.
      const restored = live.has(id) ? liveFiles.get(id) : undefined;
      if (restored) void stage(restored);
    });
  return {
    async restore() {
      await repository.flush(conversation + ":files");
      opened = undefined;
      entries.clear();
      await open();
      if (!active()) return { attachments: [], failedCount: 0 };
      // Reservations are durable: an uncertain send must not silently reappear after reload.
      return {
        attachments: [...entries.values()]
          .filter((item) => !item.reserved)
          .map((item) => ({
            id: item.id,
            file: new File([item.file], item.name, {
              type: item.file.type,
              lastModified: item.lastModified,
            }),
            source: item.source,
            position: item.position,
          })),
        failedCount: 0,
      };
    },
    stage,
    syncLive(ids, files = []) {
      if (!active()) return;
      files.forEach((file) => {
        if (
          !entries.has(file.id) &&
          !saving.has(file.id) &&
          !sending.has(file.id)
        )
          void stage(file);
      });
      live = new Set(ids);
      liveFiles.clear();
      files.forEach((file) => liveFiles.set(file.id, file));
      ids.forEach((id) => observed.add(id));
      observed.forEach((id) => {
        if (!live.has(id) && !sending.has(id)) void remove(id).catch(() => {});
      });
    },
    canLeave(ids) {
      return (
        !active() ||
        (repository.saved(conversation + ":files") &&
          ids.every((id) => entries.has(id) && !saving.has(id)))
      );
    },
    async discardUnready(ids) {
      await Promise.all(ids.filter((id) => !entries.has(id)).map(remove));
    },
    beginSend(ids, files = []) {
      files.forEach((file) => {
        if (!entries.has(file.id)) void stage(file);
      });
      ids.forEach((id) => {
        sending.add(id);
        observed.delete(id);
      });
      let sendId: string | undefined;
      const ready = repository.enqueue(
        conversation + ":files",
        async () => {
          sendId = createRevision();
          await open();
          if (!active()) throw new Error("Draft session expired");
          const records = await repository.database.changeAttachments(
            conversation,
            (stored) =>
              stored.map((item) => {
                if (
                  !ids.includes(item.id) ||
                  item.revision !== entries.get(item.id)?.revision
                )
                  return item;
                if (item.reserved)
                  throw new Error("Attachment is already being sent");
                return { ...item, reserved: sendId };
              })
          );
          records.forEach((record) => entries.set(record.id, record));
        },
        false
      );
      return {
        ready,
        async settle(keep) {
          await ready.catch(() => {});
          await repository.enqueue(conversation + ":files", async () => {
            if (!active()) return;
            const retained = await repository.database.changeAttachments(
              conversation,
              (records) =>
                records.flatMap((item) => {
                  if (!sendId || item.reserved !== sendId) return [item];
                  if (!keep.includes(item.id)) return [];
                  const record = { ...item };
                  delete record.reserved;
                  return [record];
                })
            );
            ids.forEach((id) => {
              sending.delete(id);
              if (!keep.includes(id)) entries.delete(id);
            });
            retained.forEach((record) => entries.set(record.id, record));
          });
        },
      };
    },
  };
}
