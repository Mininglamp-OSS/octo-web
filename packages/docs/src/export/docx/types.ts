/**
 * Type definitions for the DOCX export module.
 * Re-exports the MdNode interface from markdown.ts for consistency.
 */

import type { MdNode } from '../markdown.ts'
import type { ResolvedAttachment } from '../../attachments/api.ts'

export type { MdNode }

/** Options for the DOCX export function. */
export interface DocxExportOptions {
  /** Batch size for the resolve endpoint (RES-1 cap). Default 200. */
  batchSize?: number
  /** Resolve fn injection point (tests pass a stub). Defaults to the real REST client. */
  resolve?: (docId: string, attachIds: string[]) => Promise<{ items: ResolvedAttachment[]; notFound: string[] }>
  /** name → unicode glyph for emoji nodes; defaults to the editor's emoji map. */
  emojiGlyph?: (name: string | null | undefined) => string | undefined
}

/** Internal context passed through the node/mark converters. */
export interface DocxContext {
  /** Resolved attachment URLs keyed by attachId. */
  urls: Map<string, ResolvedAttachment>
  /** Fetched image buffers keyed by URL. */
  imageBuffers: Map<string, ArrayBuffer>
  /** Emoji glyph resolver. */
  emojiGlyph?: (name: string | null | undefined) => string | undefined
  /**
   * Dynamic numbering references for ordered lists whose start > 1.
   * docx derives an instance's starting number from its abstract level[0].start,
   * so a non-default start needs its own reference with a customized level set.
   */
  dynamicNumbering: Array<{ reference: string; start: number; level: number }>
  /** Monotonic counter handing each ordered list its own numbering instance (independent counting). */
  orderedListInstance: number
}

/** Represents a collected image reference that needs to be fetched. */
export interface ImageRef {
  attachId?: string
  src?: string
  resolvedUrl?: string
}
