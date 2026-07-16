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
import { TextStyle, FontSize, FontFamily } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import { LineHeight } from './LineHeight.ts'
import Underline from '@tiptap/extension-underline'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { Mathematics } from '@tiptap/extension-mathematics'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { BlockDragHandle } from './BlockDragHandle.ts'
import { ParagraphIndent } from './ParagraphIndent.ts'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TableCellView } from './TableCellView.ts'
import { TableReorderHandle } from './TableReorderHandle.ts'
import { OctoImage } from './ImageNode.ts'
import { CommentHighlight } from '../comments/CommentDecorations.ts'
import { buildEmoji } from './emoji.ts'
import { buildMention } from './mention.ts'
import { Callout } from './Callout.ts'
import { FileAttachment } from './FileAttachment.ts'
import { Bookmark } from './Bookmark.ts'
import type { Extensions } from '@tiptap/core'
import type * as Y from 'yjs'
import type { HocuspocusProvider } from '@hocuspocus/provider'

// KaTeX stylesheet — required for the math nodes (SCHEMA_VERSION 13) to render. katex is
// installed at the repo root (katex ^0.16.45); the CSS is imported once here so both the live
// editor and the read-only preview pick up the math typography.
import 'katex/dist/katex.min.css'

import { Plugin, PluginKey } from '@tiptap/pm/state'
import { COLLAB_FIELD } from '../schema/index.ts'
import { FONT_FAMILY_ENABLED } from '../config.ts'
import { colorFromId, type OctoAwarenessUser } from '../awareness/presence.ts'
import { sanitizeLinkHref, stripPastedFontFamily } from './sanitize.ts'
import { SlashCommand } from './SlashCommand.ts'
import { FindReplace } from './findReplace.ts'
import CharacterCount from '@tiptap/extension-character-count'

// Shared lowlight registry for code-block syntax highlighting. `common` covers
// the widely-used languages (js/ts/python/go/json/bash/html/css/…) without pulling
// in every highlight.js grammar. Unknown languages fall back to plain text.
export function createDocsLowlight() {
  return createLowlight(common)
}

const lowlight = createDocsLowlight()

// SCHEMA_VERSION 16: FontFamily is registered UNCONDITIONALLY (schema must always know the
// `fontFamily` textStyle attr so this bundle round-trips stored fonts faithfully). But the
// FONT_FAMILY_ENABLED flag must gate every WRITE path, not just the toolbar selector. Paste is
// the second write path: FontFamily.parseHTML(element.style.fontFamily) runs on pasted HTML
// regardless of the flag, so a `<span style="font-family:…">` pasted from Word/browser would
// land fontFamily in the shared Y.Doc while the flag is off — an older client (no attr in its
// schema) opening the same doc then silently strips it (data loss). This paste guard strips the
// inline font-family from pasted HTML while the flag is off; parsing/rendering already-stored
// content is untouched (round-trip stays intact). When the flag is on, the transform is identity.
// Exported so the paste-gate can be exercised through the real ProseMirror plugin (not by
// calling the sanitizer directly) in fontFamilyPaste.test.ts.
export const LiveFontFamily = FontFamily.extend({
  // Harden the `fontFamily` textStyle attribute on the parse (write-from-HTML) path. Two jobs:
  //
  //  1. FLAG-OFF BACKSTOP. transformPastedHTML below strips font-family from pasted HTML, but
  //     that textual pass keys on what it can see in the string. The authoritative gate is
  //     here: parseHTML reads the *browser-resolved* `element.style.fontFamily`, so whatever
  //     the CSSOM resolved a family to — including comment/escape/whitespace-encoded property
  //     names that a purely textual strip might not model — is visible at this point. With the
  //     write flag off we normalize that resolved family to null (the schema default), so NO
  //     fontFamily value can reach the shared Y.Doc from any HTML parse, by construction. This
  //     is a WRITE gate, not a read gate: collaborative round-trip loads from the Y.Doc (not
  //     HTML parseHTML), and with the flag off no font is ever written to begin with, so there
  //     is nothing legitimate to strip on read. When the flag is on this is a pass-through.
  //  2. EMPTY→NULL (flag-on, universally correct). When the flag is on, a `font` shorthand whose
  //     family the sanitizer removed (`font: 14px Georgia` → `font-size: 14px`) still parses
  //     through here with `element.style.fontFamily === ""`; upstream would store that "" as a
  //     real `fontFamily=""` key. An empty family is never meaningful, so we default it out to
  //     null. A real family (flag on, or a stored font) is non-empty and passes through
  //     untouched, so the toolbar write path and round-trip stay intact.
  addGlobalAttributes() {
    return (this.parent?.() ?? []).map((group) =>
      group.attributes && 'fontFamily' in group.attributes
        ? {
            ...group,
            attributes: {
              ...group.attributes,
              fontFamily: {
                ...group.attributes.fontFamily,
                parseHTML: (element: HTMLElement) => {
                  if (!FONT_FAMILY_ENABLED) return null // flag-off backstop: nothing reaches the Y.Doc
                  const family = (element.style.fontFamily ?? '').trim()
                  return family === '' ? null : family
                },
              },
            },
          }
        : group,
    )
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey('fontFamilyPasteGate'),
        props: {
          transformPastedHTML: (html) =>
            FONT_FAMILY_ENABLED ? html : stripPastedFontFamily(html),
        },
      }),
    ]
  },
})

export interface BuildExtensionsOptions {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: Pick<OctoAwarenessUser, 'id' | 'name' | 'avatar'>
  /** Doc id for the image node's presign/read REST paths (frontend-design §3.5). */
  docId: string
  /** Current space id — scopes the @people mention source (SCHEMA_VERSION 10). */
  spaceId?: string
}

export function buildExtensions(opts: BuildExtensionsOptions): Extensions {
  const { ydoc, provider, user, docId, spaceId } = opts
  return [
    StarterKit.configure({
      undoRedo: false, // MUST be off — yUndo handles collaborative history (v3 renamed `history`).
      codeBlock: false, // MUST be off — replaced by CodeBlockLowlight (same node name).
      link: false, // MUST be off — v3 bundles Link; docs installs a sanitised Link separately.
      underline: false, // MUST be off — v3 bundles Underline; docs installs it standalone (v6, same pattern as link).
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
    // SCHEMA-SPEC §6 (SCHEMA_VERSION 7): font size. FontSize ships inside
    // @tiptap/extension-text-style (there is no standalone @tiptap/extension-font-size at
    // 3.22.2); it adds a `fontSize` global attribute to the textStyle mark → <span
    // style="font-size:…">. MUST be registered after TextStyle (its carrier mark).
    FontSize,
    // SCHEMA-SPEC §6 (SCHEMA_VERSION 16): font family. FontFamily also ships inside
    // @tiptap/extension-text-style (there is no standalone @tiptap/extension-font-family at
    // 3.22.2); it adds a `fontFamily` global attribute to the textStyle mark → <span
    // style="font-family:…">. MUST be registered after TextStyle (its carrier mark), same as
    // FontSize. Registered UNCONDITIONALLY — the schema must always know the attr so this bundle
    // round-trips fonts faithfully and never strips them; the toolbar *entry* is what the
    // FONT_FAMILY_ENABLED flag gates (Toolbar.tsx), not the schema. This is the byte-aligned
    // counterpart of the backend fontFamily attr under the shared SCHEMA_VERSION 16 contract.
    // Uses LiveFontFamily (FontFamily + a paste-write gate) so the FONT_FAMILY_ENABLED flag
    // also covers the paste write path, not just the toolbar selector — see LiveFontFamily above.
    LiveFontFamily,
    // heading + paragraph nodes (not a new node/mark) → style="text-align:…". Configured for
    // exactly those two types so lists/tables/etc. keep their own layout.
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    // SCHEMA-SPEC §1 (SCHEMA_VERSION 17): line spacing. Self-built global attrs lineHeight +
    // spaceBefore/spaceAfter on heading + paragraph (no official Tiptap line-height extension),
    // replicating TextAlign → merged into a single style="…" declaration. MUST be registered
    // AFTER TextAlign so the canonical style property order (text-align; line-height; margin-top;
    // margin-bottom) holds for byte-alignment with the backend toDOM. Two-sided sanitise.
    LineHeight,
    // SCHEMA-SPEC §16 (SCHEMA_VERSION 18): paragraph/heading indent. A global `indent` attr on
    // the heading + paragraph nodes (not a new node/mark), rendered via margin-left and round-
    // tripped as data-indent. Configured for the same two types as TextAlign so lists keep their
    // own Tab/Shift-Tab sink/lift behavior untouched. Registered AFTER LineHeight so the
    // margin-left declaration is appended last, matching the backend toDOM style order.
    ParagraphIndent.configure({ types: ['heading', 'paragraph'] }),
    // SCHEMA-SPEC §3 (SCHEMA_VERSION 6): underline mark. StarterKit's bundled Underline is
    // disabled above; this standalone install is the single `underline` mark (same pattern as
    // the sanitised Link).
    Underline,
    // SCHEMA-SPEC §13 (SCHEMA_VERSION 8): superscript + subscript marks, landed together.
    // Mutually exclusive in the UI (toolbar x²/x₂) but independent marks in the schema.
    Superscript,
    Subscript,
    // Code block with syntax highlighting. Replaces StarterKit's plain codeBlock
    // (disabled above) — same node name `codeBlock`, so existing documents keep
    // working; lowlight tokenises the content for highlight.js themes.
    CodeBlockLowlight.configure({ lowlight }),
    // Self-built block drag handle (no Tiptap Pro); reorders top-level blocks via
    // ProseMirror's native drag pipeline, so moves sync as ordinary transactions.
    BlockDragHandle,
    // SCHEMA-SPEC §4 (SCHEMA_VERSION 4): tables. extension-table series pinned at
    // 3.22.2 (matching the Tiptap core). Column resizing is on; cells use a
    // self-built NodeView (TableCellView) that gives ProseMirror explicit
    // ignoreMutation/stopEvent rules so resize/remote DOM writes don't desync
    // collaborative cursors (§3.2 requirement).
    // #749: the default prosemirror-tables `handleWidth` (5px) only arms a ~10px band
    // straddling each column border, and the LAST column's right border sits flush with
    // the visible edge so its arm zone is effectively unreachable — dragging it did
    // nothing. Widen the arm band to 12px so every border, including the last column's
    // right edge, has a comfortable grab zone. `cellMinWidth` is pinned to prosemirror's
    // default (25) — kept explicit because it must stay >= handleWidth * 2 so adjacent
    // borders' arm bands never overlap on the narrowest columns (which would make a small
    // column impossible to grab/shrink).
    Table.configure({ resizable: true, handleWidth: 12, cellMinWidth: 25 }),
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
    // octo-docs-backend#76: table row/column drag-to-reorder. A self-built plugin renders
    // grab handles at the row-left / column-top edges and drives prosemirror-tables'
    // moveTableRow / moveTableColumn (single-transaction, TableMap-based, merge-aware) — see
    // TableReorderHandle.ts. Registered AFTER the Table series so its plugin sits above the
    // column-resize / tableEditing plugins. No schema change (pure reorder).
    TableReorderHandle,
    // SCHEMA-SPEC §2 (SCHEMA_VERSION 2): image node. Extends @tiptap/extension-image
    // (pinned 2.27.2, single core) with the backend-aligned attr set + parse/render
    // mapping and a self-built NodeView. docId is threaded so the NodeView and the
    // paste/drop upload flow can hit the presign/read REST paths. Never stores base64
    // — only the durable attachId + a controlled storage URL (§3.5).
    OctoImage.configure({ docId }),
    // SCHEMA-SPEC §8 (SCHEMA_VERSION 9): emoji inline atom node. Bundled GitHub emoji set;
    // inserts via `:shortcode:` suggestion or the toolbar picker.
    buildEmoji(),
    // SCHEMA-SPEC §10 (SCHEMA_VERSION 10): @-mention node. Two sources (@people via the seam,
    // @docs via docsApi.listDocs) merged into one '@' menu; clicking a doc mention navigates.
    buildMention({ spaceId }),
    // SCHEMA-SPEC §11 (SCHEMA_VERSION 11): collapsible details — three nodes landed together
    // (details > detailsSummary + detailsContent). Register all three; Details is the wrapper.
    Details.configure({ persist: true, HTMLAttributes: { class: 'octo-details' } }),
    DetailsSummary,
    DetailsContent,
    // SCHEMA-SPEC §12 (SCHEMA_VERSION 12): self-built callout block (variant info/warn/tip/success).
    Callout,
    // SCHEMA-SPEC §14 (SCHEMA_VERSION 13): math via KaTeX. The Mathematics meta-extension bundles
    // the inlineMath + blockMath nodes and the `$…$` / `$$…$$` input rules. throwOnError:false so a
    // malformed formula renders as red source text instead of throwing during collaboration.
    Mathematics.configure({ katexOptions: { throwOnError: false } }),
    // SCHEMA-SPEC §15 (SCHEMA_VERSION 14): self-built fileAttachment block atom. Reuses the image
    // presign flow (backend opened non-image mimes); docId is threaded for presign/read REST.
    FileAttachment.configure({ docId }),
    // SCHEMA-SPEC §15 (SCHEMA_VERSION 15): self-built bookmark (link-preview) block atom. docId is
    // threaded so the insert flow can POST /docs/{docId}/link-card for OG metadata.
    Bookmark.configure({ docId }),
    Placeholder.configure({
      placeholder: "Type '/' for commands…",
    }),
    SlashCommand,
    // Self-built find & replace (toolbar item ⑪): decoration-highlight of matches + replace
    // current/all. Decorations are view-only (never written to the Y.Doc); replacements go
    // through ordinary transactions so collaboration syncs them.
    FindReplace,
    // Word/character count (toolbar item ⑦): read live from editor.storage.characterCount for
    // the status bar. No schema impact — it only counts the current doc.
    CharacterCount,
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
      underline: false, // v3 bundles Underline; docs installs it standalone (mirror live editor).
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
    // Mirror the live editor's schema-touching marks/attrs so a historical version renders
    // faithfully (SCHEMA_VERSION 5–8, 16): font size + font family + alignment + underline +
    // super/sub-script. FontFamily is mirrored here too so a stored `fontFamily` attr renders in
    // the read-only preview/diff even while the live toolbar entry is flag-gated off.
    FontSize,
    FontFamily,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    // Mirror the live editor's v17 line-spacing attrs so a historical version renders faithfully.
    LineHeight,
    // Mirror the v18 indent attr so a historical version / preview renders the same margin.
    // Registered AFTER LineHeight, matching the live set's style order.
    ParagraphIndent.configure({ types: ['heading', 'paragraph'] }),
    Underline,
    Superscript,
    Subscript,
    CodeBlockLowlight.configure({ lowlight }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    OctoImage.configure({ docId, uploads: false }),
    // Mirror the schema-touching nodes (SCHEMA_VERSION 9–13). The suggestion machinery never
    // fires in a read-only preview; buildMention's source lists load lazily, so no network call
    // happens here. The math + callout + details nodes render faithfully from stored attrs.
    buildEmoji(),
    buildMention({}),
    Details.configure({ persist: true, HTMLAttributes: { class: 'octo-details' } }),
    DetailsSummary,
    DetailsContent,
    Callout,
    Mathematics.configure({ katexOptions: { throwOnError: false } }),
    // Mirror the v14/v15 nodes read-only: render the file card + bookmark card from stored attrs.
    // No upload affordance is shown (the live editor's toolbar/slash are absent here); the file
    // download still resolves a signed read URL (a read, not an edit). The bookmark insert flow
    // (OG fetch) never runs in a preview, so no network call happens here.
    FileAttachment.configure({ docId }),
    Bookmark.configure({ docId }),
  ]
}
