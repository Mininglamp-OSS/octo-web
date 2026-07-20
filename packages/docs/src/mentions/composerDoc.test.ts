import { describe, it, expect } from 'vitest'
import { bodyToDoc, docToBody } from './composerDoc.ts'

describe('bodyToDoc', () => {
  it('turns mention tokens into mention nodes, text into text nodes', () => {
    expect(bodyToDoc('hi @[user:u_1:Alice]!')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'mention', attrs: { id: 'u_1', label: 'Alice', type: 'user' } },
            { type: 'text', text: '!' },
          ],
        },
      ],
    })
  })

  it('maps each line to a paragraph; empty line → empty paragraph', () => {
    const doc = bodyToDoc('a\n\nb')
    expect(doc.content?.map((p) => p.content?.[0]?.text ?? null)).toEqual(['a', null, 'b'])
  })

  it('handles a body that is only a mention', () => {
    expect(bodyToDoc('@[doc:d_1:Plan]').content?.[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'mention', attrs: { id: 'd_1', label: 'Plan', type: 'doc' } }],
    })
  })
})

describe('docToBody', () => {
  it('serializes mention nodes back to tokens', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hey ' },
            { type: 'mention', attrs: { id: 'u_1', label: 'Alice', type: 'user' } },
          ],
        },
      ],
    }
    expect(docToBody(doc)).toBe('hey @[user:u_1:Alice]')
  })

  it('joins paragraphs with newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    }
    expect(docToBody(doc)).toBe('a\nb')
  })

  it('round-trips a body through doc and back', () => {
    const body = 'ping @[user:u_9:Bob] see @[doc:d_2:Spec]\nline two'
    expect(docToBody(bodyToDoc(body))).toBe(body)
  })

  it('returns empty string for an empty doc', () => {
    expect(docToBody({ type: 'doc', content: [] })).toBe('')
    expect(docToBody(null)).toBe('')
  })
})
