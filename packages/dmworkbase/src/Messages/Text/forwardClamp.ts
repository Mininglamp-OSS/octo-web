// AC-13b title-clamp helper for forwarded doc messages (feature #511 §3.2, contract 5).
//
// A forwarded doc message is a plain Text/Markdown message `**title**\n[title](link)` — there is
// NO contentType or side-channel to single it out, so any render-layer change must be safe for ALL
// markdown messages. This helper keeps that safety:
//
//   title clamp is done in CSS (2 lines + ellipsis); this helper detects the exact forward
//   structure (strong + line-break + link) so the clamp class is applied ONLY to that shape,
//   never to arbitrary bold text (structure heuristic, contract 5 — no字符数 assertion).

/** Whether a string looks like an http(s) URL (used to decide if link text is a bare URL). */
export function isUrlLike(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

/** Lightweight, framework-agnostic descriptor of a paragraph child (for structure detection/tests). */
export interface ParagraphChildKind {
  isStrong?: boolean
  isLink?: boolean
  isBreak?: boolean
  /** Bare text run (whitespace-only runs are ignored by the detector). */
  text?: string
  /**
   * Visible text of a `strong` (the title) or `link` (the anchor label) run. The detector compares
   * the link label against the bold title (original `**title**\n[title](link)` shape) or checks it
   * looks like a bare URL (current `**title**\n[url](url)` shape) — see {@link isForwardDocCard}.
   */
  content?: string
}

/**
 * Detect the forwarded-doc-card structure: a leading bold run (the title), then a line break, then
 * a link. Two label shapes are accepted, matching what {@link buildForwardMessageText} has emitted
 * across #511:
 *   - `**title**\n[title](link)` — the original shape, link label === bold title (still present in
 *     already-sent history messages).
 *   - `**title**\n[url](url)` — the current shape, where the link label is the real URL so the
 *     recipient can see and click the destination (#511 problem 1, option A). Here label !== title,
 *     so the label is instead required to look like a bare http(s) URL via {@link isUrlLike}.
 *
 * Precision (the previously-blocked over-match): the exact strong → break → link skeleton with
 * NOTHING else already rejects ordinary "bold intro + some link" messages
 * (`**Note:** see [the docs](https://x)`, `**bold** [link](url)`) — they carry an extra text run or
 * fold to strong+link without the break. On top of that, a strong+break+link whose label is neither
 * the bold title NOR a bare URL (e.g. `**Heading**\n[open here](...)`) still falls through as a
 * plain paragraph. So only the two genuine forward shapes trigger the clamp;普通消息/普通链接 are
 * never wrongly clamped (contract 5 structure heuristic, B3 no-over-match guard).
 */
export function isForwardDocCard(children: ParagraphChildKind[]): boolean {
  const meaningful = children.filter(
    (c) => c.isStrong || c.isLink || c.isBreak || (c.text != null && c.text.trim() !== ''),
  )
  // The forward card is precisely strong → break → link, with nothing else in between.
  if (meaningful.length !== 3) return false
  const [first, second, third] = meaningful
  if (!first.isStrong || !second.isBreak || !third.isLink) return false
  const title = (first.content ?? '').trim()
  const label = (third.content ?? '').trim()
  if (title === '' || label === '') return false
  // Accept either the original title-labelled link or the current real-URL-labelled link. Any other
  // differing label (a bare word, prose) is NOT a forward card and stays a plain paragraph.
  return label === title || isUrlLike(label)
}
