// Tests for the shared mention token contract (mentions/source.ts). These lock the plain-text
// token format that comment bodies + sheet comments persist, and that octo-docs-backend will
// parse to resolve docs-notify recipients (#584) — so the round-trip must stay stable.

import { describe, it, expect } from 'vitest'
import {
  type MentionItem,
  serializeMention,
  extractMentions,
  splitMentionText,
  filterMentionItems,
  MENTION_TOKEN_RE,
} from './source.ts'

const user = (id: string, label: string): MentionItem => ({ id, label, type: 'user' })
const doc = (id: string, label: string): MentionItem => ({ id, label, type: 'doc' })

describe('serializeMention', () => {
  it('emits @[type:id:label] for users and docs', () => {
    expect(serializeMention(user('u_1', 'Alice'))).toBe('@[user:u_1:Alice]')
    expect(serializeMention(doc('d_9', 'Plan'))).toBe('@[doc:d_9:Plan]')
  })

  it('strips `]` from the label so it cannot terminate the token early', () => {
    expect(serializeMention(user('u_2', 'Bob] hacker'))).toBe('@[user:u_2:Bob hacker]')
  })

  it('falls back to the id when the label sanitises to empty', () => {
    expect(serializeMention(user('u_3', ']]]'))).toBe('@[user:u_3:u_3]')
  })

  it('keeps a `:` inside the label (label is the last, greedy field)', () => {
    const token = serializeMention(user('u_4', 'A: note'))
    expect(token).toBe('@[user:u_4:A: note]')
    expect(extractMentions(token)).toEqual([user('u_4', 'A: note')])
  })
})

describe('extractMentions', () => {
  it('pulls every mention out of a body, de-duped by type+id in order', () => {
    const body = 'hi @[user:u_1:Alice] and @[doc:d_9:Plan], cc @[user:u_1:Alice] again'
    expect(extractMentions(body)).toEqual([user('u_1', 'Alice'), doc('d_9', 'Plan')])
  })

  it('returns [] when there are no tokens', () => {
    expect(extractMentions('just plain text')).toEqual([])
  })
})

describe('splitMentionText', () => {
  it('interleaves plain runs and mention tokens preserving order', () => {
    const body = 'hey @[user:u_1:Alice]!'
    expect(splitMentionText(body)).toEqual([
      { text: 'hey ' },
      { mention: user('u_1', 'Alice') },
      { text: '!' },
    ])
  })

  it('handles a body that is only a mention', () => {
    expect(splitMentionText('@[doc:d_1:X]')).toEqual([{ mention: doc('d_1', 'X') }])
  })
})

describe('filterMentionItems', () => {
  const all: MentionItem[] = [user('u_1', 'Alice'), user('u_2', 'Bob'), doc('d_1', 'Alpha')]

  it('matches label case-insensitively', () => {
    expect(filterMentionItems(all, 'al')).toEqual([user('u_1', 'Alice'), doc('d_1', 'Alpha')])
    expect(filterMentionItems(all, 'ali')).toEqual([user('u_1', 'Alice')])
  })

  it('returns all when the query is empty', () => {
    expect(filterMentionItems(all, '')).toHaveLength(3)
  })
})

it('MENTION_TOKEN_RE is stateful (global) — reset lastIndex between manual uses', () => {
  // Guard against accidental shared-regex bugs: matchAll (used internally) is safe, but a
  // bare .test/.exec loop would need lastIndex reset. Document the flag here.
  expect(MENTION_TOKEN_RE.global).toBe(true)
})

