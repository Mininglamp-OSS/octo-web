/**
 * Type definitions for the PDF export module.
 * Re-exports the MdNode interface from markdown.ts for consistency.
 */

import type { MdNode } from '../markdown.ts'
import type { ResolvedAttachment } from '../../attachments/api.ts'
import type { jsPDF } from 'jspdf'

export type { MdNode }

/** Options for the PDF export function. */
export interface PdfExportOptions {
  /** Batch size for the resolve endpoint (RES-1 cap). Default 200. */
  batchSize?: number
  /** Resolve fn injection point (tests pass a stub). Defaults to the real REST client. */
  resolve?: (docId: string, attachIds: string[]) => Promise<{ items: ResolvedAttachment[]; notFound: string[] }>
  /** name → unicode glyph for emoji nodes; defaults to the editor's emoji map. */
  emojiGlyph?: (name: string | null | undefined) => string | undefined
}

/** Internal context passed through the node/mark converters. */
export interface PdfContext {
  /** jsPDF document instance. */
  pdf: jsPDF
  /** Resolved attachment URLs keyed by attachId. */
  urls: Map<string, ResolvedAttachment>
  /** Fetched image data keyed by URL (base64 data URL). */
  imageData: Map<string, string>
  /** Emoji glyph resolver. */
  emojiGlyph?: (name: string | null | undefined) => string | undefined
  /** Current Y position on the page (in mm). */
  y: number
  /** Page width (usable content area, excluding margins, in mm). */
  contentWidth: number
  /** Page height (usable content area, excluding margins, in mm). */
  contentHeight: number
  /** Left margin (in mm). */
  marginLeft: number
  /** Top margin (in mm). */
  marginTop: number
  /** Current list depth for nested lists. */
  listDepth: number
  /** Whether Chinese font is loaded. */
  chineseFontLoaded: boolean
  /** Whether KaTeX math fonts are registered (enables rendered math). */
  katexFontsLoaded?: boolean
}

/** Represents a collected image reference that needs to be fetched. */
export interface ImageRef {
  attachId?: string
  src?: string
  resolvedUrl?: string
}

/** Text segment with styling for inline content. */
export interface TextSegment {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
  underline?: boolean
  color?: string
  link?: string
  subscript?: boolean
  superscript?: boolean
}
