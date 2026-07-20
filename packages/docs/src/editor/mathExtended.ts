// Docs formula parity with the sheet:
//   ① per-formula font size + colour (fontSize/color attrs applied by the NodeView).
//   ② edit by DOUBLE-CLICK — a double-click dispatches `octo-math-edit` (with the node pos) which the
//      MathBubbleMenu catches to open the LaTeX editor (symbol palette + live preview, centered).
//
// We keep KaTeX for display (export/collab untouched — only the stored `latex` matters) and apply the
// fontSize/colour attrs to the rendered wrapper. Editing is NOT an in-place MathLive swap: that broke
// block-formula centring and fought the size/colour bubble for focus, so a double-click opens the
// reliable modal editor instead. We extend @tiptap/extension-mathematics' InlineMath/BlockMath
// (keeping their `$…$` / `$$…$$` input rules + insert/update/delete commands) with the two attrs.

import { InlineMath, BlockMath } from '@tiptap/extension-mathematics'
import type { Editor } from '@tiptap/core'
import type { KatexOptions } from 'katex'
import katex from 'katex'

/** Normalise a stored font size to a CSS length: a bare number → px, otherwise used verbatim. */
function toCssSize(v: string | null | undefined): string {
  if (!v) return ''
  return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v
}

/** Minimal shape of the ProseMirror node the NodeView needs (type name + attrs). */
type MathNodeLike = { type?: { name: string }; attrs: Record<string, unknown> }

/** Build a NodeView: KaTeX display + fontSize/colour styling + double-click-to-edit (dispatches
 * `octo-math-edit` with the node pos, which the MathBubbleMenu turns into the LaTeX editor modal). */
function makeMathNodeView(katexOptions: KatexOptions | undefined, kind: 'inline' | 'block') {
  return (props: { node: MathNodeLike; getPos?: () => number | undefined; editor: Editor }) => {
    let current: MathNodeLike = props.node
    const wrapper = document.createElement(kind === 'inline' ? 'span' : 'div')
    const inner = document.createElement(kind === 'inline' ? 'span' : 'div')
    wrapper.className = `tiptap-mathematics-render octo-math-render octo-math-render--${kind}`
    inner.className = 'octo-math-inner'
    wrapper.appendChild(inner)

    const render = () => {
      const latex = String(current.attrs.latex ?? '')
      try {
        katex.render(latex, inner, { ...(katexOptions ?? {}), displayMode: kind === 'block' })
        wrapper.classList.remove('octo-math-error')
      } catch {
        inner.textContent = latex
        wrapper.classList.add('octo-math-error')
      }
      wrapper.style.fontSize = toCssSize(current.attrs.fontSize as string | null)
      wrapper.style.color = (current.attrs.color as string | null) || ''
      wrapper.setAttribute('data-latex', latex)
    }
    render()

    const onDblClick = (e: Event) => {
      // Read-only guard: never open the editor path in a non-editable document. The bubble's
      // shouldShow already gates on isEditable, but the double-click dispatch must be gated too,
      // otherwise a read-only doc could still open (and confirm) the LaTeX edit modal.
      if (!props.editor.isEditable) return
      e.preventDefault()
      e.stopPropagation()
      const pos = props.getPos?.()
      if (typeof pos !== 'number') return
      wrapper.dispatchEvent(new CustomEvent('octo-math-edit', { bubbles: true, detail: { pos } }))
    }
    wrapper.addEventListener('dblclick', onDblClick)

    return {
      dom: wrapper,
      update: (updated: MathNodeLike) => {
        if (updated.type?.name !== current.type?.name) return false
        current = updated
        render()
        return true
      },
      destroy: () => wrapper.removeEventListener('dblclick', onDblClick),
    }
  }
}

/** The fontSize + colour attributes, serialised to data-* so they round-trip through Yjs and the
 * HTML/DOCX/Markdown exporters (the exporters key off `data-latex`; these ride alongside it). */
const SIZE_COLOR_ATTRS = {
  fontSize: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-font-size'),
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.fontSize ? { 'data-font-size': attrs.fontSize as string } : {},
  },
  color: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-color'),
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.color ? { 'data-color': attrs.color as string } : {},
  },
}

/** InlineMath with fontSize/colour + a KaTeX NodeView (double-click opens the editor). */
export const InlineMathStyled = InlineMath.extend({
  addAttributes() {
    return { ...this.parent?.(), ...SIZE_COLOR_ATTRS }
  },
  addNodeView() {
    return makeMathNodeView(this.options.katexOptions as KatexOptions | undefined, 'inline')
  },
})

/** BlockMath with fontSize/colour + a KaTeX NodeView (double-click opens the editor). */
export const BlockMathStyled = BlockMath.extend({
  addAttributes() {
    return { ...this.parent?.(), ...SIZE_COLOR_ATTRS }
  },
  addNodeView() {
    return makeMathNodeView(this.options.katexOptions as KatexOptions | undefined, 'block')
  },
})
