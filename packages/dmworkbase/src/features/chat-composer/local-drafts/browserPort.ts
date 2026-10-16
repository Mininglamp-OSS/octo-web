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
  const session = () => repository.session(scope);
  void session().catch(() => {});
  const entries = new Map<string, StoredAttachment>();
  const saving = new Map<string, Promise<boolean>>();
  // Failed stages remain in the repository queue. Only the latest, still-owned
  // stage for an attachment may retry; removal must not retry obsolete bytes.
  const stages = new Map<string, object>();
  const observed = new Set<string>();
  const removing = new Set<string>();
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
            sequence = Math.max(sequence, record.position + 1);
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
    const stageToken = {};
    stages.set(input.id, stageToken);
    const currentStage = () => stages.get(input.id) === stageToken;
    const operation = repository
      .enqueue(conversation + ":files", async () => {
        if (!currentStage()) return;
        await open();
        if (!currentStage()) return;
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
        sequence = Math.max(sequence, record.position + 1);
        const records = await repository.database.changeAttachments(
          conversation,
          (records) => currentStage() ? [
            ...records.filter((item) => item.id !== input.id),
            record,
          ] : records,
          await session()
        );
        // A removal can race a committed stage. Retain that revision so the
        // queued removal still deletes exactly the bytes we actually wrote.
        if (records.some(item => item.id === input.id && item.revision === record.revision))
          entries.set(input.id, record);
        if (currentStage()) stages.delete(input.id);
      })
      .then(
        () => true,
        () => false
      );
    saving.set(input.id, operation);
    void operation.finally(() => {
      if (saving.get(input.id) === operation) saving.delete(input.id);
    });
    return operation;
  };
  const remove = (id: string) => {
    stages.delete(id);
    saving.delete(id);
    removing.add(id);
    return repository.enqueue(conversation + ":files", async () => {
      if (!active() || live.has(id)) return;
      const revision = entries.get(id)?.revision;
      // Keep the decision even when physical blob cleanup fails. Document saves
      // also persist membership atomically, including not-yet-staged attachments.
      await repository.database.setAttachmentPresence(
        conversation,
        id,
        false,
        await session(),
        revision
      );
      await repository.database.changeAttachments(
        conversation,
        (records) =>
          records.filter(
            (item) => item.id !== id || item.revision !== revision
          ),
        await session()
      );
      entries.delete(id);
      observed.delete(id);
      // Undo can occur after the transaction starts but before it completes.
      const restored = live.has(id) ? liveFiles.get(id) : undefined;
      if (restored) void stage(restored);
    });
  };
  return {
    async restore() {
      await repository.flush(conversation + ":files");
      opened = undefined;
      entries.clear();
      await open();
      if (!active()) return { attachments: [], failedCount: 0 };
      const reservations = [...entries.values()].filter(item => item.reserved);
      const visible = await repository.database.restoreAttachments(
        conversation
      );
      if (!active()) return { attachments: [], failedCount: 0 };
      entries.clear();
      visible.forEach((item) => entries.set(item.id, item));
      // Keep uncertain sends hidden until the user explicitly recovers this snapshot.
      return {
        ...(reservations.length ? {
          pendingSendRecovery: {
            count: reservations.length,
            async recover() {
              await repository.database.recoverAttachmentReservations(
                reservations, await session(), createRevision
              );
            },
          },
        } : {}),
        attachments: visible.map((item) => ({
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
      live = new Set(ids);
      for (const id of ids)
        if (removing.delete(id)) {
          void repository
            .enqueue(conversation + ":files", async () => {
              if (active() && live.has(id))
                await repository.database.setAttachmentPresence(
                  conversation,
                  id,
                  true,
                  await session()
                );
            })
            .catch(() => {});
        }
      files.forEach((file) => {
        if (
          !entries.has(file.id) &&
          !saving.has(file.id) &&
          !sending.has(file.id)
        )
          void stage(file);
      });
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
      const attachmentRevisions = new Map<string, string>();
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
              }),
            await session()
          );
          records.forEach((record) => {
            entries.set(record.id, record);
            if (record.reserved === sendId)
              attachmentRevisions.set(record.id, record.revision);
          });
        },
        false
      );
      return {
        ready,
        attachmentRevisions,
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
                }),
              await session()
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
