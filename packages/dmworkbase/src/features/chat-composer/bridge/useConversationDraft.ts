import { useEffect, useMemo } from "react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import type { ChatComposerAttachmentStore } from "../editor/attachmentStore";
import type { ChatComposerAttachmentDraftPort } from "../local-drafts";
import type { ConversationDraft } from "../local-drafts/model";

interface DraftAttachment {
  id: string;
  name: string;
  previewUrl?: string;
}

/** Keeps upload anchors in document coordinates while retaining the existing top tray. */
export function useConversationDraft<T extends DraftAttachment>(
  editor: Editor | null,
  store: ChatComposerAttachmentStore<T>,
  port: ChatComposerAttachmentDraftPort | undefined,
  isMounted: () => boolean,
  onError: (error: unknown) => void
) {
  const state = useMemo(
    () => ({
      ready: !port?.saveDocument,
      applying: false,
      anchors: new Map<string, number>(),
      frozen: new Set<string>(),
      recovered: new Set<string>(),
      errorShown: false,
    }),
    [port]
  );
  const capture = (): ConversationDraft => ({
    document: editor?.getJSON() ?? {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    recoveredAttemptIds: [...state.recovered],
    topAttachments: store.snapshotTopAttachments().map((item) => ({
      id: item.id,
      name: item.name,
      position:
        state.anchors.get(item.id) ?? editor?.state.doc.content.size ?? 0,
    })),
  });
  const save = () => {
    if (
      !state.ready ||
      state.applying ||
      !isMounted() ||
      editor?.isDestroyed ||
      !port?.saveDocument
    )
      return;
    void port.saveDocument(capture()).then(
      () => {
        state.errorShown = false;
      },
      (error) => {
        if (!state.errorShown && isMounted()) {
          state.errorShown = true;
          onError(error);
        }
      }
    );
  };
  useEffect(() => {
    if (!editor || !port?.saveDocument) return;
    const changed = () => save();
    const transaction = ({ transaction: tx }: { transaction: Transaction }) => {
      if (tx.docChanged && !state.applying) {
        state.anchors.forEach((position, id) => {
          if (!state.frozen.has(id))
            state.anchors.set(id, tx.mapping.map(position, -1));
        });
      }
      if (tx.docChanged) changed();
    };
    editor.on("transaction", transaction);
    const off = store.subscribe(changed);
    return () => {
      editor.off("transaction", transaction);
      off();
    };
  }, [editor, store, port, state]);
  return {
    capture,
    save,
    pause() {
      state.ready = false;
    },
    retryErrors() {
      state.errorShown = false;
    },
    freezeAnchors(ids: string[]) {
      ids.forEach((id) => state.frozen.add(id));
    },
    releaseAnchors(ids: string[]) {
      ids.forEach((id) => state.frozen.delete(id));
    },
    ready: () => state.ready,
    anchor(id: string, position = editor?.state.selection.from ?? 0) {
      state.frozen.delete(id);
      state.anchors.set(id, position);
    },
    applying(value: boolean) {
      state.applying = value;
    },
    restoreAnchors(draft: ConversationDraft) {
      draft.topAttachments.forEach((item) =>
        state.anchors.set(item.id, item.position)
      );
      draft.recoveredAttemptIds?.forEach((id) => state.recovered.add(id));
    },
    hasRecovery(id: string) {
      return state.recovered.has(id);
    },
    markRecovery(id: string) {
      state.recovered.add(id);
    },
    loaded() {
      state.ready = true;
      save();
    },
  };
}
