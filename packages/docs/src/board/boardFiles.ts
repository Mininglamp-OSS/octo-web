// Shared image-binary rehydration for the whiteboard (XIN-730).
//
// A whiteboard's `files` container stores REFS ONLY — `{ attachId, mimeType, status, createdAt }` —
// never the binary (base64 never enters the Y.Doc; see whiteboard-schema/fileRef.ts). Excalidraw only
// draws an image when `files[id].dataURL` is present, so anything that renders a scene from stored
// refs (the live board's remote-apply fetcher AND the read-only version preview) must turn each ref
// back into a `BinaryFileData` first: resolve a fresh signed GET url in one batch round trip, download
// the binary, and read it into a data URL.
//
// This is the single implementation of that path. BoardShell wires it into the collab binding's file
// fetcher; BoardScenePreview calls it to hydrate a historical version before mounting the preview
// canvas. Keeping it here means the two render paths can never drift onto different fetch/decoding
// logic, and neither invents a new endpoint — both go through `POST /attachments/resolve`.

import { resolveAttachments } from '../attachments/api.ts'
import { blobToDataURL, type BinaryFileData, type FileFetchRef } from './collab/index.ts'

/**
 * Resolve a set of file refs (by `attachId`) into `BinaryFileData` entries ready to seed into
 * Excalidraw (`initialData.files`) or `addFiles()`. Batches the signed-URL resolve into one request,
 * then downloads each binary in parallel. A ref the backend can't resolve, or a download that fails,
 * is simply omitted from the result — the caller renders it as a placeholder rather than throwing.
 */
export async function fetchBoardFileBinaries(
  docId: string,
  refs: readonly FileFetchRef[],
): Promise<BinaryFileData[]> {
  if (refs.length === 0) return []
  const refByAttach = new Map(refs.map((r) => [r.attachId, r]))
  const { items } = await resolveAttachments(
    docId,
    refs.map((r) => r.attachId),
  )
  const out: BinaryFileData[] = []
  await Promise.all(
    items.map(async (item) => {
      const ref = refByAttach.get(item.attachId)
      if (!ref) return
      try {
        const res = await fetch(item.url)
        if (!res.ok) return
        const dataURL = await blobToDataURL(await res.blob())
        out.push({ id: ref.id, dataURL, mimeType: item.mime ?? ref.mimeType, created: Date.now() })
      } catch {
        // Leave this one a placeholder; the live board's next applyRemote (or a reopened preview)
        // re-collects and retries it.
      }
    }),
  )
  return out
}
