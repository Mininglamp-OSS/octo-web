// Serialize between the comment REST body (a plain string carrying `@[type:id:label]` mention
// tokens — see mentions/source.ts) and a tiptap document, so the rich comment composer
// (MentionComposer) can edit mentions as real chips while the stored/rendered format stays exactly
// what MentionText already renders and octo-docs-backend already parses. Backward compatible: old
// comments (plain text, or text with tokens) round-trip unchanged.

import { type MentionItem, serializeMention, splitMentionText } from './source.ts'

/** Minimal tiptap JSON shapes we produce/consume (kept local to avoid tiptap type coupling). */
export interface JSONNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  content?: JSONNode[]
}

/** Body string → tiptap doc JSON: one paragraph per line; mention tokens become mention nodes. */
export function bodyToDoc(body: string): JSONNode {
  const lines = (body ?? '').split('\n')
  const content: JSONNode[] = lines.map((line) => {
    const nodes: JSONNode[] = []
    for (const seg of splitMentionText(line)) {
      if ('text' in seg) {
        if (seg.text) nodes.push({ type: 'text', text: seg.text })
      } else {
        const m = seg.mention
        nodes.push({ type: 'mention', attrs: { id: m.id, label: m.label, type: m.type } })
      }
    }
    return nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' }
  })
  return { type: 'doc', content }
}

/** tiptap doc JSON → body string: paragraphs joined by \n; mention nodes become tokens. */
export function docToBody(doc: JSONNode | null | undefined): string {
  if (!doc?.content) return ''
  const lineOf = (para: JSONNode): string => {
    if (!para.content) return ''
    let out = ''
    for (const node of para.content) {
      if (node.type === 'text') out += node.text ?? ''
      else if (node.type === 'mention') {
        const a = node.attrs ?? {}
        const item: MentionItem = {
          id: String(a.id ?? ''),
          label: String(a.label ?? a.id ?? ''),
          type: a.type === 'doc' ? 'doc' : 'user',
        }
        out += serializeMention(item)
      } else if (node.type === 'hardBreak') out += '\n'
    }
    return out
  }
  return doc.content.map(lineOf).join('\n')
}
