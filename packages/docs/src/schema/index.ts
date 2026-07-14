// Local stand-in for the shared `@octo/docs-schema` package (frontend-design §9).
// In real octo-web this is published as `@octo/docs-schema` and imported by the
// frontend, the backend Agent layer, and CLI tooling so the ProseMirror schema,
// the collab field name, and the documentName helper have a single source of truth.
//
// SCHEMA_VERSION is governed by docs/schema/SCHEMA-SPEC.md in the backend repo
// (single source of truth). Any node/mark change must bump this in lockstep with
// the backend stub and the spec. Versions are cumulative: each version's node/mark
// sets include all earlier additions.
//
//   v1 — baseline (heading H1–H6, paragraph, lists, task list, blockquote,
//        codeBlock, horizontalRule; marks bold/italic/strike/code/link).
//   v2 — SCHEMA-SPEC §2: add `image` node (attrs attachId/src/alt/title/width/align,
//        camelCase to byte-align with the frontend Tiptap image extension;
//        rendered with data-attach-id ↔ attachId; src is never base64 in the
//        Y.Doc). Owned by the backend P1b work + a frontend image NodeView
//        (separate PR).
//   v3 — SCHEMA-SPEC §3: add `highlight` and `textStyle` marks (text colour
//        rides on textStyle via @tiptap/extension-color). No new node; the v2
//        `image` node is carried forward (cumulative).
//   v4 — SCHEMA-SPEC §4: add table nodes `table`, `tableRow`, `tableCell`,
//        `tableHeader` (aligned to @tiptap/extension-table 2.27.2; cells carry
//        colspan/rowspan/colwidth). v2 image + v3 marks carried forward.
//   v5 — SCHEMA-SPEC §1: add a `textAlign` ATTRIBUTE to the `heading` and `paragraph`
//        nodes (not a new node/mark) via @tiptap/extension-text-align, configured for
//        exactly those two types → style="text-align:left|center|right|justify".
//   v6 — SCHEMA-SPEC §3: add the `underline` mark (@tiptap/extension-underline). StarterKit's
//        bundled Underline is disabled and the standalone mark installed (same pattern as link).
//   v7 — SCHEMA-SPEC §6: add a `fontSize` ATTRIBUTE to the `textStyle` mark (FontSize ships in
//        @tiptap/extension-text-style; no standalone font-size at 3.22.2) → <span style="font-size:…">.
//   v8 — SCHEMA-SPEC §13: add the `superscript` and `subscript` marks
//        (@tiptap/extension-superscript + @tiptap/extension-subscript), landed together.
//   v9 — SCHEMA-SPEC §8: add the `emoji` inline atom node (@tiptap/extension-emoji, bundled
//        GitHub emoji set; inserted via `:shortcode:` suggestion or the toolbar picker).
//   v10 — SCHEMA-SPEC §10: add the `mention` inline node (@tiptap/extension-mention) with attrs
//        id/label/type ('user'|'doc'); two sources (@people + @docs) merge into one '@' menu.
//   v11 — SCHEMA-SPEC §11: add the collapsible `details` block — three nodes landed together
//        (`details` > `detailsSummary` + `detailsContent`) via @tiptap/extension-details.
//   v12 — SCHEMA-SPEC §12: add the self-built `callout` block node (attr `variant`
//        info/warn/tip/success; round-trips via data-variant).
//   v13 — SCHEMA-SPEC §14: add the math nodes `inlineMath` + `blockMath` (@tiptap/extension-
//        mathematics + KaTeX); `$…$` inline and `$$…$$` block input rules.
//   v14 — SCHEMA-SPEC §15: add the self-built `fileAttachment` block atom node (attrs EXACTLY
//        attachId/fileName/mime/sizeBytes; round-trips via data-attach-id/data-file-name/
//        data-mime/data-size-bytes). Uploads reuse the existing image presign flow (the backend
//        opened non-image mimes); download uses the same signed read URL as images (never base64).
//   v15 — SCHEMA-SPEC §15: add the self-built `bookmark` (link-preview) block atom node (attrs
//        EXACTLY url/title/description/image/siteName/fetchedAt; round-trips via data-url/
//        data-title/data-description/data-image/data-site-name/data-fetched-at). Inserting a URL
//        calls POST /docs/{docId}/link-card for OG metadata; only http/https URLs become cards.
//   v16 — reserved by the in-flight #59 PR (not yet on main). SCHEMA_VERSION is monotonic and cut
//        numbers are never reused, so v16 is left as a gap here until #59 lands; this stub holds
//        merge until then (mirrors docs-backend #67).
//   v17 — SCHEMA-SPEC §17: add `lineHeight` / `spaceBefore` / `spaceAfter` ATTRIBUTES to the
//        `heading` and `paragraph` nodes (not new nodes/marks — same class as v5 textAlign /
//        v7 fontSize; version bump only). Defaults null. They ride the SAME inline `style` string
//        as textAlign; the block toDOM merges text-align + line-height + margin-top + margin-bottom
//        into ONE style attr in that fixed order (see editor/LineHeight.ts — the canonical
//        serialization byte-aligned to docs-backend #67's setBlockAttrs). Whitelist-sanitized at
//        both parse and render.
export const SCHEMA_VERSION = 17

// Node names present in the schema at the current SCHEMA_VERSION. Mirrors the
// backend stub's node set (SCHEMA-SPEC); kept here so the set is auditable against
// the spec without importing the editor extensions. `image` (v2) is carried
// forward cumulatively even though its frontend NodeView lands in a separate PR.
export const SCHEMA_NODES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'image', // v2 — attrs attachId/src/alt/title/width/align (camelCase); data-attach-id; never base64
  'table', // v4 — group block, content tableRow+
  'tableRow', // v4 — content (tableCell | tableHeader)+
  'tableCell', // v4 — attrs colspan/rowspan/colwidth; content block+
  'tableHeader', // v4 — attrs colspan/rowspan/colwidth; content block+
  'emoji', // v9 — inline atom; attrs name (shortcode); bundled GitHub emoji set
  'mention', // v10 — inline; attrs id/label/type ('user'|'doc'); data-mention-type round-trip
  'details', // v11 — collapsible wrapper; content detailsSummary detailsContent
  'detailsSummary', // v11 — the always-visible summary line of a details block
  'detailsContent', // v11 — the collapsible body of a details block
  'callout', // v12 — block+ container; attr variant info/warn/tip/success; data-variant
  'inlineMath', // v13 — inline KaTeX formula; attr latex; `$…$`
  'blockMath', // v13 — block KaTeX formula; attr latex; `$$…$$`
  'fileAttachment', // v14 — block atom; attrs attachId/fileName/mime/sizeBytes; data-* round-trip; presign upload
  'bookmark', // v15 — block atom; attrs url/title/description/image/siteName/fetchedAt; data-* round-trip; OG link-card
] as const

// Mark names present in the schema at the current SCHEMA_VERSION. Mirrors the
// backend stub's mark set (SCHEMA-SPEC §3); kept here so the set is auditable
// against the spec without importing the editor extensions.
//
// NOTE: v5 `textAlign`, v7 `fontSize`, and the v17 `lineHeight`/`spaceBefore`/`spaceAfter` are
// ATTRIBUTES (textAlign + block-spacing on heading/paragraph, fontSize on the textStyle mark),
// not new nodes/marks, so they add no entry here — only a version bump. They still round-trip
// through the Y.Doc as node/mark attrs.
export const SCHEMA_MARKS = [
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'highlight', // v3 — <mark style="background-color:…">
  'textStyle', // v3 — <span style="color:…"> (carries the color attr; v7 adds the fontSize attr)
  'underline', // v6 — <u> / text-decoration:underline
  'superscript', // v8 — <sup>
  'subscript', // v8 — <sub>
] as const

// Tiptap extension-collaboration default field name. This is the XmlFragment name
// inside the Y.Doc and MUST match the backend (frontend-design §4 / §7.7, backend §7.1).
export const COLLAB_FIELD = 'default'

export { buildDocumentName, parseDocumentName } from '../documentName/index.ts'
export type { ParsedDocumentName } from '../documentName/index.ts'

// Version-history wire contract. Like the schema above, this is destined for the
// published `@octo/docs-schema` package as the cross-repo single source of truth
// for the version-history endpoint field names; the backend mirrors it. Re-exported
// here so the canonical contract is discoverable from the schema module. The
// authoritative definition lives in ../versions/contract.ts (design doc v0.4 §7).
export {
  VERSION_WIRE_FIELDS,
} from '../versions/contract.ts'
export type {
  VersionWireFieldName,
  WireVersionRow,
  WireListVersionsResponse,
  WireCreateVersionRequest,
  WireCreateVersionResponse,
  WireRestoreResponse,
  WireRenameVersionRequest,
} from '../versions/contract.ts'
