// The @-mention candidate panel body (mentions/mentionMenu.ts).
//
// These pin the PRODUCT rules the prototype's design encodes, i.e. the things a redesign must not
// quietly drop: candidates are GROUPED by kind; a Bot states what it does and why you may use it; an
// offline Bot is visible but genuinely unpickable; and an empty Bot section carries a REASON instead
// of a bare heading. The keyboard / dismissal behaviour lives in createSuggestionMenuRenderer and is
// covered by suggestionMenu.test.ts — not re-tested here.
//
// `t` is the identity mock (src/__mocks__/octoBase.ts), so assertions use literal i18n keys.

import { describe, it, expect, beforeEach } from 'vitest'
import type { BotNotice } from './botCandidates.ts'
import { createMentionRowsRenderer, createMentionHasContent } from './mentionMenu.ts'
import type { MentionItem } from './source.ts'

const person = (id: string, label: string): MentionItem => ({ id, label, type: 'user' })
const doc = (id: string, label: string): MentionItem => ({ id, label, type: 'doc' })
const bot = (over: Partial<MentionItem> = {}): MentionItem => ({
  id: 'b1',
  label: 'Lobster',
  type: 'user',
  isBot: true,
  botDescription: '通用文档修改',
  botRelation: 'creator',
  ...over,
})

let host: HTMLElement

/** Paint the body into a detached container and hand back both the rows and the container. */
function paint(items: MentionItem[], notice: BotNotice | null = null) {
  host = document.createElement('div')
  const rows = createMentionRowsRenderer(() => notice)(items, host)
  return { rows, host }
}

const texts = (sel: string) => [...host.querySelectorAll(sel)].map((e) => e.textContent)

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('mention panel — grouping', () => {
  it('renders a heading per non-empty section, in the order Bot → 成员 → 文档', () => {
    paint([bot(), person('u1', '王敏'), doc('d1', '方案')])
    expect(texts('.octo-mention-group')).toEqual([
      'docs.mention.groupBot',
      'docs.mention.groupMember',
      'docs.mention.groupDoc',
    ])
  })

  it('omits a section entirely when it has no candidates', () => {
    paint([person('u1', '王敏')])
    expect(texts('.octo-mention-group')).toEqual(['docs.mention.groupMember'])
  })

  it('separates adjacent sections but never leads with a separator', () => {
    paint([bot(), person('u1', '王敏'), doc('d1', '方案')])
    // Two joins between three sections.
    expect(host.querySelectorAll('.octo-mention-sep').length).toBe(2)
    expect(host.firstElementChild?.className).toBe('octo-mention-group')
  })

  it('returns every selectable row, in visual order, and no decorative node', () => {
    const { rows } = paint([bot(), person('u1', '王敏'), doc('d1', '方案')])
    expect(rows.map((r) => r.item.label)).toEqual(['Lobster', '王敏', '方案'])
    expect(rows.every((r) => r.el.tagName === 'BUTTON')).toBe(true)
  })

  it('tags each row with its kind so styling/tests can tell them apart', () => {
    paint([bot(), person('u1', '王敏'), doc('d1', '方案')])
    expect([...host.querySelectorAll('.octo-mention-option')].map((e) => (e as HTMLElement).dataset.kind))
      .toEqual(['agent', 'person', 'doc'])
  })
})

describe('mention panel — Bot row content', () => {
  it('shows "<description> · <relation>" under the name', () => {
    paint([bot()])
    expect(host.querySelector('.octo-mention-meta small')?.textContent).toBe(
      '通用文档修改 · docs.mention.botRelationCreator',
    )
  })

  it('labels a friend-shared Bot with the friend relation', () => {
    paint([bot({ botRelation: 'friend' })])
    expect(host.querySelector('.octo-mention-meta small')?.textContent).toContain(
      'docs.mention.botRelationFriend',
    )
  })

  it('never leaves a dangling " · " when the host sent no description', () => {
    paint([bot({ botDescription: undefined })])
    const sub = host.querySelector('.octo-mention-meta small')?.textContent ?? ''
    expect(sub).toBe('docs.mention.botRelationCreator')
    expect(sub.startsWith(' · ')).toBe(false)
  })

  it('carries a Bot pill and an SVG glyph — not emoji, not a text tag', () => {
    paint([bot()])
    expect(host.querySelector('.octo-mention-badge')?.textContent).toBe('docs.mention.botBadge')
    expect(host.querySelector('.octo-mention-avatar svg.octo-bot-glyph')).toBeTruthy()
    expect(host.textContent).not.toContain('🤖')
    expect(host.textContent).not.toContain('· AI')
  })
})

describe('mention panel — offline Bot', () => {
  it('is rendered, flagged disabled to the keyboard, AND disabled in the DOM', () => {
    const { rows } = paint([bot({ botOffline: true })])
    expect(rows).toHaveLength(1)
    expect(rows[0].disabled).toBe(true)
    expect((rows[0].el as HTMLButtonElement).disabled).toBe(true)
    expect(rows[0].el.classList.contains('is-disabled')).toBe(true)
  })

  it('says WHY it is unpickable, so a greyed row does not read as a rendering bug', () => {
    paint([bot({ botOffline: true })])
    expect(host.querySelector('.octo-mention-meta small')?.textContent).toContain(
      'docs.mention.botOffline',
    )
  })

  it('leaves an online Bot selectable', () => {
    const { rows } = paint([bot()])
    expect(rows[0].disabled).toBeUndefined()
    expect((rows[0].el as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('mention panel — empty Bot section', () => {
  const cases: Array<[BotNotice, string]> = [
    ['no-permission', 'docs.mention.botNoPermission'],
    ['none-available', 'docs.mention.botNoneAvailable'],
    ['none-with-doc-access', 'docs.mention.botNoneWithDocAccess'],
    ['permission-unknown', 'docs.mention.botPermissionUnknown'],
  ]

  it.each(cases)('renders the reason line for %s', (notice, key) => {
    paint([person('u1', '王敏')], notice)
    expect(host.querySelector('.octo-mention-empty')?.textContent).toBe(key)
  })

  it('replaces the whole section — no heading is left standing over nothing', () => {
    paint([person('u1', '王敏')], 'no-permission')
    expect(texts('.octo-mention-group')).toEqual(['docs.mention.groupMember'])
    expect(texts('.octo-mention-group')).not.toContain('docs.mention.groupBot')
  })

  it('contributes NO selectable row (arrow keys must not land on the notice)', () => {
    const { rows } = paint([], 'no-permission')
    expect(rows).toEqual([])
  })

  it('shows the Bot section and no notice once a Bot is actually available', () => {
    paint([bot()], null)
    expect(host.querySelector('.octo-mention-empty')).toBeNull()
    expect(texts('.octo-mention-group')).toContain('docs.mention.groupBot')
  })

  it('never renders a Bot row for a caller who may not @Bot', () => {
    // The source is what withholds the candidates; the panel must not resurrect them.
    const { rows } = paint([person('u1', '王敏')], 'no-permission')
    expect(rows.some((r) => r.item.isBot)).toBe(false)
    expect(host.querySelector('.octo-mention-option[data-kind="agent"]')).toBeNull()
  })
})

describe('mention panel — hasContent', () => {
  it('opens the popup when there are candidates', () => {
    expect(createMentionHasContent(() => null)([person('u1', '王敏')])).toBe(true)
  })

  it('opens the popup with ZERO candidates when there is a reason to state', () => {
    // Otherwise a commenter types @, sees nothing, and never learns their role is the reason.
    expect(createMentionHasContent(() => 'no-permission')([])).toBe(true)
  })

  it('stays closed when there is nothing to show and nothing to say', () => {
    expect(createMentionHasContent(() => null)([])).toBe(false)
  })

  it('reads the notice through the thunk, so a late async settle still opens it', () => {
    let notice: BotNotice | null = null
    const has = createMentionHasContent(() => notice)
    expect(has([])).toBe(false)
    notice = 'none-available' // the source load settles after the first paint
    expect(has([])).toBe(true)
  })
})

describe('mention panel — person / doc rows', () => {
  it('gives a person an initial-letter circle and an @-prefixed name', () => {
    paint([person('u1', '王敏')])
    const avatar = host.querySelector('.octo-mention-avatar.is-person')
    expect(avatar?.textContent).toBe('王')
    expect(host.querySelector('.octo-mention-meta strong')?.textContent).toBe('@王敏')
  })

  it('gives a document a file glyph and its bare title', () => {
    paint([doc('d1', '方案')])
    expect(host.querySelector('.octo-mention-avatar.is-doc svg.octo-doc-glyph')).toBeTruthy()
    expect(host.querySelector('.octo-mention-meta strong')?.textContent).toBe('方案')
    expect(host.textContent).not.toContain('📄')
  })

  it('keeps an avatar tint stable for the same uid across repaints', () => {
    paint([person('u_zhang', '张三')])
    const first = host.querySelector('.octo-mention-avatar')?.className
    paint([person('u_zhang', '张三')])
    expect(host.querySelector('.octo-mention-avatar')?.className).toBe(first)
  })

  it('does not split an astral-plane initial into a broken surrogate half', () => {
    paint([person('u2', '𠮷野家')])
    expect(host.querySelector('.octo-mention-avatar')?.textContent).toBe('𠮷')
  })
})
