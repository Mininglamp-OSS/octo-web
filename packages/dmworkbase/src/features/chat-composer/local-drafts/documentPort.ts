import type { ChatComposerAttachmentDraftPort } from "./contract";
import {
  draftKey,
  mergeRecoveredDraft,
  type DraftChannel,
  type DraftScope,
} from "./model";
import {
  conversationDrafts,
  type ConversationDraftRepository,
} from "./repository";
import { DraftSessionExpiredError } from "./database";

export function withConversationDocument(
  attachments: ChatComposerAttachmentDraftPort,
  scope: DraftScope,
  channel: DraftChannel,
  repository: ConversationDraftRepository = conversationDrafts
): ChatComposerAttachmentDraftPort {
  const epoch = repository.epoch(scope);
  void repository.session(scope).catch(() => {});
  const key = draftKey(scope, channel);
  const documentWrites = new AbortController();
  let loaded = false;
  let durableDocument = false;
  let stoppedRevision: number | undefined;
  const active = () => repository.active(scope, epoch);
  const expired = () => new DraftSessionExpiredError();
  return {
    ...attachments,
    async restore() {
      const [result, document] = await Promise.all([
        attachments.restore(),
        repository.load(scope, channel),
      ]);
      if (!active()) throw expired();
      loaded = true;
      // load() may return an optimistic snapshot left by an earlier failed
      // write. A successful read alone does not prove a durable local owner.
      if (document && repository.saved(key) && repository.durableRevision(scope, channel) > 0) {
        durableDocument = true;
      }
      return { ...result, document };
    },
    saveDocument(draft) {
      if (!active()) return Promise.reject(expired());
      return repository
        .save(scope, channel, draft, documentWrites.signal, attachments.attachmentRevisions?.())
        .then(() => {
          if (!active()) throw expired();
          loaded = true;
          // Aborted repository saves resolve without committing. Do not treat
          // switching to temporary mode as an acknowledged legacy import.
          if (!documentWrites.signal.aborted && repository.durableRevision(scope, channel) > 0) {
            durableDocument = true;
          }
        });
    },
    hasDurableDocument: () => active() && durableDocument,
    async mergeDocumentConflict(draft) {
      if (!active()) throw expired();
      await repository.mergeConflict(scope, channel, draft, documentWrites.signal, attachments.attachmentRevisions?.());
    },
    stopDocumentSaving() {
      stoppedRevision ??= repository.durableRevision(scope, channel);
      documentWrites.abort();
      repository.forgetCancelledDocument(scope, channel, documentWrites.signal);
    },
    consumeStoppedDocument(retainedAttachmentIds = [], attachmentRevisions) {
      // A late send must not adopt the repository's post-logout session.
      if (!active()) return Promise.reject(expired());
      if (stoppedRevision === undefined) return Promise.resolve();
      return repository.consumeDocument(
        scope,
        channel,
        stoppedRevision,
        retainedAttachmentIds,
        attachmentRevisions
      );
    },
    async flushDocument() {
      if (!active()) throw expired();
      await repository.flush(key);
      if (!active()) throw expired();
    },
    recoverDocument(attemptId, recovered) {
      if (!active()) return Promise.reject(expired());
      const current = repository.records.get(key)?.draft;
      return repository.save(
        scope,
        channel,
        mergeRecoveredDraft(current, recovered, attemptId),
        documentWrites.signal,
        attachments.attachmentRevisions?.()
      );
    },
    canLeaveAttachments: (ids) => active() && attachments.canLeave(ids),
    canLeave: (ids) =>
      active() && loaded && attachments.canLeave(ids) && repository.saved(key),
  };
}
