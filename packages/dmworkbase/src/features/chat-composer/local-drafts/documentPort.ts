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
      return { ...result, document };
    },
    saveDocument(draft) {
      if (!active()) return Promise.reject(expired());
      return repository
        .save(scope, channel, draft, documentWrites.signal)
        .then(() => {
          if (!active()) throw expired();
          loaded = true;
        });
    },
    async mergeDocumentConflict(draft) {
      if (!active()) throw expired();
      await repository.mergeConflict(scope, channel, draft, documentWrites.signal);
    },
    stopDocumentSaving() {
      stoppedRevision ??= repository.durableRevision(scope, channel);
      documentWrites.abort();
      repository.forgetCancelledDocument(scope, channel, documentWrites.signal);
    },
    consumeStoppedDocument(retainedAttachmentIds = [], attachmentRevisions) {
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
        documentWrites.signal
      );
    },
    canLeaveAttachments: (ids) => active() && attachments.canLeave(ids),
    canLeave: (ids) =>
      active() && loaded && attachments.canLeave(ids) && repository.saved(key),
  };
}
