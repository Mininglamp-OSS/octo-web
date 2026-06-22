import { useState, useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'

export interface OutlineItem {
  /** 1-based index in document order; also used as the heading's scroll anchor. */
  index: number
  level: number
  text: string
  /** ProseMirror document position of the heading node (for selection/scroll). */
  pos: number
}

/**
 * Extract the heading outline (H1–H6) from the editor document in order.
 * Pure over the editor's current state; exported for unit testing.
 */
export function collectOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = []
  let index = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      index += 1
      items.push({
        index,
        level: (node.attrs.level as number) ?? 1,
        text: node.textContent,
        pos,
      })
    }
    return true
  })
  return items
}

function useOutline(editor: Editor): OutlineItem[] {
  // Re-read the outline whenever the document or selection changes. The snapshot
  // is a cheap string fingerprint so React only re-renders when headings change.
  const fingerprint = useSyncExternalStore(
    (cb) => {
      editor.on('update', cb)
      editor.on('selectionUpdate', cb)
      return () => {
        editor.off('update', cb)
        editor.off('selectionUpdate', cb)
      }
    },
    () =>
      collectOutline(editor)
        .map((i) => `${i.level}:${i.text}`)
        .join('|'),
  )
  // fingerprint participates in the store contract; recompute items from it.
  void fingerprint
  return collectOutline(editor)
}

/** Left-side document outline / table of contents (frontend-design §3.1). Default collapsed. */
export function Outline({ editor }: { editor: Editor }) {
  const items = useOutline(editor)
  // #3: default COLLAPSED — the outline opens on demand via the slim title bar so it never
  // squeezes the body text on first paint.
  const [collapsed, setCollapsed] = useState(true)

  if (items.length === 0) {
    return (
      <aside
        className={collapsed ? 'octo-outline octo-outline-empty is-collapsed' : 'octo-outline octo-outline-empty'}
        aria-label="Document outline"
      >
        <button
          type="button"
          className="octo-outline-title"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          Outline
        </button>
        {!collapsed && <p className="octo-outline-hint">Add headings to build an outline.</p>}
      </aside>
    )
  }

  const goTo = (item: OutlineItem) => {
    // Move the selection just inside the heading and scroll it into view.
    editor.chain().focus().setTextSelection(item.pos + 1).run()
    const dom = editor.view.nodeDOM(item.pos) as HTMLElement | null
    dom?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <aside
      className={collapsed ? 'octo-outline is-collapsed' : 'octo-outline'}
      aria-label="Document outline"
    >
      <button
        type="button"
        className="octo-outline-title"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="octo-outline-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        Outline
      </button>
      {!collapsed && (
        <nav className="octo-outline-list">
          {items.map((item) => (
            <button
              key={`${item.index}-${item.pos}`}
              type="button"
              className={`octo-outline-item octo-outline-l${item.level}`}
              onClick={() => goTo(item)}
              title={item.text || '(empty heading)'}
            >
              {item.text || '(empty heading)'}
            </button>
          ))}
        </nav>
      )}
    </aside>
  )
}
