// Import flow: file picker → parse Markdown → create new doc → navigate → inject content.
//
// Design doc §5 (方案 A1 + B1): user picks a .md file, we parse it to PM JSON,
// create a new empty doc via REST, stash the PM JSON in sessionStorage keyed by docId,
// then navigate to the new doc. EditorShell picks up the stashed content on mount and
// injects it via setContent once the editor is ready.

import { parseMarkdownToPmDoc } from '../import/markdown.ts'
import { createDoc, importDocx } from '../pages/docsApi.ts'
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
export async function runMarkdownImport(
  spaceId?: string,
  folderId?: string,
): Promise<ImportResult> {
  // 1. File picker
  const { text, fileName } = await pickMdFile()

  // 2. Parse (emojiName resolves `:shortcode:` against the editor's bundled GitHub emoji set;
  // unknown shortcodes stay literal text rather than becoming blank emoji nodes).
  const parsed = parseMarkdownToPmDoc(text, { emojiName: emojiGlyph })

  // 3. Determine title
  const title = parsed.title || stripExtension(fileName) || 'Imported document'

  // 4. Create new doc
  const created = await createDoc({ title, spaceId, folderId })

  // 5. Stash content + warnings for EditorShell to pick up after navigation
  stashImportContent(created.docId, parsed.doc)
  stashImportWarnings(created.docId, parsed.warnings)

  return {
    docId: created.docId,
    title,
    warnings: parsed.warnings,
  }
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
): Promise<ImportResult> {
  // 1. File picker
  const { file, fileName } = await pickDocxFile()

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
function pickMdFile(): Promise<PickedFile> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt,.text'
    input.style.display = 'none'

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { reject(new Error('未选择文件')); cleanup(); return }
      const fileName = file.name
      const reader = new FileReader()
      reader.onload = () => resolve({ text: reader.result as string, fileName })
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsText(file, 'UTF-8')
      cleanup()
    }

    input.oncancel = () => { reject(new Error('用户取消')); cleanup() }

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
function pickDocxFile(): Promise<PickedDocxFile> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept =
      '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    input.style.display = 'none'

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { reject(new Error('未选择文件')); cleanup(); return }
      resolve({ file, fileName: file.name })
      cleanup()
    }

    input.oncancel = () => { reject(new Error('用户取消')); cleanup() }

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
