import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface RestoreMarker {
  from: number;
  to: number;
  id: string;
  blockKey: string;
}

type RestoreMarkerMeta = { type: "add"; markers: RestoreMarker[] };

const restorePrefixPluginKey = new PluginKey<DecorationSet>(
  "chatComposerRestorePrefix"
);
let nextRestoreMarkerId = 0;

export const RestorePrefixTracker = Extension.create({
  name: "chatComposerRestorePrefix",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: restorePrefixPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (transaction, decorations) => {
            let next = decorations.map(transaction.mapping, transaction.doc);
            const meta = transaction.getMeta(
              restorePrefixPluginKey
            ) as RestoreMarkerMeta | undefined;
            if (meta?.type === "add") {
              next = next.add(
                transaction.doc,
                meta.markers.map(({ from, to, id, blockKey }) =>
                  Decoration.node(
                    from,
                    to,
                    {},
                    { restoreMarkerId: id, restoreBlockKey: blockKey }
                  )
                )
              );
            }
            return next;
          },
        },
        props: {
          decorations: (state) => restorePrefixPluginKey.getState(state),
        },
      }),
    ];
  },
});

export function getRestoredBlockMarkerIds(editor: Editor): string[] {
  const decorations = restorePrefixPluginKey.getState(editor.state);
  if (!decorations) return [];

  const markersByPosition = new Map<
    number,
    { id: string; blockKey: string }
  >();
  decorations.find().forEach((decoration) => {
    const id = decoration.spec.restoreMarkerId;
    const blockKey = decoration.spec.restoreBlockKey;
    if (typeof id === "string" && typeof blockKey === "string") {
      markersByPosition.set(decoration.from, { id, blockKey });
    }
  });

  const markerIds: string[] = [];
  let position = 0;
  for (let index = 0; index < editor.state.doc.childCount; index += 1) {
    const marker = markersByPosition.get(position);
    if (!marker) break;
    const blockKey = JSON.stringify(editor.state.doc.child(index).toJSON());
    if (marker.blockKey !== blockKey) break;
    markerIds.push(marker.id);
    position += editor.state.doc.child(index).nodeSize;
  }
  return markerIds;
}

export function markRestoredBlocks(
  editor: Editor,
  blockOffset: number,
  blockCount: number
): string[] {
  if (blockCount <= 0) return getRestoredBlockMarkerIds(editor);

  const markers: RestoreMarker[] = [];
  const limit = Math.min(blockOffset, editor.state.doc.childCount);
  let position = 0;
  for (let index = 0; index < limit; index += 1) {
    position += editor.state.doc.child(index).nodeSize;
  }
  for (
    let index = limit;
    index < Math.min(limit + blockCount, editor.state.doc.childCount);
    index += 1
  ) {
    const node = editor.state.doc.child(index);
    markers.push({
      from: position,
      to: position + node.nodeSize,
      id: `restore-${++nextRestoreMarkerId}`,
      blockKey: JSON.stringify(node.toJSON()),
    });
    position += node.nodeSize;
  }

  if (markers.length > 0) {
    editor.view.dispatch(
      editor.state.tr.setMeta(restorePrefixPluginKey, {
        type: "add",
        markers,
      } satisfies RestoreMarkerMeta)
    );
  }
  return getRestoredBlockMarkerIds(editor);
}
