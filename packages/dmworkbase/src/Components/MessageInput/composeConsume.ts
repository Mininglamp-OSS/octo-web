/**
 * Synchronous compose consumption for `MessageInput.send()` (octo-web#1280).
 *
 * The composer is emptied the moment a send starts and only restored if the send
 * never got enqueued (see `sendFlow.ts` for the whole model). All of that logic
 * lives here rather than inline in the component so it can be unit-tested
 * against a **real** Tiptap editor: mid-flight typing, partial attachment
 * failures and a destroyed editor are exactly the cases that used to be covered
 * only by `vi.fn()` spies (#1280 review).
 *
 * Nothing in this module touches React.
 */

import type {
  ConsumedCompose,
  ConsumedComposeIds,
  UnsentEditorBlock,
} from "./sendFlow";
import { restoreComposeSnapshot } from "./sendFlow";

/** Minimal document node shape we need from the editor JSON. */
export interface ComposeNode {
  type?: string;
  attrs?: { id?: string; previewUrl?: string; [key: string]: unknown };
  content?: ComposeNode[];
  [key: string]: unknown;
}

export interface ComposeDoc extends ComposeNode {
  content?: ComposeNode[];
}

/** The editor operations the consume/restore flow needs. */
export interface ComposeEditorPort {
  getJSON: () => ComposeDoc;
  isEmpty: () => boolean;
  /** True once the editor instance is gone (unmount / channel switch). */
  isDestroyed: () => boolean;
  clearContent: () => void;
  setContent: (doc: ComposeDoc) => void;
  /** Insert nodes after `blockOffset` leading top-level blocks. */
  insertContentAtBlock: (blockOffset: number, nodes: ComposeNode[]) => void;
  appendContent: (nodes: ComposeNode[]) => void;
  focusEnd: () => void;
}

export interface TopAttachmentLike {
  id: string;
  previewUrl?: string;
}

/**
 * Thrown when a compose cannot be given back because the editor no longer
 * exists (the user switched conversation while the send was in flight). The
 * caller is expected to surface this — silently dropping content that is in
 * neither the composer nor the message list is the failure mode #1280 is about.
 */
export class ComposeRestoreUnavailableError extends Error {
  constructor(message = "editor is destroyed, compose cannot be restored") {
    super(message);
    this.name = "ComposeRestoreUnavailableError";
  }
}

export interface ConsumeComposeOptions {
  editor: ComposeEditorPort;
  /** In-memory pasted-image files, keyed by attachment node id. */
  attachmentFiles: Map<string, File>;
  /** Live top-attachment list accessor/mutator (kept outside this module). */
  getTopAttachments: () => TopAttachmentLike[];
  setTopAttachments: (items: TopAttachmentLike[]) => void;
  /** Injectable for tests / non-browser environments. */
  revokeObjectURL?: (url: string) => void;
  /**
   * Turn a send-format text block back into document nodes when only part of the
   * compose is restored (mentions come back as nodes). Defaults to plain text.
   */
  parseTextToNodes?: (text: string) => ComposeNode[];
  /** Extra side effects to undo when the whole compose is restored. */
  onRestoreCompose?: () => void;
  /**
   * Restore ordering across consecutive failures (#1280 review). Two queued
   * sends that both fail must come back as `A, B, <live draft>`, not `B, A`, so
   * each restore starts after the blocks/attachments earlier restores put back.
   */
  getRestoreOffsets?: () => { blocks: number; topAttachments: number };
  onRestored?: (restored: { blocks: number; topAttachments: number }) => void;
  /** Reported when a restore/dispose step throws (see ConsumedCompose). */
  onRestoreError?: (err: unknown, step: string) => void;
}

export interface ConsumedComposeHandle {
  ids: ConsumedComposeIds;
  compose: ConsumedCompose;
  /** The document that was taken out of the editor (for draft persistence). */
  snapshot: ComposeDoc;
}

/** Collect attachment nodes (inline atoms) from a document snapshot, in order. */
function collectAttachmentNodes(doc: ComposeDoc): ComposeNode[] {
  const found: ComposeNode[] = [];
  const walk = (node: ComposeNode | undefined) => {
    if (!node) return;
    if (node.type === "attachment" && node.attrs?.id) {
      found.push(node);
      return;
    }
    node.content?.forEach(walk);
  };
  doc.content?.forEach(walk);
  return found;
}

/**
 * Take the current compose out of the composer and return the hooks
 * `runSendWithConsumedCompose` needs.
 *
 * Consumption is synchronous and unconditional: the editor is cleared and the
 * top attachments handed to this send are removed before any await, so a send
 * that resolves later can never fight with what the user typed meanwhile.
 */
export function consumeCompose(
  opts: ConsumeComposeOptions,
): ConsumedComposeHandle {
  const {
    editor,
    attachmentFiles,
    getTopAttachments,
    setTopAttachments,
    onRestoreCompose,
    onRestoreError,
  } = opts;
  const parseTextToNodes =
    opts.parseTextToNodes ??
    ((value: string) => [
      { type: "paragraph", content: [{ type: "text", text: value }] },
    ]);
  const revokeObjectURL =
    opts.revokeObjectURL ??
    ((url: string) => {
      if (typeof URL !== "undefined" && URL.revokeObjectURL) {
        URL.revokeObjectURL(url);
      }
    });

  const snapshot = editor.getJSON();
  const attachmentNodes = collectAttachmentNodes(snapshot);
  const editorAttachmentIds = attachmentNodes
    .map((node) => node.attrs?.id)
    .filter((id): id is string => typeof id === "string");
  const previewUrlById = new Map<string, string | undefined>();
  attachmentNodes.forEach((node) => {
    if (node.attrs?.id) {
      previewUrlById.set(node.attrs.id, node.attrs.previewUrl);
    }
  });

  const topItemsAtSend = getTopAttachments().slice();
  const topIds = topItemsAtSend.map((item) => item.id);

  // ── consume ──────────────────────────────────────────────────────────────
  editor.clearContent();
  if (topIds.length > 0) {
    const consumed = new Set(topIds);
    setTopAttachments(getTopAttachments().filter((a) => !consumed.has(a.id)));
  }

  const assertRestorable = () => {
    if (editor.isDestroyed()) {
      throw new ComposeRestoreUnavailableError();
    }
  };

  const restoreTarget = {
    isEmpty: () => editor.isEmpty(),
    setContent: (doc: unknown) => editor.setContent(doc as ComposeDoc),
    focusEnd: () => editor.focusEnd(),
    insertContentAtBlock: (blockOffset: number, nodes: unknown[]) =>
      editor.insertContentAtBlock(blockOffset, nodes as ComposeNode[]),
    appendContent: (nodes: unknown[]) =>
      editor.appendContent(nodes as ComposeNode[]),
  };

  const offsets = () =>
    opts.getRestoreOffsets?.() ?? { blocks: 0, topAttachments: 0 };
  const restoreDoc = (snapshotToRestore: ComposeDoc) => {
    const inserted = restoreComposeSnapshot(
      snapshotToRestore,
      restoreTarget,
      offsets().blocks,
    );
    opts.onRestored?.({ blocks: inserted, topAttachments: 0 });
  };

  const compose: ConsumedCompose = {
    restoreEditor: () => {
      // Side effects that belong to "the whole compose came back" (reply/edit
      // target, expanded state) run FIRST, so a document restore that throws
      // cannot skip them (#1280 review).
      onRestoreCompose?.();
      assertRestorable();
      restoreDoc(snapshot);
    },
    restoreEditorBlocks: (blocks: UnsentEditorBlock[]) => {
      assertRestorable();
      const nodeById = new Map<string, ComposeNode>();
      attachmentNodes.forEach((node) => {
        if (node.attrs?.id) nodeById.set(node.attrs.id, node);
      });

      const content: ComposeNode[] = [];
      let inline: ComposeNode[] = [];
      const flushInline = () => {
        if (inline.length === 0) return;
        // Attachment nodes are inline atoms, so they need a block wrapper.
        content.push({ type: "paragraph", content: inline });
        inline = [];
      };
      blocks.forEach((block) => {
        if (block.type === "attachment") {
          const node = nodeById.get(block.id);
          if (node) inline.push(node);
          return;
        }
        if (block.text.trim() === "") return;
        flushInline();
        content.push(...parseTextToNodes(block.text));
      });
      flushInline();

      if (content.length === 0) return;
      restoreDoc({ type: "doc", content });
    },
    disposeEditorAttachments: (ids: string[]) => {
      ids.forEach((id) => {
        attachmentFiles.delete(id);
        const previewUrl = previewUrlById.get(id);
        if (previewUrl) revokeObjectURL(previewUrl);
      });
    },
    disposeTopAttachments: (ids: string[]) => {
      const wanted = new Set(ids);
      topItemsAtSend.forEach((item) => {
        if (wanted.has(item.id) && item.previewUrl) {
          revokeObjectURL(item.previewUrl);
        }
      });
    },
    restoreTopAttachments: (ids: string[]) => {
      const wanted = new Set(ids);
      const restored = topItemsAtSend.filter((item) => wanted.has(item.id));
      if (restored.length === 0) return;
      const live = getTopAttachments();
      const liveIds = new Set(live.map((item) => item.id));
      const fresh = restored.filter((item) => !liveIds.has(item.id));
      if (fresh.length === 0) return;
      // Keep the original relative order of the restored items, insert them
      // after items an earlier failed send already restored, and never duplicate
      // an item the user re-added during the await.
      const offset = Math.min(offsets().topAttachments, live.length);
      setTopAttachments([
        ...live.slice(0, offset),
        ...fresh,
        ...live.slice(offset),
      ]);
      opts.onRestored?.({ blocks: 0, topAttachments: fresh.length });
    },
    onRestoreError,
  };

  return { ids: { topIds, editorAttachmentIds }, compose, snapshot };
}

/** Plain text of a compose snapshot — used for draft persistence / previews. */
export function composeSnapshotText(doc: ComposeDoc | undefined): string {
  if (!doc?.content) return "";
  const parts: string[] = [];
  const walk = (node: ComposeNode | undefined) => {
    if (!node) return;
    if (node.type === "text" && typeof node.text === "string") {
      parts.push(node.text);
      return;
    }
    if (node.type === "mention") {
      const label = node.attrs?.label;
      if (typeof label === "string") parts.push(`@${label}`);
      return;
    }
    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    node.content?.forEach(walk);
  };
  doc.content.forEach((node, index) => {
    if (index > 0) parts.push("\n");
    walk(node);
  });
  return parts.join("").trim();
}
