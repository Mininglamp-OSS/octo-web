// File-attachment upload + insert flow (frontend-design §3.5, SCHEMA-SPEC §15).
//
// Shared by the toolbar button and the slash command. The flow mirrors imageUpload.ts but
// for ARBITRARY (non-image) files: validate → presign → PUT bytes to object storage → insert
// a `fileAttachment` node carrying the durable attachId + the file metadata. Reuses the EXISTING
// presign endpoint (POST /docs/{docId}/attachments/presign) — the backend has opened non-image
// mimes — so there is one upload contract for images and files alike. Base64 never touches the
// Y.Doc; the node is inserted only AFTER the upload succeeds (no broken node on failure).

import type { Editor, Range } from '@tiptap/core'
import { presignUpload, uploadBinary, AttachmentRejectedError } from '../attachments/api.ts'
import type { FileAttachmentAttrs } from './FileAttachment.ts'
import { t } from '../octoweb/index.ts'

/** Client-side guard before bothering the backend; the backend stays the final authority. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024 // 50 MB

// Extension → real mime map. The browser leaves `file.type` EMPTY for many files (no
// extension, some .zip on certain OSes, some drag sources, unregistered types); the old code
// fell back to the catch-all `application/octet-stream`, which the backend whitelist correctly
// rejects (mime_not_allowed) — and which it must NOT whitelist, since octet-stream is the
// universal fallback and allowing it would defeat the "no executables/scripts" guard. So when
// `file.type` is empty or octet-stream we resolve the REAL mime from the filename extension
// before calling presign; an extension we cannot map is surfaced to the user as an explicit
// "unsupported file type" error rather than failing silently with octet-stream.
const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Catch-all the browser uses when it can't identify a file; must never be sent to presign. */
const CATCH_ALL_MIME = 'application/octet-stream'

/**
 * Resolve the real mime to send to presign. Trusts a concrete `file.type` when present; when it
 * is empty or the catch-all octet-stream, resolves from the filename extension. Returns null when
 * the type can't be determined (unknown/unsupported) so the caller can warn instead of sending
 * octet-stream (which the backend rejects). Pure → unit-testable.
 */
export function resolveUploadMime(fileName: string, fileType: string): string | null {
  const declared = (fileType || '').trim().toLowerCase()
  if (declared && declared !== CATCH_ALL_MIME) return declared
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return null
  const ext = fileName.slice(dot + 1).toLowerCase()
  return EXTENSION_MIME[ext] ?? null
}

/** Read docId off the registered fileAttachment extension (threaded via buildExtensions). */
export function getFileDocId(editor: Editor): string | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'fileAttachment')
  const docId = (ext?.options as { docId?: string } | undefined)?.docId
  return docId && docId.length > 0 ? docId : null
}

/**
 * Upload a single file via the presign flow and return the EXACT node attr set
 * { attachId, fileName, mime, sizeBytes }. The negotiated mime/size come back from the
 * presign response (backend is authoritative); we fall back to the File's own values.
 */
export async function uploadFile(docId: string, file: File, mime: string): Promise<FileAttachmentAttrs> {
  const fileName = file.name || 'file'
  const presign = await presignUpload(docId, {
    fileName,
    mime,
    sizeBytes: file.size,
  })
  await uploadBinary(presign, file)
  return {
    attachId: presign.attachId,
    fileName,
    mime: presign.mime || mime,
    sizeBytes: typeof presign.sizeBytes === 'number' ? presign.sizeBytes : file.size,
  }
}

/** Map a backend presign rejection reason to a user-visible message. */
function attachmentErrorMessage(reason: string): string {
  switch (reason) {
    case 'mime_not_allowed':
    case 'mime_blocked':
      return t('docs.file.mimeBlocked')
    case 'size_too_large':
      return t('docs.file.tooLarge')
    default:
      return t('docs.file.failed')
  }
}

/**
 * Run the full upload-and-insert flow for one file. A transient status indicator shows while
 * uploading and a dismissable error toast on failure. Nothing is inserted unless the upload
 * succeeds. `range` (slash command) is deleted before inserting.
 */
export async function uploadAndInsertFile(
  editor: Editor,
  file: File,
  opts: { range?: Range; docId?: string } = {},
): Promise<void> {
  const docId = opts.docId ?? getFileDocId(editor)
  if (!docId) {
    notifyFileError(t('docs.file.unavailable'))
    return
  }
  if (file.size <= 0) {
    notifyFileError(t('docs.file.failed'))
    return
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    notifyFileError(t('docs.file.tooLarge'))
    return
  }

  // Resolve the real mime (extension fallback when the browser reports empty/octet-stream).
  // An unknown/unsupported type is surfaced explicitly instead of sending octet-stream (which
  // the backend whitelist rejects — and must keep rejecting for security).
  const mime = resolveUploadMime(file.name || 'file', file.type)
  if (!mime) {
    notifyFileError(t('docs.file.unsupportedType'))
    return
  }

  const status = beginFileStatus(t('docs.file.uploading'))
  try {
    const attrs = await uploadFile(docId, file, mime)
    const chain = editor.chain().focus()
    if (opts.range) chain.deleteRange(opts.range)
    chain.setFileAttachment(attrs).run()
  } catch (e) {
    notifyFileError(
      e instanceof AttachmentRejectedError ? attachmentErrorMessage(e.reason) : t('docs.file.failed'),
    )
  } finally {
    status.done()
  }
}

/** Open a hidden file picker (any type) and resolve with the chosen file (or null). */
export function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}

/** Toolbar / slash entry point: pick a file then run the upload flow. When a `range` is given
 * (slash command) it is deleted first, mirroring the other items. */
export async function pickAndUploadFile(editor: Editor, range?: Range): Promise<void> {
  const file = await pickFile()
  if (!file) return
  await uploadAndInsertFile(editor, file, { range })
}

// --- transient, document-external status / error UI ---------------------------
// These widgets live in <body>, never in the Y.Doc, so they cannot desync collab content.

function beginFileStatus(text: string): { done: () => void } {
  if (typeof document === 'undefined') return { done: () => {} }
  const el = document.createElement('div')
  el.className = 'octo-file-status'
  el.textContent = text
  document.body.appendChild(el)
  return { done: () => el.remove() }
}

export function notifyFileError(message: string): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'octo-file-error'
  el.setAttribute('role', 'alert')
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}
