import type {
  ChatComposerAttachmentDraftPort,
  RestoredLocalAttachmentDraft,
} from "./contract";
import { DraftConflictError, DraftSessionExpiredError, type StoredAttachment } from "./database";
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

const restoreFile = (item: StoredAttachment): RestoredLocalAttachmentDraft => ({
  id: item.id,
  file: new File([item.file], item.name, {
    type: item.file.type,
    lastModified: item.lastModified,
  }),
  source: item.source,
  position: item.position,
});

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
  const storedRevisions = new Map<string, string>();
  // Retain ownership after removal so a delayed document save still targets
  // the old incarnation. Snapshots passed to saves never adopt newer files.
  const ownedRevisions = new Map<string, string>();
  const ownedDurableRevisions = new Map<string, string>();
  const saving = new Map<string, Promise<boolean>>();
  // Failed stages remain in the repository queue. Only the latest, still-owned
  // stage for an attachment may retry; removal must not retry obsolete bytes.
  const stages = new Map<string, object>();
  const observed = new Set<string>();
  const removing = new Set<string>();
  const sending = new Set<string>();
  const liveFiles = new Map<string, RestoredLocalAttachmentDraft>();
  // Editor undo may supply only IDs, even after physical deletion commits.
  // Keep its bytes for this port's lifetime, independently of current liveness.
  const removedFiles = new Map<string, RestoredLocalAttachmentDraft>();
  const removedRevisions = new Map<string, string[]>();
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
            storedRevisions.set(record.id, record.revision);
            if (!ownedRevisions.has(record.id)) ownedRevisions.set(record.id, record.revision);
            if (!ownedDurableRevisions.has(record.id)) ownedDurableRevisions.set(record.id, record.revision);
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
    const revision = createRevision();
    ownedRevisions.set(input.id, revision);
    stages.set(input.id, stageToken);
    const currentStage = () => stages.get(input.id) === stageToken;
    let record: StoredAttachment | undefined;
    let expectedRevision: string | undefined;
    let persisted = false;
    const operation = repository
      .enqueue(conversation + ":files", async () => {
        if (!currentStage()) return;
        await open();
        if (!currentStage()) return;
        if (!active()) throw new Error("Draft session expired");
        if (!record) {
          expectedRevision = storedRevisions.get(input.id);
          record = {
            ...input,
            name: input.file.name,
            lastModified: input.file.lastModified,
            position: position ?? sequence++,
            revision,
            key: key(input.id),
            conversation,
            account: draftAccountKey(scope),
          };
        }
        const staged = record;
        sequence = Math.max(sequence, record.position + 1);
        const records = await repository.database.changeAttachments(
          conversation,
          (records) => {
            if (!currentStage()) return records;
            const current = records.find(item => item.id === input.id);
            if (current?.revision !== expectedRevision && current?.revision !== revision)
              throw new DraftConflictError();
            return [...records.filter(item => item.id !== input.id), staged];
          },
          await session()
        );
        // A removal can race a committed stage. Retain that revision so the
        // queued removal still deletes exactly the bytes we actually wrote.
        persisted = records.some(item => item.id === input.id && item.revision === revision);
        if (persisted) {
          entries.set(input.id, record);
          storedRevisions.set(input.id, revision);
          ownedDurableRevisions.set(input.id, revision);
        }
        if (currentStage()) stages.delete(input.id);
      })
      .then(
        () => persisted,
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
      const entry = entries.get(id);
      const revisions = [...new Set([
        ownedRevisions.get(id),
        ownedDurableRevisions.get(id),
      ].filter((revision): revision is string => !!revision))];
      const ownedEntry = entry && revisions.includes(entry.revision)
        ? entry
        : undefined;
      const removedFile = liveFiles.get(id) ?? (ownedEntry ? restoreFile(ownedEntry) : undefined);
      if (removedFile) removedFiles.set(id, removedFile);
      removedRevisions.set(id, revisions);
      // Keep the decision even when physical blob cleanup fails. Document saves
      // also persist membership atomically, including not-yet-staged attachments.
      const capturedSession = await session();
      for (const revision of revisions)
        await repository.database.setAttachmentPresence(
          conversation,
          id,
          false,
          capturedSession,
          revision
        );
      const owned = new Set(revisions);
      await repository.database.changeAttachments(
        conversation,
        (records) =>
          records.filter(
            (item) => item.id !== id || !owned.has(item.revision)
          ),
        capturedSession
      );
      entries.delete(id);
      storedRevisions.delete(id);
      observed.delete(id);
      // Undo can occur after the transaction starts but before it completes.
      const restored = live.has(id) ? liveFiles.get(id) ?? removedFiles.get(id) : undefined;
      if (restored) void stage(restored, restored.position);
    });
  };
  return {
    async restore() {
      // A failed write must remain retryable and keep navigation unsafe, but
      // cannot prevent reading unrelated durable files or uncertain sends.
      let failedCount = 0;
      await repository.flush(conversation + ":files").catch((error) => {
        if (error instanceof DraftSessionExpiredError) throw error;
        failedCount = 1;
      });
      opened = undefined;
      entries.clear();
      storedRevisions.clear();
      await open();
      if (!active()) return { attachments: [], failedCount: 0 };
      const reservations = [...entries.values()].filter(item => item.reserved);
      const visible = await repository.database.restoreAttachments(
        conversation
      );
      if (!active()) return { attachments: [], failedCount: 0 };
      entries.clear();
      visible.forEach((item) => {
        entries.set(item.id, item);
        ownedDurableRevisions.set(item.id, item.revision);
        if (!stages.has(item.id)) ownedRevisions.set(item.id, item.revision);
      });
      // Keep uncertain sends hidden until the user explicitly recovers this snapshot.
      return {
        ...(reservations.length ? {
          pendingSendRecovery: {
            count: reservations.length,
            async recover() {
              await repository.database.recoverAttachmentReservations(
                reservations, await session(), createRevision
              );
              // Recovery changed the generation outside this port's file
              // queue. Its next stage/send must load the recovered ownership.
              opened = undefined;
              entries.clear();
              storedRevisions.clear();
            },
          },
        } : {}),
        attachments: visible.map(restoreFile),
        failedCount,
      };
    },
    stage,
    attachmentRevisions() {
      const revisions = new Map<string, string[]>();
      ownedRevisions.forEach((revision, id) => revisions.set(id, [revision]));
      // A failed replacement owns pending bytes and the earlier durable copy.
      // Removing it must hide both, without claiming another window's files.
      ownedDurableRevisions.forEach((revision, id) => {
        const owned = revisions.get(id) ?? [];
        if (!owned.includes(revision)) owned.push(revision);
        revisions.set(id, owned);
      });
      return revisions;
    },
    syncLive(ids, files = []) {
      if (!active()) return;
      live = new Set(ids);
      const undoFiles: RestoredLocalAttachmentDraft[] = [];
      for (const id of ids)
        if (removing.delete(id)) {
          const restored = removedFiles.get(id);
          const revisions = removedRevisions.get(id) ?? [];
          if (restored && !files.some(file => file.id === id)) undoFiles.push(restored);
          void repository
            .enqueue(conversation + ":files", async () => {
              if (!active() || !live.has(id)) return;
              const capturedSession = await session();
              for (const revision of revisions)
                await repository.database.setAttachmentPresence(
                  conversation,
                  id,
                  true,
                  capturedSession,
                  revision
                );
            })
            .catch(() => {});
        }
      [...files, ...undoFiles].forEach((file) => {
        if (
          !entries.has(file.id) &&
          !saving.has(file.id) &&
          !sending.has(file.id)
        )
          void stage(file, file.position);
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
          ids.every((id) => {
            const entry = entries.get(id);
            return (
              !!entry &&
              ownedDurableRevisions.get(id) === entry.revision &&
              !saving.has(id)
            );
          }))
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
            if (record.reserved === sendId) {
              entries.set(record.id, record);
              storedRevisions.set(record.id, record.revision);
              attachmentRevisions.set(record.id, record.revision);
            }
          });
        },
        false
      );
      return {
        ready,
        attachmentRevisions,
        async settle(keep) {
          await ready.catch(() => {});
          // A failed send restores a new ownership generation. Old queued
          // consumption documents cannot hide those retained bytes again.
          const recoveredRevisions = new Map(keep.map(id => [id, createRevision()]));
          await repository.enqueue(conversation + ":files", async () => {
            if (!active()) return;
            const retained = await repository.database.changeAttachments(
              conversation,
              (records) =>
                records.flatMap((item) => {
                  if (!sendId || item.reserved !== sendId) return [item];
                  if (!keep.includes(item.id)) return [];
                  const record = { ...item, revision: recoveredRevisions.get(item.id)! };
                  delete record.reserved;
                  return [record];
                }),
              await session()
            );
            ids.forEach((id) => {
              sending.delete(id);
              entries.delete(id);
              storedRevisions.delete(id);
            });
            retained.forEach((record) => {
              if (record.revision === recoveredRevisions.get(record.id)) {
                entries.set(record.id, record);
                storedRevisions.set(record.id, record.revision);
                ownedRevisions.set(record.id, record.revision);
                ownedDurableRevisions.set(record.id, record.revision);
              }
            });
          });
        },
      };
    },
  };
}
