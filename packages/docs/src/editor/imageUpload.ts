// Image upload + insert flow (frontend-design §3.5, SCHEMA-SPEC §2 `image` node).
//
// Shared by the toolbar button, the slash command, and the paste/drop handlers in
// ImageNode. The flow is: validate -> presign -> PUT bytes to object storage ->
// resolve a signed display URL -> insert the image node with the durable attachId
// (and the read URL as a cached `src`).
//
// Base64 NEVER touches the Y.Doc (constraint §2): only the durable attachId and a
// controlled storage URL are stored. We also never insert a node until the upload
// has succeeded, so a failed upload leaves no broken node behind.

import type { Editor, Range } from '@tiptap/core'
import { uploadImage, AttachmentRejectedError } from '../attachments/api.ts'

/** Client-side guard before bothering the backend; the backend stays the final
 * authority and may still reject with a 400 (handled in uploadAndInsertImage). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

export function isUploadableImage(file: File): boolean {
  return file.type.startsWith('image/') && file.size > 0 && file.size <= MAX_IMAGE_BYTES
}

/** Collect image files out of a paste/drop payload. Prefers `files`; falls back to
 * DataTransferItems (some browsers expose pasted screenshots only via `items`). */
export function collectImageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  for (const f of Array.from(dt.files ?? [])) {
    if (f.type.startsWith('image/')) out.push(f)
  }
  if (out.length === 0 && dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  return out
}

/** Read docId off the registered image extension's options so the static slash item
 * and toolbar button can reach it without extra plumbing (it is threaded into the
 * extension via buildExtensions -> OctoImage.configure({ docId })). */
export function getImageDocId(editor: Editor): string | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'image')
  const docId = (ext?.options as { docId?: string } | undefined)?.docId
  return docId && docId.length > 0 ? docId : null
}

/** Map a backend presign rejection reason to a user-visible message (§3.5). */
function attachmentErrorMessage(reason: string): string {
  switch (reason) {
    case 'mime_not_allowed':
    case 'mime_blocked':
      return 'That image type is not allowed.'
    case 'size_too_large':
      return 'That image is too large.'
    default:
      return `Image upload was rejected: ${reason}`
  }
}

/**
 * Run the full upload-and-insert flow for a single file. Shows a transient status
 * indicator while uploading and a dismissable error toast on failure. Nothing is
 * inserted into the document unless the upload succeeds.
 *
 * `range` (slash command) is deleted before inserting; `at` (drop) inserts at an
 * explicit document position. With neither, the node lands at the current selection.
 */
export async function uploadAndInsertImage(
  editor: Editor,
  file: File,
  opts: { range?: Range; at?: number; docId?: string } = {},
): Promise<void> {
  const docId = opts.docId ?? getImageDocId(editor)
  if (!docId) {
    notifyImageError('Cannot upload image: document is unavailable.')
    return
  }
  if (!isUploadableImage(file)) {
    notifyImageError(
      file.type.startsWith('image/')
        ? 'That image is too large (max 10 MB).'
        : 'Only image files can be uploaded.',
    )
    return
  }

  const status = beginImageStatus('Uploading image…')
  try {
    // uploadImage resolves a signed display URL for immediate paint; the durable
    // reference is the attachId (the NodeView re-resolves the URL from it lazily).
    const { attachId, src } = await uploadImage(docId, file)

    const attrs = { attachId, src, alt: file.name || null }
    if (typeof opts.at === 'number') {
      // The drop position was captured synchronously at drop time, but we only
      // insert after the async upload — the doc may have grown/shrunk (local or
      // remote edits) meanwhile, so an absolute position can now be out of range.
      // Clamp to the current document bounds to avoid a RangeError / mis-placed
      // node; if it no longer maps cleanly we fall back to the current selection.
      const docSize = editor.state.doc.content.size
      const at = Math.max(0, Math.min(opts.at, docSize))
      editor.chain().focus().insertContentAt(at, { type: 'image', attrs }).run()
    } else {
      const chain = editor.chain().focus()
      if (opts.range) chain.deleteRange(opts.range)
      chain.insertContent({ type: 'image', attrs }).run()
    }
  } catch (e) {
    notifyImageError(
      e instanceof AttachmentRejectedError
        ? attachmentErrorMessage(e.reason)
        : 'Image upload failed. Please try again.',
    )
  } finally {
    status.done()
  }
}

/** Open a hidden file picker and resolve with the chosen image file (or null). */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
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
    // Some browsers fire `cancel` when the dialog is dismissed without a choice.
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}

/** Toolbar / slash entry point: pick an image file then run the upload flow. When a
 * `range` is given (slash command) it is deleted first, mirroring the other items. */
export async function pickAndUploadImage(editor: Editor, range?: Range): Promise<void> {
  const file = await pickImageFile()
  if (!file) return
  await uploadAndInsertImage(editor, file, { range })
}

// --- transient, document-external status / error UI ---------------------------
// These widgets live in <body>, never in the Y.Doc, so they cannot desync collab
// content (same rationale as the drag handle living outside the document).

function beginImageStatus(text: string): { done: () => void } {
  if (typeof document === 'undefined') return { done: () => {} }
  const el = document.createElement('div')
  el.className = 'octo-image-status'
  el.textContent = text
  document.body.appendChild(el)
  return { done: () => el.remove() }
}

export function notifyImageError(message: string): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'octo-image-error'
  el.setAttribute('role', 'alert')
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}
