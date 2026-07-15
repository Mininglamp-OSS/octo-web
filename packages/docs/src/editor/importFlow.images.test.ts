import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the attachments API so migrateImportedImages re-hosts via the server-copy stub.
const copyAttachments = vi.fn()
const ingestAttachments = vi.fn()
vi.mock('../attachments/api.ts', () => ({
  copyAttachments: (...a: unknown[]) => copyAttachments(...a),
  ingestAttachments: (...a: unknown[]) => ingestAttachments(...a),
}))

import { migrateImportedImages } from './importFlow.ts'

// A signed export URL for a foreign doc: path carries the source doc + att_ id, query is a
// short-lived signature. The editor would resolve this under the NEW doc's id and fail, so the
// migrator must ask the backend to copy it under the new doc.
const FOREIGN =
  'http://localhost:28080/file/d_pdf_test_full/att_13a2f15faef2f55111bbfc69/222.png' +
  '?X-Amz-Expires=600&X-Amz-Signature=***'

// In real import output a block image is a top-level block (not wrapped in a paragraph). The
// migrator mutates the image NODE in place — rewriting attachId/src on success, or replacing it
// with a paragraph+link on external-ingest failure.
function imageDoc(...srcs: string[]) {
  return {
    type: 'doc',
    content: srcs.map((src) => ({ type: 'image', attrs: { src, attachId: 'att_13a2f15faef2f55111bbfc69' } })),
  }
}
function firstImageNode(doc: { content: Array<Record<string, unknown>> }): Record<string, any> {
  return doc.content[0]
}

/** Echo translator: returns the key plus its params so tests can assert both. */
const echoT = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key} ${JSON.stringify(params)}` : key

describe('migrateImportedImages', () => {
  beforeEach(() => {
    copyAttachments.mockReset()
    ingestAttachments.mockReset()
    ingestAttachments.mockResolvedValue({ mappings: [], notIngested: [] })
  })

  it('server-copies a foreign service image and rewrites its attachId + src to the new doc values', async () => {
    copyAttachments.mockResolvedValue({
      mappings: [
        {
          sourceDocId: 'd_pdf_test_full',
          sourceAttachId: 'att_13a2f15faef2f55111bbfc69',
          attachId: 'att_new123',
          url: 'https://cdn/new.png?sig=fresh',
          mime: 'image/png',
          sizeBytes: 3,
          fileName: '222.png',
        },
      ],
      notCopied: [],
    })

    const doc = imageDoc(FOREIGN)
    const warnings = await migrateImportedImages('d_new', doc)

    expect(warnings).toEqual([])
    // Sent exactly one source ref parsed from the URL path.
    expect(copyAttachments).toHaveBeenCalledTimes(1)
    const [docId, sources] = copyAttachments.mock.calls[0] as [string, Array<{ docId: string; attachId: string }>]
    expect(docId).toBe('d_new')
    expect(sources).toEqual([{ docId: 'd_pdf_test_full', attachId: 'att_13a2f15faef2f55111bbfc69' }])
    const img = firstImageNode(doc)
    expect(img.attrs.attachId).toBe('att_new123')
    expect(img.attrs.src).toBe('https://cdn/new.png?sig=fresh')
  })

  it('de-dupes a repeated image into a single source ref and rewrites both nodes', async () => {
    copyAttachments.mockResolvedValue({
      mappings: [
        {
          sourceDocId: 'd_pdf_test_full',
          sourceAttachId: 'att_13a2f15faef2f55111bbfc69',
          attachId: 'att_shared',
          url: 'https://cdn/shared.png',
          mime: 'image/png',
          sizeBytes: 1,
          fileName: '222.png',
        },
      ],
      notCopied: [],
    })

    const doc = imageDoc(FOREIGN, FOREIGN)
    await migrateImportedImages('d_new', doc)

    const [, sources] = copyAttachments.mock.calls[0] as [string, unknown[]]
    expect(sources).toHaveLength(1)
    expect(doc.content[0].attrs.attachId).toBe('att_shared')
    expect(doc.content[1].attrs.attachId).toBe('att_shared')
  })

  it('server-ingests an external image and rewrites it to the new doc-scoped attachId', async () => {
    ingestAttachments.mockResolvedValue({
      mappings: [{ sourceUrl: 'https://example.com/pic.png', attachId: 'att_ext', url: 'https://cdn/ext.png', mime: 'image/png', sizeBytes: 9 }],
      notIngested: [],
    })
    const doc = imageDoc('https://example.com/pic.png')
    const warnings = await migrateImportedImages('d_new', doc)

    expect(copyAttachments).not.toHaveBeenCalled()
    expect(ingestAttachments).toHaveBeenCalledWith('d_new', ['https://example.com/pic.png'])
    expect(warnings).toEqual([])
    expect(firstImageNode(doc).attrs.attachId).toBe('att_ext')
    expect(firstImageNode(doc).attrs.src).toBe('https://cdn/ext.png')
  })

  it('replaces a failed external image with a clickable link (no broken-image box) + one warning', async () => {
    ingestAttachments.mockResolvedValue({
      mappings: [],
      notIngested: [{ sourceUrl: 'https://example.com/pic.png', reason: 'fetch_failed' }],
    })
    const doc = imageDoc('https://example.com/pic.png')
    const warnings = await migrateImportedImages('d_new', doc, echoT)

    expect(warnings).toEqual(['docs.import.externalImagesLinked'])
    // The image node is now a paragraph carrying a link to the original URL (not an image).
    const node = firstImageNode(doc)
    expect(node.type).toBe('paragraph')
    const textNode = (node.content as Array<Record<string, unknown>>)[0]
    expect(textNode.type).toBe('text')
    const marks = textNode.marks as Array<{ type: string; attrs: { href: string } }>
    expect(marks[0].type).toBe('link')
    expect(marks[0].attrs.href).toBe('https://example.com/pic.png')
  })

  it('uses the image alt as the link text when present, else the URL', async () => {
    ingestAttachments.mockResolvedValue({ mappings: [], notIngested: [{ sourceUrl: 'https://x/y.png', reason: 'fetch_failed' }] })
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x/y.png', alt: '图说明' } }] }
    await migrateImportedImages('d_new', doc)
    const node = doc.content[0] as Record<string, unknown>
    const textNode = (node.content as Array<Record<string, unknown>>)[0]
    expect(textNode.text).toBe('图说明')
  })

  it('turns EVERY external image into a link when the ingest request itself fails', async () => {
    ingestAttachments.mockRejectedValue(new Error('network'))
    const doc = imageDoc('https://example.com/pic.png')
    const warnings = await migrateImportedImages('d_new', doc, echoT)
    expect(warnings).toEqual(['docs.import.externalImagesLinked'])
    expect(firstImageNode(doc).type).toBe('paragraph')
  })

  it('surfaces a warning for a source the backend could not copy (best-effort, no throw)', async () => {
    copyAttachments.mockResolvedValue({
      mappings: [],
      notCopied: [{ sourceDocId: 'd_pdf_test_full', sourceAttachId: 'att_13a2f15faef2f55111bbfc69', reason: 'source_forbidden' }],
    })

    const doc = imageDoc(FOREIGN)
    const warnings = await migrateImportedImages('d_new', doc, echoT)

    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('docs.import.imageMigrateFailed')
    expect(warnings[0]).toContain('source_forbidden')
    // A copy failure keeps the original (short-lived signed) src so the image may still render
    // briefly, but the FOREIGN attachId is stripped: leaving it would make ImageNodeView
    // forever re-issue a doomed getReadUrl under the new doc once the src expires (permanent
    // broken-image box). Stripping it degrades to a plain src render instead.
    expect(firstImageNode(doc).attrs.src).toBe(FOREIGN)
    expect('attachId' in firstImageNode(doc).attrs).toBe(false)
  })

  it('degrades to a single warning when the copy request itself fails', async () => {
    copyAttachments.mockRejectedValue(new Error('network'))
    const doc = imageDoc(FOREIGN)
    const warnings = await migrateImportedImages('d_new', doc)
    expect(warnings.length).toBe(1)
  })

  it('is a no-op for a doc with no images', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    const warnings = await migrateImportedImages('d_new', doc)
    expect(warnings).toEqual([])
    expect(copyAttachments).not.toHaveBeenCalled()
  })

  it('does not crash on a service-shaped URL with a malformed percent-escape in the doc-id segment', async () => {
    // Imported .md is arbitrary user input. A service-shaped image URL whose doc-id
    // segment carries a bad %-sequence used to reach an unguarded decodeURIComponent
    // and throw URIError, aborting the whole migration and orphaning the new doc.
    // It must degrade like any other non-service image (skip service copy) instead.
    ingestAttachments.mockResolvedValue({ mappings: [], notIngested: [] })
    const BAD = 'http://localhost:28080/file/bad%ZZname/att_abc123/pic.png?X-Amz-Signature=x'
    const doc = imageDoc(BAD)
    const warnings = await migrateImportedImages('d_new', doc, echoT)
    // No throw; not treated as a copyable service image.
    expect(copyAttachments).not.toHaveBeenCalled()
    // Falls through to the external-image path (best-effort ingest by URL).
    expect(ingestAttachments).toHaveBeenCalledWith('d_new', [BAD])
    expect(Array.isArray(warnings)).toBe(true)
  })
})
