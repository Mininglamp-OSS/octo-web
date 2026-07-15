// Import flow: file picker → parse Markdown → create new doc → navigate → inject content.
//
// Design doc §5 (方案 A1 + B1): user picks a .md file, we parse it to PM JSON,
// create a new empty doc via REST, stash the PM JSON in sessionStorage keyed by docId,
// then navigate to the new doc. EditorShell picks up the stashed content on mount and
// injects it via setContent once the editor is ready.

import { parseMarkdownToPmDoc } from '../import/markdown.ts'
import { createDoc, importDocx } from '../pages/docsApi.ts'
import { copyAttachments, ingestAttachments, type CopySourceRef } from '../attachments/api.ts'
import { emojiGlyph } from './emoji.ts'

const IMPORT_KEY_PREFIX = 'octo-import-pm-'
const IMPORT_WARN_PREFIX = 'octo-import-warn-'

/** Stash parsed PM JSON for a newly-created doc so EditorShell can pick it up on mount. */
export function stashImportContent(docId: string, pmDoc: unknown): void {
  try {
    sessionStorage.setItem(IMPORT_KEY_PREFIX + docId, JSON.stringify(pmDoc))
  } catch {
    // sessionStorage full or unavailable — non-fatal; user just won't get auto-inject
  }
}

/** Stash import warnings so the destination EditorShell can surface them after navigation. */
export function stashImportWarnings(docId: string, warnings: string[]): void {
  if (!warnings.length) return
  try {
    sessionStorage.setItem(IMPORT_WARN_PREFIX + docId, JSON.stringify(warnings))
  } catch {
    // non-fatal — warnings just won't surface after navigation
  }
}

/** Retrieve and clear stashed import warnings for a doc. Returns [] when none/invalid. */
export function consumeImportWarnings(docId: string): string[] {
  const key = IMPORT_WARN_PREFIX + docId
  let raw: string | null
  try {
    raw = sessionStorage.getItem(key)
    if (raw) sessionStorage.removeItem(key)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((w): w is string => typeof w === 'string')
  } catch {
    // ignore
  }
  return []
}

/**
 * Retrieve and clear stashed import content for a doc.
 * Returns the validated PM doc, or null if none. Throws `ImportContentCorruptError`
 * when a stash entry exists but fails schema validation (sessionStorage is user-controlled
 * via DevTools, so a hostile/garbled payload must not reach editor.setContent unchecked).
 */
export function consumeImportContent(docId: string): PmDoc | null {
  const key = IMPORT_KEY_PREFIX + docId
  let raw: string | null
  try {
    raw = sessionStorage.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  // Always clear the stash, even on a bad payload, so a corrupt entry can't wedge the doc.
  try {
    sessionStorage.removeItem(key)
  } catch {
    // ignore — non-fatal
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ImportContentCorruptError('stashed import content is not valid JSON')
  }
  if (!isValidPmDoc(parsed)) {
    throw new ImportContentCorruptError('stashed import content is not a valid document')
  }
  return parsed
}

/** Raised when stashed import content exists but is malformed; caller shows a user-facing notice. */
export class ImportContentCorruptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportContentCorruptError'
  }
}

interface PmDoc {
  type: 'doc'
  content: unknown[]
}

/**
 * Structural validation for a stashed ProseMirror document. This is a shallow shape gate
 * (root is a `doc` with a `content` array of plain node objects that each carry a string
 * `type`); the editor's schema still rejects unknown node types on setContent. The goal here
 * is only to keep obviously-hostile / corrupt sessionStorage payloads out of setContent.
 */
function isValidPmDoc(value: unknown): value is PmDoc {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  if (doc.type !== 'doc') return false
  if (!Array.isArray(doc.content)) return false
  return doc.content.every(isPlainNode)
}

function isPlainNode(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const n = node as Record<string, unknown>
  if (typeof n.type !== 'string' || !n.type) return false
  if ('content' in n && n.content !== undefined) {
    if (!Array.isArray(n.content)) return false
    if (!n.content.every(isPlainNode)) return false
  }
  return true
}

export interface ImportResult {
  docId: string
  title: string
  warnings: string[]
}

/**
 * Run the full import flow: pick file → parse → create doc → stash content.
 * Caller navigates to result.docId after this resolves.
 */
/** Translator type threaded from the calling React component (has useTranslation). */
type Translate = (key: string, params?: Record<string, string | number>) => string

/** Resolve an i18n key via the optional translator, falling back to the key. */
function tr(t: Translate | undefined, key: string, params?: Record<string, string | number>): string {
  return t ? t(key, params) : key
}

export async function runMarkdownImport(
  spaceId?: string,
  folderId?: string,
  t?: Translate,
): Promise<ImportResult> {
  // 1. File picker
  const { text, fileName } = await pickMdFile(t)

  // 1b. Extension guard. `input.accept` is only a UI hint (the OS dialog still lets the user pick
  // "all files"), so reject anything that is not a Markdown file here — this import path is for
  // Markdown only, not arbitrary .txt/plain text.
  if (!/\.(md|markdown)$/i.test(fileName)) {
    throw new Error(tr(t, 'docs.import.mdOnly'))
  }

  // 2. Parse (emojiName resolves `:shortcode:` against the editor's bundled GitHub emoji set;
  // unknown shortcodes stay literal text rather than becoming blank emoji nodes).
  const parsed = parseMarkdownToPmDoc(text, { emojiName: emojiGlyph, t })

  // 3. Determine title. Use the file name (matching the .docx import), so the sidebar label is
  // always the imported file's name rather than the document's first heading.
  const title = stripExtension(fileName) || 'Imported document'

  // 4. Create new doc
  const created = await createDoc({ title, spaceId, folderId })

  // 4b. Migrate imported images into the NEW doc. The parsed image nodes still point at the
  // SOURCE doc's attachId + a short-lived signed URL. The editor resolves an image's URL with
  // the CURRENT doc's id (getReadUrl(thisDoc, attachId)), so a foreign attachId never resolves
  // and the image renders blank once the signed src expires. Re-upload each image under the new
  // doc so it gets a doc-scoped attachId the editor can re-sign. Best-effort: an image that
  // can't be fetched/re-uploaded degrades to a warning instead of blocking the whole import.
  const migrateWarnings = await migrateImportedImages(created.docId, parsed.doc, t)

  // 5. Stash content + warnings for EditorShell to pick up after navigation
  stashImportContent(created.docId, parsed.doc)
  stashImportWarnings(created.docId, [...parsed.warnings, ...migrateWarnings])

  return {
    docId: created.docId,
    title,
    warnings: [...parsed.warnings, ...migrateWarnings],
  }
}

/**
 * Re-host every image that our own service already stores under `newDocId`, using a server-side
 * store-to-store copy. The parsed image nodes still point at the SOURCE doc's attachId + a
 * short-lived signed URL; the editor resolves an image's URL with the CURRENT doc's id
 * (getReadUrl(thisDoc, attachId)), so a foreign attachId never resolves and the image renders
 * blank once the signed src expires. We ask the backend to copy the bytes store-to-store (it
 * never depends on the expiring signed URL) and rewrite each node's attachId/src to the new
 * doc-scoped values.
 *
 * Re-host every image an imported document references so it survives under the new doc:
 *   - OUR-SERVICE images (src path `/file/<docId>/att_<id>/`) are copied store-to-store by the
 *     backend (`copyAttachments`) — never depends on the expiring signed URL.
 *   - EXTERNAL images (any other http(s) URL) are downloaded + stored server-side
 *     (`ingestAttachments`, SSRF-guarded) so the doc does not break if the host later 404s; if
 *     ingest fails the node KEEPS its original URL (best-effort) so it still shows while reachable.
 * Both rewrite each node's attachId/src to the new doc-scoped values. Non-http(s) srcs (already
 * degraded to text markers upstream) are ignored. Returns non-fatal warnings. Exported for tests.
 */
export async function migrateImportedImages(
  newDocId: string,
  doc: unknown,
  t?: Translate,
): Promise<string[]> {
  const images: Array<Record<string, unknown>> = []
  collectImageNodes(doc, images)
  if (images.length === 0) return []

  // Split image nodes into our-service (by source ref) vs external (by URL), de-duped. We keep
  // the NODE objects (not just attrs) so a failed external image can be transformed into a link.
  const byRef = new Map<string, { ref: CopySourceRef; nodes: Array<Record<string, unknown>> }>()
  const byUrl = new Map<string, Array<Record<string, unknown>>>()
  for (const node of images) {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    const src = typeof attrs.src === 'string' ? attrs.src : ''
    if (!/^https?:\/\//i.test(src)) continue // local/data/relative: already degraded upstream
    const ref = parseServiceImageRef(src)
    if (ref) {
      const key = `${ref.docId}\u0000${ref.attachId}`
      const entry = byRef.get(key)
      if (entry) entry.nodes.push(node)
      else byRef.set(key, { ref, nodes: [node] })
    } else {
      const list = byUrl.get(src)
      if (list) list.push(node)
      else byUrl.set(src, [node])
    }
  }

  const warnings: string[] = []

  // 1) Our-service images → server-to-server copy.
  if (byRef.size > 0) {
    const copiedRefs = new Set<string>()
    try {
      const result = await copyAttachments(newDocId, [...byRef.values()].map((e) => e.ref))
      for (const m of result.mappings) {
        const key = `${m.sourceDocId}\u0000${m.sourceAttachId}`
        const entry = byRef.get(key)
        if (!entry) continue
        copiedRefs.add(key)
        for (const node of entry.nodes) {
          const attrs = (node.attrs ?? {}) as Record<string, unknown>
          attrs.attachId = m.attachId
          if (m.url) attrs.src = m.url
          node.attrs = attrs
        }
      }
      for (const nc of result.notCopied)
        warnings.push(tr(t, 'docs.import.imageMigrateFailed', { reason: nc.reason }))
    } catch {
      warnings.push(tr(t, 'docs.import.imagesMigratePartial'))
    }
    // Any our-service image that was NOT copied under the new doc keeps a FOREIGN attachId,
    // which ImageNodeView.resolveFromAttach would forever try to resolve under the new doc
    // (a doomed getReadUrl re-issued on every render) once the short-lived signed src expires.
    // Strip the useless foreign attachId so the NodeView degrades to a plain src render instead
    // of a permanently broken image box.
    for (const [key, entry] of byRef) {
      if (copiedRefs.has(key)) continue
      for (const node of entry.nodes) {
        const attrs = (node.attrs ?? {}) as Record<string, unknown>
        if ('attachId' in attrs) delete attrs.attachId
        node.attrs = attrs
      }
    }
  }

  // 2) External images → server-side download + store. On success rewrite to the stored
  //    attachment; on failure REPLACE the broken image node with a clickable link to the
  //    original URL (no red "Image unavailable" box), plus one top-level warning.
  if (byUrl.size > 0) {
    const succeeded = new Set<string>()
    try {
      const result = await ingestAttachments(newDocId, [...byUrl.keys()])
      for (const m of result.mappings) {
        succeeded.add(m.sourceUrl)
        const nodes = byUrl.get(m.sourceUrl)
        if (!nodes) continue
        for (const node of nodes) {
          const attrs = (node.attrs ?? {}) as Record<string, unknown>
          attrs.attachId = m.attachId
          if (m.url) attrs.src = m.url
          node.attrs = attrs
        }
      }
    } catch {
      // Request-level failure: nothing succeeded; every external image falls through to link.
    }
    // Any external image not successfully ingested → turn into a clickable link so it never
    // renders a broken-image box. The document keeps a live reference to the original URL.
    let anyFailed = false
    for (const [url, nodes] of byUrl) {
      if (succeeded.has(url)) continue
      anyFailed = true
      for (const node of nodes) imageNodeToLink(node, url)
    }
    if (anyFailed) warnings.push(tr(t, 'docs.import.externalImagesLinked'))
  }

  return warnings
}

/**
 * Transform a (block) image node in place into a paragraph containing a clickable link to the
 * original URL. Used when an external image can't be downloaded: instead of a broken-image box
 * the reader gets a live link. The link text is the image alt, else the URL.
 */
function imageNodeToLink(node: Record<string, unknown>, url: string): void {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const alt = typeof attrs.alt === 'string' && attrs.alt.trim() !== '' ? attrs.alt : url
  node.type = 'paragraph'
  node.attrs = {}
  node.content = [
    {
      type: 'text',
      text: alt,
      marks: [{ type: 'link', attrs: { href: url } }],
    },
  ]
}

/**
 * Parse a service storage URL into its source ref. Our exporter emits image src as a signed URL
 * whose path is `/file/<docId>/att_<id>/<name>?<signature>`. Returns { docId, attachId } when the
 * path matches that shape, else null (external image → not migrated). Requires BOTH the doc id
 * segment and the `att_` id so a random URL that merely contains `att_` is not misread.
 */
function parseServiceImageRef(src: string): CopySourceRef | null {
  if (!/^https?:\/\//i.test(src)) return null
  let pathname: string
  try {
    pathname = new URL(src).pathname
  } catch {
    return null
  }
  const m = /\/file\/([^/]+)\/(att_[A-Za-z0-9]+)(?:\/|$)/.exec(pathname)
  if (!m) return null
  // decodeURIComponent throws URIError on a malformed %-sequence. The imported
  // doc is arbitrary user input, so a service-shaped URL with a bad escape in
  // the doc-id segment must degrade to "skip this image" (like the new URL guard
  // above), not abort the whole migration and orphan the freshly-created doc.
  let docId: string
  try {
    docId = decodeURIComponent(m[1]!)
  } catch {
    return null
  }
  return { docId, attachId: m[2]! }
}

/** Depth-first collect every image node's attrs object (mutated in place by the migrator). */
/** Depth-first collect every image NODE object (mutated in place by the migrator). */
function collectImageNodes(node: unknown, out: Array<Record<string, unknown>>): void {
  if (typeof node !== 'object' || node === null) return
  const n = node as Record<string, unknown>
  if (n.type === 'image') out.push(n)
  if (Array.isArray(n.content)) for (const c of n.content) collectImageNodes(c, out)
}

/**
 * Run the full .docx import flow: pick file → create an empty doc → POST the file
 * to the server-side importer → stash the returned ProseMirror JSON. Unlike the
 * Markdown flow (which parses client-side), docx parsing + image upload happen
 * on the server, so we must create the doc FIRST to get a docId that scopes the
 * uploaded image attachments. Caller navigates to result.docId after this
 * resolves; EditorShell drains the stash on mount.
 */
export async function runDocxImport(
  spaceId?: string,
  folderId?: string,
  t?: Translate,
): Promise<ImportResult> {
  // 1. File picker
  const { file, fileName } = await pickDocxFile(t)

  // 2. Create the destination doc first (its id scopes server-side image uploads).
  const title = stripDocxExtension(fileName) || 'Imported document'
  const created = await createDoc({ title, spaceId, folderId })

  // 3. Server parses the .docx to ProseMirror JSON and uploads embedded images.
  const { doc, warnings } = await importDocx(created.docId, file)

  // 4. Stash content + warnings for EditorShell to pick up after navigation.
  stashImportContent(created.docId, doc)
  stashImportWarnings(created.docId, warnings)

  return {
    docId: created.docId,
    title,
    warnings,
  }
}

// ── File picker ───────────────────────────────────────────────────────────────

interface PickedFile {
  text: string
  fileName: string
}

/**
 * Open a native file picker and read the chosen file as UTF-8 text. Resolves with both the
 * text and its file name so the caller never depends on module-level mutable state (which
 * would race when the user triggers two imports in quick succession — the second pick would
 * clobber the first's file name and both docs would take the same title).
 */
function pickMdFile(t?: Translate): Promise<PickedFile> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown'
    input.style.display = 'none'

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { reject(new Error(tr(t, 'docs.import.noFileChosen'))); cleanup(); return }
      const fileName = file.name
      const reader = new FileReader()
      reader.onload = () => resolve({ text: reader.result as string, fileName })
      reader.onerror = () => reject(new Error(tr(t, 'docs.import.fileReadFailed')))
      reader.readAsText(file, 'UTF-8')
      cleanup()
    }

    input.oncancel = () => { reject(new Error(tr(t, 'docs.import.cancelled'))); cleanup() }

    const cleanup = () => {
      setTimeout(() => input.remove(), 100)
    }

    document.body.appendChild(input)
    input.click()
  })
}

function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown|txt|text)$/i, '')
}

interface PickedDocxFile {
  file: File
  fileName: string
}

/**
 * Open a native file picker for a single .docx file and hand back the raw File (the bytes are
 * uploaded to the server importer, so we never read them client-side). Resolves with the file
 * and its name so the caller derives the doc title without relying on module-level state.
 */
function pickDocxFile(t?: Translate): Promise<PickedDocxFile> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept =
      '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    input.style.display = 'none'

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { reject(new Error(tr(t, 'docs.import.noFileChosen'))); cleanup(); return }
      resolve({ file, fileName: file.name })
      cleanup()
    }

    input.oncancel = () => { reject(new Error(tr(t, 'docs.import.cancelled'))); cleanup() }

    const cleanup = () => {
      setTimeout(() => input.remove(), 100)
    }

    document.body.appendChild(input)
    input.click()
  })
}

function stripDocxExtension(name: string): string {
  return name.replace(/\.docx$/i, '')
}

