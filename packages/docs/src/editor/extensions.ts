// Editor extension assembly (frontend-design §3.2 / §4.2).
//
// CRITICAL: StarterKit's undo/redo is disabled (Tiptap v3 renamed the `history`
// option to `undoRedo`) — collaborative undo/redo comes from the Collaboration
// extension (yUndo), and a local history plugin would conflict with it.
// StarterKit's codeBlock is also disabled — it is replaced by CodeBlockLowlight
// (syntax highlighting); leaving the StarterKit codeBlock on would register a second
// node with the same name and conflict. StarterKit's `link` is disabled too: v3
// bundles Link into StarterKit, but docs installs a sanitised Link separately, so
// leaving the bundled one on would register a duplicate `link` mark.
// All ProseMirror imports stay on @tiptap/pm (single instance, §2.2).

import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { BlockDragHandle } from './BlockDragHandle.ts'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TableCellView } from './TableCellView.ts'
import { OctoImage } from './ImageNode.ts'
import { CommentHighlight } from '../comments/CommentDecorations.ts'
import type { Extensions } from '@tiptap/core'
import type * as Y from 'yjs'
import type { HocuspocusProvider } from '@hocuspocus/provider'

import { COLLAB_FIELD } from '../schema/index.ts'
import { colorFromId, type OctoAwarenessUser } from '../awareness/presence.ts'
import { sanitizeLinkHref } from './sanitize.ts'
import { SlashCommand } from './SlashCommand.ts'

// Shared lowlight registry for code-block syntax highlighting. `common` covers
// the widely-used languages (js/ts/python/go/json/bash/html/css/…) without pulling
// in every highlight.js grammar. Unknown languages fall back to plain text.
export function createDocsLowlight() {
  return createLowlight(common)
}

const lowlight = createDocsLowlight()

export interface BuildExtensionsOptions {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: Pick<OctoAwarenessUser, 'id' | 'name' | 'avatar'>
  /** Doc id for the image node's presign/read REST paths (frontend-design §3.5). */
  docId: string
}

export function buildExtensions(opts: BuildExtensionsOptions): Extensions {
  const { ydoc, provider, user, docId } = opts
  return [
    StarterKit.configure({
      undoRedo: false, // MUST be off — yUndo handles collaborative history (v3 renamed `history`).
      codeBlock: false, // MUST be off — replaced by CodeBlockLowlight (same node name).
      link: false, // MUST be off — v3 bundles Link; docs installs a sanitised Link separately.
    }),
    Collaboration.configure({
      document: ydoc,
      field: COLLAB_FIELD,
    }),
    CollaborationCaret.configure({
      provider,
      user: { id: user.id, name: user.name, color: colorFromId(user.id), avatar: user.avatar },
    }),
    Link.extend({
      // Sanitize at parse and render: only http/https/mailto links survive (§3.7).
    }).configure({
      autolink: true,
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer' },
      validate: (href) => sanitizeLinkHref(href) !== null,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // SCHEMA-SPEC §3 (SCHEMA_VERSION 3): text highlight + colour.
    // multicolor:true stores the chosen colour as the highlight mark's `color`
    // attr → <mark style="background-color:…">. TextStyle is the carrier mark for
    // Color (extension-color adds no node/mark, it only sets textStyle's color
    // attr → <span style="color:…">). TextStyle MUST be registered before Color.
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    // Code block with syntax highlighting. Replaces StarterKit's plain codeBlock
    // (disabled above) — same node name `codeBlock`, so existing documents keep
    // working; lowlight tokenises the content for highlight.js themes.
    CodeBlockLowlight.configure({ lowlight }),
    // Self-built block drag handle (no Tiptap Pro); reorders top-level blocks via
    // ProseMirror's native drag pipeline, so moves sync as ordinary transactions.
    BlockDragHandle,
    // SCHEMA-SPEC §4 (SCHEMA_VERSION 4): tables. extension-table series pinned at
    // 2.27.2 (matching the stack — v3 would pull a second Tiptap core). Column
    // resizing is on; cells use a self-built NodeView (TableCellView) that gives
    // ProseMirror explicit ignoreMutation/stopEvent rules so resize/remote DOM
    // writes don't desync collaborative cursors (§3.2 requirement).
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader.extend({
      addNodeView() {
        return ({ node }) => new TableCellView(node, 'th')
      },
    }),
    TableCell.extend({
      addNodeView() {
        return ({ node }) => new TableCellView(node, 'td')
      },
    }),
    // SCHEMA-SPEC §2 (SCHEMA_VERSION 2): image node. Extends @tiptap/extension-image
    // (pinned 2.27.2, single core) with the backend-aligned attr set + parse/render
    // mapping and a self-built NodeView. docId is threaded so the NodeView and the
    // paste/drop upload flow can hit the presign/read REST paths. Never stores base64
    // — only the durable attachId + a controlled storage URL (§3.5).
    OctoImage.configure({ docId }),
    Placeholder.configure({
      placeholder: "Type '/' for commands…",
    }),
    SlashCommand,
    // View-only comment highlight layer (feature #3 §). Paints inline decorations for the
    // current comment anchors; never writes to the Y.Doc (like CollaborationCaret), so it
    // does not disturb collaboration. React pushes anchors via the setCommentAnchors command.
    CommentHighlight,
  ]
}

// Read-only preview/diff extension set (feature #4 §1.3). Mirrors the SAME node/mark
// schema as the live editor (so a historical version renders faithfully) but OMITS the
// live-only machinery: NO Collaboration / CollaborationCaret (no Y.Doc binding, no
// provider), NO editing affordances (BlockDragHandle / SlashCommand / Placeholder). The
// resulting Editor is built with editable:false and a throwaway document, so it never
// touches the live collaborative editor. Table cells use the plain extensions here — the
// TableCellView NodeView exists only to keep collaborative carets in sync, which a static
// preview doesn't have.
export function buildPreviewExtensions(docId: string): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false, // no local history in a static preview (v3 renamed `history`).
      codeBlock: false, // replaced by CodeBlockLowlight (same node name).
      link: false, // v3 bundles Link; docs installs a sanitised Link separately.
    }),
    Link.configure({
      autolink: true,
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer' },
      validate: (href) => sanitizeLinkHref(href) !== null,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    CodeBlockLowlight.configure({ lowlight }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    OctoImage.configure({ docId, uploads: false }),
  ]
}
