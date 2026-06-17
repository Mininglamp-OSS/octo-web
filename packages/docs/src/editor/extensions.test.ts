import { describe, it, expect } from 'vitest'
import { createDocsLowlight } from './extensions.ts'

// Code-block syntax highlighting (P1a). The editor registers CodeBlockLowlight
// with a lowlight instance built from highlight.js' `common` language set, while
// StarterKit's plain codeBlock is disabled to avoid a duplicate same-name node.
// These assertions guard that the registry actually carries the common grammars
// used in code blocks (otherwise highlighting silently falls back to plain text).
describe('docs lowlight registry (code-block syntax highlighting)', () => {
  it('registers the common programming languages', () => {
    const lowlight = createDocsLowlight()
    const langs = lowlight.listLanguages()
    for (const lang of ['javascript', 'typescript', 'python', 'json', 'bash', 'css']) {
      expect(langs).toContain(lang)
    }
  })

  it('highlights a known language into hljs token nodes', () => {
    const lowlight = createDocsLowlight()
    const tree = lowlight.highlight('javascript', 'const x = 1')
    // The highlighted tree should contain at least one hljs-* token element.
    const hasToken = JSON.stringify(tree).includes('hljs-')
    expect(hasToken).toBe(true)
  })

  it('reports unregistered languages as not registered (extension falls back to plain text)', () => {
    const lowlight = createDocsLowlight()
    // CodeBlockLowlight guards on registered() before highlighting, so an unknown
    // language degrades to plain text rather than highlighting.
    expect(lowlight.registered('not-a-real-language')).toBe(false)
    expect(lowlight.registered('javascript')).toBe(true)
  })
})
