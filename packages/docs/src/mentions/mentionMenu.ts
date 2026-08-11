// The @-mention candidate panel body — grouped, rich rows, following the executable-comment
// prototype's design (`.mention-popover` / `.mention-option` / `.agent-avatar` / the `Bot` pill).
//
// WHY A DEDICATED BODY BUILDER: the shared suggestion popup paints one flat text row per item, which
// cannot express what this panel has to say — that Bots and people are DIFFERENT KINDS of candidate,
// that a Bot carries a description and a provenance ("自己创建" / "好友共享"), that an offline Bot is
// visible but unusable, and that an EMPTY Bot section needs a reason rather than silence. So this
// module supplies `renderRows` + `hasContent` to createSuggestionMenuRenderer and inherits all of
// its keyboard / outside-click / positioning / teardown behaviour unchanged (that logic stays in
// exactly one place).
//
// STRUCTURE (three sections, each with a heading, in a fixed order):
//   Bot    — rich rows: avatar glyph, name, "<description> · <relation>", trailing "Bot" pill.
//            When no Bot can be offered, ONE notice line replaces the whole section AND its heading
//            (a heading over nothing reads like a loading bug).
//   成员    — people: the same card shape (initial-letter avatar tile + @name), so the panel is
//            one consistent design rather than a rich Bot row above bare text rows.
//   文档    — document candidates: same card, with a file glyph instead of an initial.
//
// DESIGN-TOKEN RULE: the prototype's own CSS variable names are NOT copied. Every colour / radius /
// spacing resolves through this repo's existing `--wk-*` / `--octo-*` tokens (see styles.css), so
// light and dark themes track the host automatically. Only the LAYOUT and the visual hierarchy are
// borrowed.

import { t } from '../octoweb/index.ts'
import type { SuggestionRow } from '../editor/suggestionMenu.ts'
import { createBotGlyph } from './BotGlyph.ts'
import type { BotNotice } from './botCandidates.ts'
import type { MentionItem } from './source.ts'

/** i18n key for each reason the Bot section can be empty. */
const NOTICE_KEY: Record<BotNotice, string> = {
  'no-permission': 'docs.mention.botNoPermission',
  // Deliberately distinct from 'no-permission': the role simply has not arrived from the collab
  // token yet. Showing the owner「当前权限不能 @Bot」during that window was the reported bug.
  'role-unknown': 'docs.mention.botRoleUnknown',
  'none-available': 'docs.mention.botNoneAvailable',
  'none-with-doc-access': 'docs.mention.botNoneWithDocAccess',
  'permission-unknown': 'docs.mention.botPermissionUnknown',
}

/** Relationship label: how the caller is entitled to use this Bot. */
function relationLabel(item: MentionItem): string {
  return item.botRelation === 'creator'
    ? t('docs.mention.botRelationCreator')
    : t('docs.mention.botRelationFriend')
}

/**
 * The `<small>` line under a Bot's name: "<what it does> · <how you can use it>". The description
 * is omitted rather than shown blank when the host sent none, so the line never starts with " · ".
 */
function botSubtitle(item: MentionItem): string {
  const rel = relationLabel(item)
  const desc = item.botDescription?.trim()
  return desc ? `${desc} · ${rel}` : rel
}

function heading(text: string, container: HTMLElement): void {
  const p = document.createElement('p')
  p.className = 'octo-mention-group'
  p.textContent = text
  container.appendChild(p)
}

function separator(container: HTMLElement): void {
  const sep = document.createElement('div')
  sep.className = 'octo-mention-sep'
  container.appendChild(sep)
}

/** A rich Bot row. Offline → visibly de-emphasised AND genuinely `disabled` (never choosable). */
function botRow(item: MentionItem, container: HTMLElement): SuggestionRow<MentionItem> {
  const offline = item.botOffline === true
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'octo-mention-option' + (offline ? ' is-disabled' : '')
  row.dataset.kind = 'agent'
  row.setAttribute('role', 'option')
  if (offline) row.disabled = true

  const avatar = document.createElement('span')
  avatar.className = 'octo-mention-avatar'
  avatar.appendChild(createBotGlyph())
  row.appendChild(avatar)

  const meta = document.createElement('span')
  meta.className = 'octo-mention-meta'
  const name = document.createElement('strong')
  name.textContent = item.label
  const sub = document.createElement('small')
  // An offline Bot must say WHY it cannot be picked, or a greyed row looks like a rendering bug.
  sub.textContent = offline
    ? `${botSubtitle(item)} · ${t('docs.mention.botOffline')}`
    : botSubtitle(item)
  meta.append(name, sub)
  row.appendChild(meta)

  const badge = document.createElement('em')
  badge.className = 'octo-mention-badge'
  badge.textContent = t('docs.mention.botBadge')
  row.appendChild(badge)

  container.appendChild(row)
  return { el: row, item, ...(offline ? { disabled: true } : {}) }
}

/**
 * Inline document glyph for a `@doc` row. Local to this panel (unlike the Bot glyph, which the
 * version list also uses) and inline for the same reason: this menu is built with raw DOM.
 */
function createDocGlyph(): SVGElement {
  const wrap = document.createElement('div')
  wrap.innerHTML =
    '<svg class="octo-doc-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v5h5M9 13h6M9 17h6"></path>' +
    '</svg>'
  return wrap.firstElementChild as SVGElement
}

/**
 * First visible character of a name, as the avatar initial (the prototype shows 王 / 陈 / 李 circles).
 * Uses the spread iterator so an astral-plane character (emoji name) is not split into a lone
 * surrogate half, which would render as a replacement glyph.
 */
function initial(label: string): string {
  return [...label.trim()][0] ?? '@'
}

/**
 * Stable avatar tint per uid, echoing the prototype's rotation of purple / teal / brand circles.
 * Deterministic (same person keeps their colour across repaints) and index-based, so it resolves to a
 * `--wk-*` token in CSS rather than a literal here.
 */
function tintIndex(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % 3
}

/**
 * A person or document row, in the SAME card shape as a Bot row so the panel reads as one design:
 * avatar tile, then the name. The prototype also shows a job title under a person's name, but the
 * mention source carries no title/role for a space member — so the `<small>` line is OMITTED rather
 * than filled with a placeholder. Nothing is invented to look busier.
 */
function richRow(
  item: MentionItem,
  container: HTMLElement,
  kind: 'person' | 'doc',
): SuggestionRow<MentionItem> {
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'octo-mention-option'
  row.dataset.kind = kind
  row.setAttribute('role', 'option')

  const avatar = document.createElement('span')
  if (kind === 'doc') {
    avatar.className = 'octo-mention-avatar is-doc'
    avatar.appendChild(createDocGlyph())
  } else {
    avatar.className = `octo-mention-avatar is-person is-tint-${tintIndex(item.id)}`
    avatar.textContent = initial(item.label)
  }
  row.appendChild(avatar)

  const meta = document.createElement('span')
  meta.className = 'octo-mention-meta'
  const name = document.createElement('strong')
  // People read as "@name" (that is what gets inserted); a document title stands on its own.
  name.textContent = kind === 'person' ? `@${item.label}` : item.label
  meta.appendChild(name)
  row.appendChild(meta)

  container.appendChild(row)
  return { el: row, item }
}

function noticeLine(key: string, container: HTMLElement): void {
  const p = document.createElement('p')
  p.className = 'octo-mention-empty'
  p.textContent = t(key)
  container.appendChild(p)
}

/**
 * Build the grouped panel body. `getBotNotice` is read at paint time (a THUNK) because the notice is
 * resolved by the async source load, which may settle after the popup first opened.
 */
export function createMentionRowsRenderer(getBotNotice: () => BotNotice | null) {
  return (items: MentionItem[], container: HTMLElement): SuggestionRow<MentionItem>[] => {
    const bots = items.filter((i) => i.type === 'user' && i.isBot)
    const people = items.filter((i) => i.type === 'user' && !i.isBot)
    const docs = items.filter((i) => i.type === 'doc')
    const notice = getBotNotice()
    const rows: SuggestionRow<MentionItem>[] = []

    // —— Bot section ——
    if (bots.length > 0) {
      heading(t('docs.mention.groupBot'), container)
      for (const b of bots) rows.push(botRow(b, container))
    } else if (notice != null) {
      // The reason replaces the section entirely — no heading above an empty group.
      noticeLine(NOTICE_KEY[notice], container)
    }

    // —— People section ——
    if (people.length > 0) {
      if (container.childElementCount > 0) separator(container)
      heading(t('docs.mention.groupMember'), container)
      for (const p of people) rows.push(richRow(p, container, 'person'))
    }

    // —— Document section ——
    if (docs.length > 0) {
      if (container.childElementCount > 0) separator(container)
      heading(t('docs.mention.groupDoc'), container)
      for (const d of docs) rows.push(richRow(d, container, 'doc'))
    }

    return rows
  }
}

/**
 * Should the popup render at all? Yes when there is any candidate, and ALSO when there are none but
 * the Bot section has a reason to state — otherwise a commenter would type `@`, see nothing, and
 * never learn that their role is what withholds the Bots.
 */
export function createMentionHasContent(getBotNotice: () => BotNotice | null) {
  return (items: MentionItem[]): boolean => items.length > 0 || getBotNotice() != null
}
