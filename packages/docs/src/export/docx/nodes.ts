/**
 * Block-level node converters for the DOCX export.
 * Converts ProseMirror JSON nodes into docx Paragraph/Table/etc. elements.
 */

import {
  Paragraph,
  TextRun,
  ImageRun,
  CheckBox,
  HeadingLevel,
  LevelFormat,
  AlignmentType,
  ExternalHyperlink,
  UnderlineType,
  type ILevelsOptions,
  type FileChild,
} from 'docx'
import { convertInlineContent, iconPrefix } from './marks.ts'
import { isSafeHref } from './href-safety.ts'
import { latexToMathComponent } from './math.ts'

/** Re-exported so existing importers (e.g. href-safety.test.ts) keep working. */
export { isSafeHref } from './href-safety.ts'

/**
 * Sniff the DOCX image type from a buffer's magic bytes. Used for raw-src / data:
 * images that carry no resolved attachment mime, so a JPEG/GIF/BMP is embedded
 * with the correct type instead of a broken default. Returns null when unknown.
 */
function sniffImageType(buffer: ArrayBuffer): 'jpg' | 'png' | 'gif' | 'bmp' | null {
  const b = new Uint8Array(buffer)
  if (b.length < 4) return null
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  // GIF: 47 49 46 (GIF)
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  // BMP: 42 4D (BM)
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  return null
}
import { convertTable } from './tables.ts'
import { getImageBuffer, getImageDimensions } from './images.ts'
import { FONT_CODE, mapTextAlign } from './styles.ts'
import type { MdNode, DocxContext } from './types.ts'

/** Map heading level 1-6 to docx HeadingLevel enum. */
function toHeadingLevel(level: unknown): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  const n = typeof level === 'number' ? level : 1
  switch (Math.min(6, Math.max(1, n))) {
    case 1: return HeadingLevel.HEADING_1
    case 2: return HeadingLevel.HEADING_2
    case 3: return HeadingLevel.HEADING_3
    case 4: return HeadingLevel.HEADING_4
    case 5: return HeadingLevel.HEADING_5
    case 6: return HeadingLevel.HEADING_6
    default: return HeadingLevel.HEADING_1
  }
}

/** Numbering configuration for lists. */
/** Index of 'ordered-list' in NUMBERING_CONFIG.config — used by dynamic numbering. */
export const ORDERED_LIST_CONFIG_INDEX = 1

export const NUMBERING_CONFIG = {
  config: [
    {
      reference: 'bullet-list',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        { level: 2, format: LevelFormat.BULLET, text: '▪', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 2160, hanging: 360 } } } },
        { level: 3, format: LevelFormat.BULLET, text: "‣", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 2880, hanging: 360 } } } },
        { level: 4, format: LevelFormat.BULLET, text: "⁃", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 3600, hanging: 360 } } } },
      ] as ILevelsOptions[],
    },
    {
      reference: 'ordered-list',
      levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
        { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 2160, hanging: 360 } } } },
        { level: 3, format: LevelFormat.DECIMAL, text: "%4.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 2880, hanging: 360 } } } },
        { level: 4, format: LevelFormat.LOWER_LETTER, text: "%5.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 3600, hanging: 360 } } } },
      ] as ILevelsOptions[],
    },
    // Note: task lists do NOT use numbering — convertTaskList draws its own ☑/☐
    // status box per item (see below). A numbering bullet here would duplicate it.
  ],
}

/**
 * Resolve the numbering reference + instance for an orderedList node.
 *
 * docx generates one independent concrete numbering per (reference, instance)
 * pair, each counting from its abstract level[0].start. So:
 *  - every ordered list gets a fresh instance → independent lists restart at 1
 *  - a list with an explicit start > 1 gets its own reference whose level set
 *    starts at that value (the config-level `overrideLevels` field is ignored
 *    by docx, so the start must live in the level definition itself)
 */
function getOrderedListNumbering(node: MdNode, ctx: DocxContext, depth: number): { reference: string; instance: number } {
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
  const instance = ctx.orderedListInstance++
  if (start <= 1) return { reference: 'ordered-list', instance }
  const reference = `ordered-list-start-${ctx.dynamicNumbering.length}`
  ctx.dynamicNumbering.push({ reference, start, level: Math.min(depth, 4) })
  return { reference, instance }
}

/**
 * Convert a top-level document's content array into docx FileChild elements.
 */
export function convertBlocks(nodes: MdNode[], ctx: DocxContext): FileChild[] {
  const result: FileChild[] = []
  for (const node of nodes) {
    const converted = convertBlock(node, ctx, 0)
    result.push(...converted)
  }
  return result
}

/**
 * Convert a single block-level node into one or more docx elements.
 */
function convertBlock(node: MdNode, ctx: DocxContext, listDepth: number): FileChild[] {
  switch (node.type) {
    case 'paragraph':
      return [convertParagraph(node, ctx)]
    case 'heading':
      return [convertHeading(node, ctx)]
    case 'bulletList':
      return convertList(node, 'bullet-list', ctx, listDepth)
    case 'orderedList': {
      const { reference, instance } = getOrderedListNumbering(node, ctx, listDepth)
      return convertList(node, reference, ctx, listDepth, instance)
    }
    case 'taskList':
      return convertTaskList(node, ctx, listDepth)
    case 'blockquote':
      return convertBlockquote(node, ctx)
    case 'codeBlock':
      return convertCodeBlock(node)
    case 'horizontalRule':
      return [convertHorizontalRule()]
    case 'table':
      return [convertTable(node, ctx)]
    case 'image':
      return convertImage(node, ctx)
    case 'fileAttachment':
      return [convertFileAttachment(node, ctx)]
    case 'bookmark':
      return [convertBookmark(node)]
    case 'callout':
      return convertCallout(node, ctx)
    case 'blockMath':
      return [convertBlockMath(node)]
    case 'details':
      return convertDetails(node, ctx)
    default:
      // Never drop content: recurse into unknown container or emit raw text
      if (node.content && node.content.length) return convertBlocks(node.content, ctx)
      if (node.text) return [new Paragraph({ children: [new TextRun({ text: node.text })] })]
      return []
  }
}

/** Convert a paragraph node. */
function convertParagraph(node: MdNode, ctx: DocxContext): Paragraph {
  const runs = convertInlineContent(node.content ?? [], ctx.emojiGlyph)
  const align = mapTextAlign(node.attrs?.textAlign)
  return new Paragraph({ children: runs, ...(align ? { alignment: align } : {}) })
}

/** Convert a heading node. */
function convertHeading(node: MdNode, ctx: DocxContext): Paragraph {
  const runs = convertInlineContent(node.content ?? [], ctx.emojiGlyph)
  const align = mapTextAlign(node.attrs?.textAlign)
  return new Paragraph({
    children: runs,
    heading: toHeadingLevel(node.attrs?.level),
    ...(align ? { alignment: align } : {}),
  })
}

/** Convert a bullet/ordered list. `instance` selects an independent numbering instance for ordered lists. */
function convertList(node: MdNode, reference: string, ctx: DocxContext, depth: number, instance = 0): FileChild[] {
  const items = node.content ?? []
  const result: FileChild[] = []

  for (const item of items) {
    const blocks = item.content ?? []
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      if (block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'taskList') {
        // Nested list: increase depth. Ordered lists get their own reference+instance.
        if (block.type === 'orderedList') {
          const nested = getOrderedListNumbering(block, ctx, depth + 1)
          result.push(...convertList(block, nested.reference, ctx, depth + 1, nested.instance))
        } else if (block.type === 'taskList') {
          // Nested task list keeps its own ☑/☐ boxes (not bullet numbering).
          result.push(...convertTaskList(block, ctx, depth + 1))
        } else {
          result.push(...convertList(block, 'bullet-list', ctx, depth + 1))
        }
      } else if (i === 0) {
        // First block in list item — apply numbering
        const runs = convertInlineContent(block.content ?? [], ctx.emojiGlyph)
        result.push(
          new Paragraph({
            children: runs,
            numbering: { reference, level: Math.min(depth, 4), instance },
          }),
        )
      } else {
        // Continuation blocks under the same item
        result.push(...convertBlock(block, ctx, depth))
      }
    }
  }

  return result
}

/**
 * Convert a task list.
 *
 * Each item gets a real interactive Word checkbox (docx CheckBox = a w:sdt
 * content control with w14:checkbox), followed by one normal-width space, then
 * the item content. The checkbox is clickable/toggleable in Word regardless of
 * its initial checked state — not a static ☑/☐ glyph.
 * We deliberately do NOT use list numbering here: a numbering bullet would add
 * a second box and its own tab, producing the "two boxes + double space" bug.
 * Indentation is applied manually so the layout still looks like a list.
 */
function convertTaskList(node: MdNode, ctx: DocxContext, depth: number): FileChild[] {
  const items = node.content ?? []
  const result: FileChild[] = []
  const indentLeft = 720 * (Math.min(depth, 4) + 1)

  for (const item of items) {
    const checked = !!item.attrs?.checked
    const blocks = item.content ?? []

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      if (block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'taskList') {
        if (block.type === 'orderedList') {
          const nested = getOrderedListNumbering(block, ctx, depth + 1)
          result.push(...convertList(block, nested.reference, ctx, depth + 1, nested.instance))
        } else if (block.type === 'taskList') {
          result.push(...convertTaskList(block, ctx, depth + 1))
        } else {
          result.push(...convertList(block, 'bullet-list', ctx, depth + 1))
        }
      } else if (i === 0) {
        const runs = convertInlineContent(block.content ?? [], ctx.emojiGlyph)
        result.push(
          new Paragraph({
            children: [
              new CheckBox({
                checked,
                // Use ☑ (U+2611, check mark in box) for the checked state instead of
                // docx's default ☒ (U+2612, X in box) — users expect a check mark.
                checkedState: { value: '2611', font: 'MS Gothic' },
                uncheckedState: { value: '2610', font: 'MS Gothic' },
              }),
              new TextRun({ text: ' ' }),
              ...runs,
            ],
            indent: { left: indentLeft, hanging: 360 },
          }),
        )
      } else {
        result.push(...convertBlock(block, ctx, depth))
      }
    }
  }

  return result
}

/** Convert a blockquote. */
function convertBlockquote(node: MdNode, ctx: DocxContext): FileChild[] {
  const children = node.content ?? []
  const result: FileChild[] = []

  for (const child of children) {
    if (child.type === 'paragraph') {
      const runs = convertInlineContent(child.content ?? [], ctx.emojiGlyph)
      result.push(
        new Paragraph({
          children: runs,
          style: 'BlockQuote',
          indent: { left: 720 },
        }),
      )
    } else {
      // Nested blocks in blockquote
      const converted = convertBlock(child, ctx, 0)
      result.push(...converted)
    }
  }

  return result
}

/** Convert a code block. */
function convertCodeBlock(node: MdNode): FileChild[] {
  const code = (node.content ?? []).map((c) => c.text ?? '').join('')
  const lines = code.split('\n')

  return lines.map(
    (line) =>
      new Paragraph({
        children: line
          ? [
              new TextRun({
                text: line,
                font: { name: FONT_CODE, hint: 'default' },
                size: 20,
              }),
            ]
          : [], // empty line — no TextRun needed, Paragraph renders as blank line
        style: 'CodeBlock',
        spacing: { before: 0, after: 0, line: 240 },
        shading: { fill: 'F5F5F5' },
      }),
  )
}

/** Convert a horizontal rule. */
function convertHorizontalRule(): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: '─'.repeat(50),
        color: 'CCCCCC',
        size: 16,
      }),
    ],
    spacing: { before: 120, after: 120 },
    alignment: AlignmentType.CENTER,
  })
}

/** Convert an image node. */
function convertImage(node: MdNode, ctx: DocxContext): FileChild[] {
  const buffer = getImageBuffer(node, ctx)
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''

  if (!buffer) {
    // Image couldn't be fetched — emit alt text or placeholder
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: alt ? `[Image: ${alt}]` : '[Image unavailable]',
            italics: true,
            color: '888888',
          }),
        ],
      }),
    ]
  }

  const dims = getImageDimensions(node, buffer)
  // Image uses `align` attr (left/center/right), not `textAlign`
  const align = mapTextAlign(node.attrs?.align)

  // Detect image type. Prefer a resolved attachment's mime; for raw src / data:
  // images (no attachment mime) sniff the buffer's magic bytes so a JPEG/GIF/BMP
  // is not mislabelled as PNG (which Word renders broken). Default png when unknown.
  const attachId = typeof node.attrs?.attachId === 'string' ? node.attrs.attachId : undefined
  const resolved = attachId ? ctx.urls.get(attachId) : undefined
  const mime = resolved?.mime ?? ''
  let imgType: 'jpg' | 'png' | 'gif' | 'bmp' = 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) imgType = 'jpg'
  else if (mime.includes('gif')) imgType = 'gif'
  else if (mime.includes('bmp')) imgType = 'bmp'
  else if (mime.includes('png')) imgType = 'png'
  else {
    const sniffed = sniffImageType(buffer)
    if (sniffed) imgType = sniffed
  }

  return [
    new Paragraph({
      children: [
        new ImageRun({
          data: buffer,
          transformation: { width: dims.width, height: dims.height },
          type: imgType,
        }),
      ],
      ...(align ? { alignment: align } : {}),
    }),
  ]
}

/** Convert a file attachment node (signed download link, same as Markdown export). */
function convertFileAttachment(node: MdNode, ctx: DocxContext): Paragraph {
  const attachId = typeof node.attrs?.attachId === 'string' ? node.attrs.attachId : undefined
  const resolved = attachId ? ctx.urls.get(attachId) : undefined
  const name =
    (typeof node.attrs?.fileName === 'string' && node.attrs.fileName) ||
    resolved?.fileName ||
    'attachment'

  if (resolved?.url && isSafeHref(resolved.url)) {
    return new Paragraph({
      children: [
        ...iconPrefix('📎'),
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: name,
              style: 'Hyperlink',
              underline: { type: UnderlineType.SINGLE },
              color: '1A73E8',
            }),
          ],
          link: resolved.url,
        }),
      ],
    })
  }

  return new Paragraph({
    children: [
      ...iconPrefix('📎'),
      new TextRun({
        text: name + ' (unavailable)',
        italics: true,
        color: '888888',
      }),
    ],
  })
}

/** Convert a bookmark node. */
function convertBookmark(node: MdNode): Paragraph {
  const url = typeof node.attrs?.url === 'string' ? node.attrs.url : ''
  const title = (typeof node.attrs?.title === 'string' && node.attrs.title) || url

  if (url && isSafeHref(url)) {
    return new Paragraph({
      children: [
        ...iconPrefix('🔗'),
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: title,
              style: 'Hyperlink',
              underline: { type: UnderlineType.SINGLE },
              color: '1A73E8',
            }),
          ],
          link: url,
        }),
      ],
    })
  }

  return new Paragraph({
    children: [new TextRun({ text: title || '[bookmark]' })],
  })
}

/** Callout variant → style mapping. */
const CALLOUT_STYLES: Record<string, string> = {
  info: 'CalloutInfo',
  warn: 'CalloutWarn',
  warning: 'CalloutWarn',
  tip: 'CalloutTip',
  success: 'CalloutSuccess',
}

/** Callout variant → emoji prefix (bare glyph; spacing added via iconPrefix). */
const CALLOUT_EMOJI: Record<string, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  warning: '⚠️',
  tip: '💡',
  success: '✅',
}

/** Convert a callout node. */
function convertCallout(node: MdNode, ctx: DocxContext): FileChild[] {
  const variant = typeof node.attrs?.variant === 'string' ? node.attrs.variant : 'info'
  const style = CALLOUT_STYLES[variant] ?? 'CalloutInfo'
  const emoji = CALLOUT_EMOJI[variant] ?? 'ℹ️'
  const children = node.content ?? []
  const result: FileChild[] = []

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.type === 'paragraph') {
      const runs = convertInlineContent(child.content ?? [], ctx.emojiGlyph)
      // Prepend emoji to first paragraph
      const prefix = i === 0 ? iconPrefix(emoji, { bold: true }) : []
      result.push(
        new Paragraph({
          children: [...prefix, ...runs],
          style,
          indent: { left: 360 },
        }),
      )
    } else {
      result.push(...convertBlock(child, ctx, 0))
    }
  }

  return result
}

/** Convert a block math node into a centered, native Word formula (OMML). */
function convertBlockMath(node: MdNode): Paragraph {
  const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : ''
  const math = latexToMathComponent(latex, true)
  if (math) {
    // Real OMML formula, rendered natively by Word.
    return new Paragraph({
      children: [math],
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 120 },
    })
  }
  // Fallback: conversion failed — keep the LaTeX source as monospace text so
  // no content is lost (latexToMathComponent already logged the reason).
  return new Paragraph({
    children: [
      new TextRun({
        text: latex,
        font: FONT_CODE,
        italics: true,
        size: 22,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
  })
}

/** Convert a details/collapsible node. */
function convertDetails(node: MdNode, ctx: DocxContext): FileChild[] {
  const children = node.content ?? []
  const summaryNode = children.find((c) => c.type === 'detailsSummary')
  const contentNode = children.find((c) => c.type === 'detailsContent')
  const result: FileChild[] = []

  // Summary as a bold paragraph with toggle indicator
  if (summaryNode) {
    const runs = convertInlineContent(summaryNode.content ?? [], ctx.emojiGlyph)
    result.push(
      new Paragraph({
        children: [new TextRun({ text: '▸ ', bold: true }), ...runs],
        spacing: { before: 80, after: 40 },
      }),
    )
  }

  // Content indented
  const contentChildren = contentNode?.content ?? children.filter((c) => c.type !== 'detailsSummary')
  for (const child of contentChildren) {
    if (child.type === 'paragraph') {
      const runs = convertInlineContent(child.content ?? [], ctx.emojiGlyph)
      result.push(
        new Paragraph({
          children: runs,
          indent: { left: 360 },
        }),
      )
    } else {
      result.push(...convertBlock(child, ctx, 0))
    }
  }

  return result
}
