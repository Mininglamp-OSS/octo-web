import type { JSONContent } from "@tiptap/core";
import { formatDraftPreview } from "../../../Utils/draftPreview";

export interface DraftScope {
  server: string;
  account: string;
  space: string;
}
export interface DraftChannel {
  id: string;
  type: number;
}
export interface DraftTopAttachment {
  id: string;
  name: string;
  position: number;
}
export interface ConversationDraft {
  document: JSONContent;
  topAttachments: DraftTopAttachment[];
  recoveredAttemptIds?: string[];
  /** ProseMirror leaf node names needed to size extension-provided atoms. */
  leafNodeTypes?: string[];
}

export const DEFAULT_DRAFT_LEAF_NODE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "attachment",
  "mention",
  "hardBreak",
]);

export function draftDocumentSize(
  node: JSONContent,
  extensionLeafNodeTypes: ReadonlySet<string> = new Set()
): number {
  if (node.type === "text") return node.text?.length ?? 0;
  if (
    DEFAULT_DRAFT_LEAF_NODE_TYPES.has(node.type ?? "") ||
    extensionLeafNodeTypes.has(node.type ?? "")
  )
    return 1;
  return (node.content ?? []).reduce(
    (size, child) => size + draftDocumentSize(child, extensionLeafNodeTypes),
    node.type === "doc" ? 0 : 2
  );
}

export function mergeRecoveredDraft(
  current: ConversationDraft | undefined,
  recovered: ConversationDraft,
  attemptId: string
): ConversationDraft {
  if (current?.recoveredAttemptIds?.includes(attemptId)) return current;
  const recoveredLeafNodeTypes = new Set(recovered.leafNodeTypes ?? []);
  const offset = draftDocumentSize(recovered.document, recoveredLeafNodeTypes);
  const ids = new Set(recovered.topAttachments.map((item) => item.id));
  return {
    document: {
      type: "doc",
      content: [
        ...(recovered.document.content ?? []),
        ...(current?.document.content ?? []),
      ],
    },
    topAttachments: [
      ...recovered.topAttachments,
      ...(current?.topAttachments ?? [])
        .filter((item) => !ids.has(item.id))
        .map((item) => ({ ...item, position: item.position + offset })),
    ],
    recoveredAttemptIds: [
      ...new Set([
        ...(current?.recoveredAttemptIds ?? []),
        ...(recovered.recoveredAttemptIds ?? []),
        attemptId,
      ]),
    ],
    ...(recovered.leafNodeTypes?.length || current?.leafNodeTypes?.length
      ? {
          leafNodeTypes: [
            ...new Set([
              ...(recovered.leafNodeTypes ?? []),
              ...(current?.leafNodeTypes ?? []),
            ]),
          ],
        }
      : {}),
  };
}
export interface DraftRecord {
  key: string;
  scope: string;
  account: string;
  revision: number;
  draft: ConversationDraft;
  preview: string;
  /** A successful temporary send consumed this revision. Keep the record so
   * revisions never restart and legacy migration cannot import it again. */
  consumed?: true;
}
export const emptyConversationDraft = (): ConversationDraft => ({
  document: { type: "doc", content: [{ type: "paragraph" }] },
  topAttachments: [],
});
export const draftAccountKey = (scope: DraftScope) =>
  JSON.stringify([scope.server, scope.account]);
export const draftScopeKey = (scope: DraftScope) =>
  JSON.stringify([scope.server, scope.account, scope.space]);
export const draftKey = (scope: DraftScope, channel: DraftChannel) =>
  JSON.stringify([
    scope.server,
    scope.account,
    scope.space,
    channel.type,
    channel.id,
  ]);

/** Blob URLs belong to one editor lifetime; never persist or reuse them. */
export function cleanDraftDocument(node: JSONContent): JSONContent {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (attrs) delete attrs.previewUrl;
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map(cleanDraftDocument) } : {}),
  };
}

/** Positions use ProseMirror coordinates, including paragraph boundaries. */
export function conversationDraftPreview(draft: ConversationDraft): string {
  const leafNodeTypes = new Set(draft.leafNodeTypes ?? []);
  const anchors = [...draft.topAttachments].sort(
    (a, b) => a.position - b.position
  );
  let anchor = 0;
  let result = "";
  const insert = (position: number) => {
    while (anchor < anchors.length && anchors[anchor].position <= position) {
      result += `[${anchors[anchor++].name}]`;
    }
  };
  const visit = (node: JSONContent, position: number): number => {
    insert(position);
    if (node.type === "text") {
      const value = node.text ?? "";
      for (let i = 0; i < value.length; i++) {
        insert(position + i);
        result += value[i];
      }
      return value.length;
    }
    if (node.type === "attachment") {
      result += `[${node.attrs?.name ?? ""}]`;
      return 1;
    }
    if (node.type === "mention") {
      result += formatDraftPreview(`@[${node.attrs?.id}:${node.attrs?.label}]`);
      return 1;
    }
    if (node.type === "hardBreak") {
      result += " ";
      return 1;
    }
    if (
      DEFAULT_DRAFT_LEAF_NODE_TYPES.has(node.type ?? "") ||
      leafNodeTypes.has(node.type ?? "")
    )
      return 1;
    let offset = node.type === "doc" ? 0 : 1;
    (node.content ?? []).forEach((child) => {
      offset += visit(child, position + offset);
    });
    insert(position + offset);
    if (node.type !== "doc") result += " ";
    return offset + (node.type === "doc" ? 0 : 1);
  };
  visit(draft.document, 0);
  insert(Infinity);
  return result.replace(/[\r\n\t]+/g, " ").trim();
}

/** Explicit conflict recovery retains both texts and each attachment identity once. */
export function mergeConflictingDrafts(
  local: ConversationDraft,
  remote: ConversationDraft,
  revision: number
): ConversationDraft {
  const remoteLeafNodeTypes = new Set(remote.leafNodeTypes ?? []);
  const ids = new Set(local.topAttachments.map((item) => item.id));
  const collect = (node: JSONContent) => {
    if (node.type === "attachment") ids.add(node.attrs?.id);
    node.content?.forEach(collect);
  };
  collect(local.document);
  const removed: number[] = [];
  const deduplicate = (node: JSONContent, position: number): JSONContent[] => {
    if (node.type === "attachment" && ids.has(node.attrs?.id)) {
      removed.push(position);
      return [];
    }
    let offset = node.type === "doc" ? 0 : 1;
    return [
      {
        ...node,
        ...(node.content
          ? {
              content: node.content.flatMap((child) => {
                const result = deduplicate(child, position + offset);
                offset += draftDocumentSize(child, remoteLeafNodeTypes);
                return result;
              }),
            }
          : {}),
      },
    ];
  };
  const document = deduplicate(remote.document, 0)[0];
  return mergeRecoveredDraft(
    {
      ...remote,
      document,
      topAttachments: remote.topAttachments.map((item) => ({
        ...item,
        position:
          item.position -
          removed.filter((position) => position < item.position).length,
      })),
    },
    local,
    `conflict:${revision}`
  );
}
