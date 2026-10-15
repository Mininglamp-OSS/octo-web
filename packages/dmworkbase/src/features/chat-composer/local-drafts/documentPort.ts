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

export function withConversationDocument(
  attachments: ChatComposerAttachmentDraftPort,
  scope: DraftScope,
  channel: DraftChannel,
  repository: ConversationDraftRepository = conversationDrafts
): ChatComposerAttachmentDraftPort {
  const epoch = repository.epoch(scope);
  void repository.session(scope).catch(() => {});
  const key = draftKey(scope, channel);
  let loaded = false;
  return {
    ...attachments,
    async restore() {
      const [result, document] = await Promise.all([
        attachments.restore(),
        repository.load(scope, channel),
      ]);
      if (!repository.active(scope, epoch))
        return { attachments: [], failedCount: 0 };
      loaded = true;
      return { ...result, document };
    },
    saveDocument(draft) {
      if (!repository.active(scope, epoch)) return Promise.resolve();
      return repository.save(scope, channel, draft).then(() => {
        loaded = true;
      });
    },
    async mergeDocumentConflict(draft) {
      if (!repository.active(scope, epoch))
        throw new Error("Draft session expired");
      await repository.mergeConflict(scope, channel, draft);
    },
    flushDocument: () => repository.flush(key),
    recoverDocument(attemptId, recovered) {
      if (!repository.active(scope, epoch)) return Promise.resolve();
      const current = repository.records.get(key)?.draft;
      return repository.save(
        scope,
        channel,
        mergeRecoveredDraft(current, recovered, attemptId)
      );
    },
    canLeave: (ids) =>
      loaded && attachments.canLeave(ids) && repository.saved(key),
  };
}
