/**
 * DOCX Export Module — Main Entry Point.
 *
 * Converts a ProseMirror JSON document into a DOCX file (as Blob).
 * Uses the `docx` library (github.com/dolanmiu/docx).
 *
 * Images are resolved via the resolveAttachments API (same as markdown export)
 * and fetched as ArrayBuffers for embedding with ImageRun.
 */

import { Document, Packer, type ISectionOptions } from 'docx'
import { resolveAttachments } from '../../attachments/api.ts'
import { rasterizeSvgImageBuffers, resolveAndFetchImages } from './images.ts'
import { convertBlocks, NUMBERING_CONFIG, ORDERED_LIST_CONFIG_INDEX } from './nodes.ts'
import { DOCX_STYLES } from './styles.ts'
import type { MdNode, DocxExportOptions, DocxContext } from './types.ts'

export type { MdNode, DocxExportOptions }

/**
 * Export a ProseMirror JSON document to a DOCX Blob.
 *
 * @param docId - The document ID (used for resolving attachments).
 * @param doc - The ProseMirror JSON root node (from editor.getJSON()).
 * @param opts - Optional configuration for batch size, resolve function, emoji resolver.
 * @returns A Blob containing the .docx file.
 */
export async function exportDocToDocx(
  docId: string,
  doc: MdNode,
  opts: DocxExportOptions = {},
): Promise<Blob> {
  const resolve = opts.resolve ?? resolveAttachments

  // Resolve attachment URLs and fetch image buffers
  const { urls, imageBuffers } = await resolveAndFetchImages(docId, doc, {
    batchSize: opts.batchSize,
    resolve,
  })
  // `convertBlocks` is intentionally synchronous (notably for recursive table
  // conversion), so complete browser-side SVG → real PNG conversion up front.
  await rasterizeSvgImageBuffers(doc, urls, imageBuffers)

  // Build the conversion context
  const ctx: DocxContext = {
    urls,
    imageBuffers,
    emojiGlyph: opts.emojiGlyph,
    dynamicNumbering: [],
    orderedListInstance: 0,
  }

  // Convert ProseMirror JSON blocks to docx elements
  const children = convertBlocks(doc.content ?? [], ctx)

  // Create the document section
  const section: ISectionOptions = {
    properties: {
      page: {
        margin: {
          top: 1440,    // 1 inch
          right: 1440,
          bottom: 1440,
          left: 1440,
        },
      },
    },
    children,
  }

  // Build numbering config: static defs + one reference per non-default-start
  // ordered list. Each dynamic reference clones the ordered-list levels but sets
  // level[0].start (docx derives an instance's first number from level[0].start).
  const orderedLevels = NUMBERING_CONFIG.config[ORDERED_LIST_CONFIG_INDEX].levels
  const numbering = {
    config: [
      ...NUMBERING_CONFIG.config,
      ...ctx.dynamicNumbering.map((dn) => ({
        reference: dn.reference,
        levels: orderedLevels.map((lvl) => (lvl.level === dn.level ? { ...lvl, start: dn.start } : lvl)),
      })),
    ],
  }

  // Create the full document with styles and numbering
  const document = new Document({
    styles: DOCX_STYLES,
    numbering,
    sections: [section],
  })

  // Pack the document into a Blob
  const buffer = await Packer.toBlob(document)
  return buffer
}
