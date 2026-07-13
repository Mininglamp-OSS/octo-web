// Post-process an xlsx (produced by xlsx-js-style) to inject FLOATING images, WITHOUT touching
// the cell/style parts — the "do images separately" approach (#3, option A). xlsx-js-style has no
// image support, and re-saving through ExcelJS risks mangling the carefully-built styles; so we
// treat the .xlsx as a zip and add only the OOXML drawing parts:
//   - xl/media/imageN.<ext>            the binary (from the Univer drawing's base64 source)
//   - xl/drawings/drawingN.xml         a <xdr:wsDr> with one <xdr:oneCellAnchor> per image
//   - xl/drawings/_rels/drawingN.xml.rels   rId → ../media/imageN.<ext>
//   - xl/worksheets/_rels/sheetM.xml.rels   rId → ../drawings/drawingN.xml (create or append)
//   - xl/worksheets/sheetM.xml          add <drawing r:id="…"/> (+ xmlns:r if missing)
//   - [Content_Types].xml               Default for each image ext + Override for each drawing
//
// Univer stores images as base64 (OSS image service), so the binary rides in `dataUrl` — no host.
// Cell images are exported degraded to floating images (WPS DISPIMG is proprietary; a floating
// image anchored at the cell is the portable equivalent Excel/WPS both render).
//
// EVERYTHING is defensive: any parse/patch failure returns the original buffer unchanged, so a
// surprising xlsx layout can never break the export — you just get the styled sheet without images.

import JSZip from 'jszip'

/** EMU (English Metric Units) per CSS pixel — OOXML drawing anchors/extents are in EMU. */
const EMU_PER_PX = 9525

/** One floating image to inject, anchored top-left at (col,row)+offset, sized width×height px. */
export interface ExportImage {
  /** `data:image/<ext>;base64,<data>` */
  dataUrl: string
  col: number
  row: number
  colOffPx?: number
  rowOffPx?: number
  widthPx: number
  heightPx: number
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
}

const CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

/** Split a data URL into { ext, base64 }, or null if it isn't a base64 image data URL. */
function parseDataUrl(dataUrl: string): { ext: string; base64: string } | null {
  const m = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(dataUrl)
  if (!m) return null
  const ext = MIME_EXT[m[1].toLowerCase()]
  if (!ext) return null
  return { ext, base64: m[2] }
}

const px2emu = (px: number): number => Math.max(0, Math.round(px * EMU_PER_PX))

/** Build the drawingN.xml body: one oneCellAnchor per image (fixed extent, move-with-cells). */
function buildDrawingXml(images: ExportImage[]): string {
  const anchors = images
    .map((img, i) => {
      const rid = `rId${i + 1}`
      const col = Math.max(0, Math.floor(img.col))
      const row = Math.max(0, Math.floor(img.row))
      const colOff = px2emu(img.colOffPx ?? 0)
      const rowOff = px2emu(img.rowOffPx ?? 0)
      const cx = px2emu(img.widthPx)
      const cy = px2emu(img.heightPx)
      const id = i + 1
      return (
        `<xdr:oneCellAnchor>` +
        `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${colOff}</xdr:colOff>` +
        `<xdr:row>${row}</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${cx}" cy="${cy}"/>` +
        `<xdr:pic>` +
        `<xdr:nvPicPr>` +
        `<xdr:cNvPr id="${id}" name="Picture ${id}"/>` +
        `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>` +
        `</xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr>` +
        `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
        `</xdr:spPr>` +
        `</xdr:pic>` +
        `<xdr:clientData/>` +
        `</xdr:oneCellAnchor>`
      )
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    anchors +
    `</xdr:wsDr>`
  )
}

/** Build the drawingN.xml.rels mapping each rId to its media part. */
function buildDrawingRels(images: Array<{ mediaName: string }>): string {
  const rels = images
    .map(
      (img, i) =>
        `<Relationship Id="rId${i + 1}" ` +
        `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
        `Target="../media/${img.mediaName}"/>`,
    )
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
  )
}

/** Next free `rIdN` in an existing worksheet .rels body (or rId1 when there is none). */
function nextRelId(relsXml: string | null): string {
  if (!relsXml) return 'rId1'
  let max = 0
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    const n = Number(m[1])
    if (n > max) max = n
  }
  return `rId${max + 1}`
}

/** Add a relationship to a worksheet .rels body (creating the doc when absent). */
function addSheetRel(relsXml: string | null, relId: string, target: string): string {
  const rel =
    `<Relationship Id="${relId}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" ` +
    `Target="${target}"/>`
  if (!relsXml || !relsXml.includes('</Relationships>')) {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`
    )
  }
  return relsXml.replace('</Relationships>', `${rel}</Relationships>`)
}

/** Insert `<drawing r:id="…"/>` into a worksheet xml (+ the r namespace if missing). */
function patchWorksheetXml(sheetXml: string, relId: string): string {
  let xml = sheetXml
  // Ensure the relationships namespace is declared on <worksheet …>.
  if (!/xmlns:r=/.test(xml)) {
    xml = xml.replace(
      /<worksheet(\s|>)/,
      `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"$1`,
    )
  }
  const drawingEl = `<drawing r:id="${relId}"/>`
  // <drawing> is one of the last children of <worksheet>; placing it right before the close tag is
  // schema-valid for the elements SheetJS emits (it never writes legacyDrawing/oleObjects/etc).
  if (xml.includes('</worksheet>')) return xml.replace('</worksheet>', `${drawingEl}</worksheet>`)
  return xml // no close tag found — leave untouched (defensive)
}

/** Ensure a `<Default Extension=… ContentType=…/>` exists for each ext, + Override for each drawing. */
function patchContentTypes(ctXml: string, exts: Set<string>, drawingParts: string[]): string {
  let xml = ctXml
  for (const ext of exts) {
    if (new RegExp(`Extension="${ext}"`, 'i').test(xml)) continue
    const ct = CONTENT_TYPE[ext]
    if (!ct) continue
    xml = xml.replace(/(<Types[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${ct}"/>`)
  }
  const overrides = drawingParts
    .map(
      (p) =>
        `<Override PartName="/${p}" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    )
    .join('')
  if (xml.includes('</Types>')) xml = xml.replace('</Types>', `${overrides}</Types>`)
  return xml
}

/**
 * Convert a stored FLOATING drawing (sheetDrawings Y.Map value — a Univer ISheetImage) to an
 * ExportImage, or null if it isn't an inline-base64 image (UUID/URL sources have no portable
 * binary to embed). Position comes from the sheetTransform's top-left anchor; size from transform.
 */
export function floatingToExportImage(raw: unknown): ExportImage | null {
  const d = raw as {
    source?: string
    transform?: { width?: number; height?: number }
    sheetTransform?: { from?: { column?: number; columnOffset?: number; row?: number; rowOffset?: number } }
  }
  const source = typeof d?.source === 'string' ? d.source : ''
  if (!source.startsWith('data:')) return null
  const from = d.sheetTransform?.from
  return {
    dataUrl: source,
    col: Math.max(0, Math.floor(Number(from?.column ?? 0)) || 0),
    row: Math.max(0, Math.floor(Number(from?.row ?? 0)) || 0),
    colOffPx: Number(from?.columnOffset ?? 0) || 0,
    rowOffPx: Number(from?.rowOffset ?? 0) || 0,
    widthPx: Number(d.transform?.width ?? 0) || 96,
    heightPx: Number(d.transform?.height ?? 0) || 96,
  }
}

/**
 * Extract CELL images from a cell's rich-text snapshot (`cell.p`). Univer stores an inline cell
 * image in `p.drawings[id]`; we degrade each to a floating image anchored at the cell (col,row).
 * Only inline-base64 sources are exportable.
 */
export function cellPToExportImages(p: unknown, col: number, row: number): ExportImage[] {
  const doc = p as { drawings?: Record<string, unknown> } | undefined
  const drawings = doc?.drawings
  if (!drawings || typeof drawings !== 'object') return []
  const out: ExportImage[] = []
  for (const id of Object.keys(drawings)) {
    const dr = drawings[id] as {
      source?: string
      docTransform?: { size?: { width?: number; height?: number } }
      transform?: { width?: number; height?: number }
    }
    const source = typeof dr?.source === 'string' ? dr.source : ''
    if (!source.startsWith('data:')) continue
    const size = dr.docTransform?.size
    out.push({
      dataUrl: source,
      col,
      row,
      colOffPx: 2,
      rowOffPx: 2,
      widthPx: Number(size?.width ?? dr.transform?.width ?? 0) || 96,
      heightPx: Number(size?.height ?? dr.transform?.height ?? 0) || 96,
    })
  }
  return out
}

/**
 * Inject floating images into an xlsx buffer. `imagesBySheetIndex` is keyed by the 1-based
 * worksheet index (matching xl/worksheets/sheet{N}.xml, the order sheets were appended). Returns a
 * NEW buffer with images added, or the ORIGINAL buffer unchanged if anything goes wrong.
 */
export async function injectImagesIntoXlsx(
  buf: ArrayBuffer,
  imagesBySheetIndex: Map<number, ExportImage[]>,
): Promise<ArrayBuffer> {
  // Nothing to do → skip the whole zip round-trip.
  let total = 0
  for (const list of imagesBySheetIndex.values()) total += list.length
  if (total === 0) return buf

  try {
    const zip = await JSZip.loadAsync(buf)
    const ctPath = '[Content_Types].xml'
    const ctFile = zip.file(ctPath)
    if (!ctFile) return buf
    let ctXml = await ctFile.async('string')

    const usedExts = new Set<string>()
    const drawingParts: string[] = []
    let drawingCounter = 0
    let mediaCounter = 0

    for (const [sheetIndex, images] of imagesBySheetIndex) {
      if (!images.length) continue
      const sheetPath = `xl/worksheets/sheet${sheetIndex}.xml`
      const sheetFile = zip.file(sheetPath)
      if (!sheetFile) continue // unexpected layout — skip this sheet's images

      // Materialize each image's media part; collect the resolved list (skip bad data URLs).
      const resolved: Array<ExportImage & { mediaName: string }> = []
      for (const img of images) {
        const parsed = parseDataUrl(img.dataUrl)
        if (!parsed) continue
        mediaCounter++
        const mediaName = `image${mediaCounter}.${parsed.ext}`
        zip.file(`xl/media/${mediaName}`, parsed.base64, { base64: true })
        usedExts.add(parsed.ext)
        resolved.push({ ...img, mediaName })
      }
      if (!resolved.length) continue

      drawingCounter++
      const drawingName = `drawing${drawingCounter}.xml`
      const drawingPath = `xl/drawings/${drawingName}`
      zip.file(drawingPath, buildDrawingXml(resolved))
      zip.file(`xl/drawings/_rels/${drawingName}.rels`, buildDrawingRels(resolved))
      drawingParts.push(drawingPath)

      // Wire the drawing into the worksheet via its .rels + a <drawing> element.
      const relsPath = `xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`
      const relsFile = zip.file(relsPath)
      const relsXml = relsFile ? await relsFile.async('string') : null
      const relId = nextRelId(relsXml)
      zip.file(relsPath, addSheetRel(relsXml, relId, `../drawings/${drawingName}`))

      const sheetXml = await sheetFile.async('string')
      zip.file(sheetPath, patchWorksheetXml(sheetXml, relId))
    }

    if (drawingParts.length === 0) return buf // nothing actually injected

    ctXml = patchContentTypes(ctXml, usedExts, drawingParts)
    zip.file(ctPath, ctXml)

    return await zip.generateAsync({ type: 'arraybuffer' })
  } catch (e) {
    console.warn('[sheet-export] image injection failed — exporting without images', e)
    return buf
  }
}
