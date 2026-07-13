// Shared helper for wiring VoiceInputButton (#571) into the docs/sheet comment composers.
// Each composer keeps its body in a plain string state; this computes the next value from a
// transcription result, mirroring the splice semantics used by SummaryEditor in dmworksummary.

import type { ReplaceMode, SelectionRange } from '../octoweb/index.ts'

/** Apply a voice transcription to `current` given the replace mode + saved selection range. */
export function applyVoiceTranscription(
  current: string,
  text: string,
  mode: ReplaceMode,
  savedRange?: SelectionRange,
): string {
  if (mode === 'all') return text
  if (mode === 'selection' && savedRange) {
    return current.slice(0, savedRange.from) + text + current.slice(savedRange.to)
  }
  const pos = savedRange?.from ?? current.length
  return current.slice(0, pos) + text + current.slice(pos)
}
