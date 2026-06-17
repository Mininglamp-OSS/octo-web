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
export const SCHEMA_VERSION = 4

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
] as const

// Mark names present in the schema at the current SCHEMA_VERSION. Mirrors the
// backend stub's mark set (SCHEMA-SPEC §3); kept here so the set is auditable
// against the spec without importing the editor extensions.
export const SCHEMA_MARKS = [
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'highlight', // v3 — <mark style="background-color:…">
  'textStyle', // v3 — <span style="color:…"> (carries the color attr)
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
