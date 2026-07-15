// Docs formula parity with the sheet:
//   ① per-formula font size + colour (fontSize/color attrs applied by the NodeView).
//   ② in-place editing — click a formula and it turns into an editable MathLive field; you type/erase
//      like text (physical keyboard only, the virtual keyboard is killed), and on blur it saves the
//      LaTeX back and re-renders. Same "interact with the formula to edit it" model as the sheet, so
//      no pencil/modal button is needed.
//
// We extend @tiptap/extension-mathematics' InlineMath/BlockMath (keeping their `$…$` / `$$…$$` input
// rules + insert/update/delete commands) with the two attrs and a dual-mode NodeView: KaTeX for
// display (export/collab untouched — only the stored `latex` matters), MathLive for editing.

import { InlineMath, BlockMath } from '@tiptap/extension-mathematics'
import type { KatexOptions } from 'katex'
import katex from 'katex'
import { MathfieldElement } from 'mathlive'
import type { Editor } from '@tiptap/core'

/** Normalise a stored font size to a CSS length: a bare number → px, otherwise used verbatim. */
function toCssSize(v: string | null | undefined): string {
  if (!v) return ''
  return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v
}

/** Kill MathLive's on-screen virtual keyboard for the docs editor (physical keyboard only), mirroring
 * the sheet. Idempotent — one <style> refreshed on each call. */
const KB_KILL_ID = 'octo-docs-mathlive-kb-kill'
function installMathKeyboardKill(): void {
  if (typeof document === 'undefined') return
  try {
    ;(MathfieldElement as unknown as { mathVirtualKeyboardPolicy?: string }).mathVirtualKeyboardPolicy = 'manual'
  } catch {
    /* ignore */
  }
  if (document.getElementById(KB_KILL_ID)) return
  const style = document.createElement('style')
  style.id = KB_KILL_ID
  style.textContent = `
    .ML__keyboard, .ML__keyboard--visible, .MLK__backdrop, .MLK__plate, [class^="MLK__"] {
      display: none !important; visibility: hidden !important;
    }
    math-field::part(virtual-keyboard-toggle), math-field::part(menu-toggle) { display: none !important; }
  `
  document.head.appendChild(style)
}

/** Minimal shape of the ProseMirror node the NodeView needs (type name + attrs). */
type MathNodeLike = { type?: { name: string }; attrs: Record<string, unknown> }

/** Build a dual-mode NodeView: KaTeX display + click-to-edit MathLive field. */
function makeMathNodeView(katexOptions: KatexOptions | undefined, kind: 'inline' | 'block') {
  return (props: { node: MathNodeLike; getPos?: () => number | undefined; editor: Editor }) => {
    installMathKeyboardKill()
    const { editor } = props
    let current: MathNodeLike = props.node
    let editing = false
    let mf: MathfieldElement | null = null
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    const wrapper = document.createElement(kind === 'inline' ? 'span' : 'div')
    const inner = document.createElement(kind === 'inline' ? 'span' : 'div')
    wrapper.className = `tiptap-mathematics-render octo-math-render octo-math-render--${kind}`
    inner.className = 'octo-math-inner'
    wrapper.appendChild(inner)

    const applyStyle = () => {
      const fs = toCssSize(current.attrs.fontSize as string | null)
      const color = (current.attrs.color as string | null) || ''
      wrapper.style.fontSize = fs
      wrapper.style.color = color
      // Keep the live editable field in sync when size/colour change mid-edit.
      if (mf) {
        mf.style.fontSize = fs || '20px'
        mf.style.color = color || 'inherit'
      }
    }

    const renderKatex = () => {
      const latex = String(current.attrs.latex ?? '')
      try {
        katex.render(latex, inner, { ...(katexOptions ?? {}), displayMode: kind === 'block' })
        wrapper.classList.remove('octo-math-error')
      } catch {
        inner.textContent = latex
        wrapper.classList.add('octo-math-error')
      }
      applyStyle()
      wrapper.setAttribute('data-latex', latex)
    }

    // Push the latex the user is typing back into the node (debounced → one Yjs update per pause,
    // not per keystroke). setNodeMarkup keeps the node in place; `mathInlineEdit` meta tells update()
    // this change is our own so it must NOT re-render over the live field.
    const save = (latex: string) => {
      // Guard against dispatching into a torn-down view (e.g. flush-on-destroy, or a save landing
      // after the editor was destroyed) — dispatch would otherwise no-op/throw.
      if (editor.isDestroyed) return
      const pos = props.getPos?.()
      if (typeof pos !== 'number') return
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, latex })
      tr.setMeta('mathInlineEdit', true)
      editor.view.dispatch(tr)
    }

    const exitEdit = () => {
      if (!editing) return
      if (saveTimer) clearTimeout(saveTimer)
      if (mf) {
        save(mf.value)
        mf.removeEventListener('input', onInput)
        mf.removeEventListener('blur', exitEdit)
      }
      editing = false
      mf = null
      renderKatex()
    }

    function onInput() {
      if (!mf) return
      const latex = mf.value
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => save(latex), 300)
    }

    const enterEdit = () => {
      if (editing || !editor.isEditable) return
      editing = true
      inner.replaceChildren()
      mf = new MathfieldElement()
      try {
        ;(mf as unknown as { mathVirtualKeyboardPolicy?: string }).mathVirtualKeyboardPolicy = 'manual'
      } catch {
        /* ignore */
      }
      mf.value = String(current.attrs.latex ?? '')
      const size = toCssSize(current.attrs.fontSize as string | null) || '20px'
      mf.style.cssText = `font-size:${size};border:none;background:transparent;color:${(current.attrs.color as string | null) || 'inherit'};`
      inner.appendChild(mf)
      mf.addEventListener('input', onInput)
      mf.addEventListener('blur', exitEdit)
      requestAnimationFrame(() => mf?.focus())
    }

    // Click a formula to edit it in place (like the sheet). The size/colour bubble buttons update the
    // node WITHOUT touching focus or the selection (see MathBubbleMenu), so they don't kick the field
    // out of edit mode — editing and adjusting coexist.
    wrapper.addEventListener('click', () => {
      if (editor.isEditable && !editing) enterEdit()
    })

    renderKatex()

    return {
      dom: wrapper,
      update: (updated: MathNodeLike) => {
        if (updated.type?.name !== current.type?.name) return false
        current = updated
        if (editing) {
          // Don't clobber the live field; just keep size/colour in sync.
          applyStyle()
        } else {
          renderKatex()
        }
        return true
      },
      // While editing, MathLive owns keyboard/mouse and its own DOM — keep ProseMirror out.
      stopEvent: () => editing,
      ignoreMutation: () => editing,
      destroy: () => {
        // Flush any pending debounced edit BEFORE tearing down — otherwise clearing the timer and
        // removing the blur listener (the only other flush trigger) silently drops the last keystrokes
        // when the NodeView is destroyed mid-edit (navigate away / doc close / remote node replace).
        if (saveTimer) clearTimeout(saveTimer)
        if (editing && mf) save(mf.value)
        if (mf) {
          mf.removeEventListener('input', onInput)
          mf.removeEventListener('blur', exitEdit)
        }
      },
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

/** InlineMath with fontSize/colour + a dual-mode (KaTeX display / MathLive edit) NodeView. */
export const InlineMathStyled = InlineMath.extend({
  addAttributes() {
    return { ...this.parent?.(), ...SIZE_COLOR_ATTRS }
  },
  addNodeView() {
    return makeMathNodeView(this.options.katexOptions as KatexOptions | undefined, 'inline')
  },
})

/** BlockMath with fontSize/colour + a dual-mode (KaTeX display / MathLive edit) NodeView. */
export const BlockMathStyled = BlockMath.extend({
  addAttributes() {
    return { ...this.parent?.(), ...SIZE_COLOR_ATTRS }
  },
  addNodeView() {
    return makeMathNodeView(this.options.katexOptions as KatexOptions | undefined, 'block')
  },
})
