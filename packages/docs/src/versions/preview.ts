// Version preview decode (feature #4 §1.3).
//
// A version's stored state is a binary Yjs update. To preview/diff it we build a
// THROWAWAY Y.Doc, apply the update, convert the collab XmlFragment to ProseMirror JSON,
// and immediately destroy the doc. This throwaway doc is NEVER given a provider or
// persistence and is never the editor's document, so decoding a version cannot disturb
// the live editor or sync any bytes upstream.

import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { COLLAB_FIELD } from '../schema/index.ts'
import type { PMNode } from './diff.ts'

/**
 * Decode a binary Yjs state blob to ProseMirror-JSON content (read-only use: preview render
 * + diff). The transient Y.Doc lives only for the duration of this call.
 */
export function stateToProsemirrorJSON(state: ArrayBuffer): PMNode {
  const ydoc = new Y.Doc()
  try {
    Y.applyUpdate(ydoc, new Uint8Array(state))
    return yDocToProsemirrorJSON(ydoc, COLLAB_FIELD) as PMNode
  } finally {
    ydoc.destroy()
  }
}
