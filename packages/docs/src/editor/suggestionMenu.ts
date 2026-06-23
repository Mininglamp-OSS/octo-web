// Shared, dependency-free suggestion-menu renderer (frontend-design §3.4).
//
// Used by the @-mention (editor/mention.ts) and :-emoji (editor/emoji.ts) suggestions.
// Mirrors the keyboard-navigable popup built inline for the slash command (SlashCommand.ts)
// but generic over the item type: the caller supplies how to paint each row's text. Kept
// free of tippy/floating-ui so it runs headless-friendly in jsdom tests.

export interface SuggestionMenuProps<T> {
  items: T[]
  command: (item: T) => void
  clientRect?: (() => DOMRect | null) | null
}

export interface SuggestionMenuRenderer<T> {
  onStart: (props: SuggestionMenuProps<T>) => void
  onUpdate: (props: SuggestionMenuProps<T>) => void
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
  onExit: () => void
}

/**
 * Build a popup renderer. `renderItem` returns the visible row text for an item (e.g. a member
 * name or `:shortcode:`). `menuClass` lets callers theme the container (mention vs emoji).
 */
export function createSuggestionMenuRenderer<T>(
  renderItem: (item: T) => string,
  menuClass = 'octo-suggest-menu',
): SuggestionMenuRenderer<T> {
  let el: HTMLDivElement | null = null
  let items: T[] = []
  let selected = 0
  let cmd: ((item: T) => void) | null = null

  function paint() {
    if (!el) return
    el.innerHTML = ''
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'octo-suggest-empty'
      empty.textContent = '—'
      el.appendChild(empty)
      return
    }
    items.forEach((item, idx) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'octo-suggest-item' + (idx === selected ? ' is-selected' : '')
      row.textContent = renderItem(item)
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        cmd?.(item)
      })
      el!.appendChild(row)
    })
  }

  function position(rect: DOMRect | null | undefined) {
    if (!el || !rect) return
    el.style.position = 'absolute'
    el.style.left = `${rect.left}px`
    el.style.top = `${rect.bottom + 4}px`
  }

  return {
    onStart: (props) => {
      items = props.items
      selected = 0
      cmd = props.command
      el = document.createElement('div')
      el.className = menuClass
      document.body.appendChild(el)
      paint()
      position(props.clientRect?.())
    },
    onUpdate: (props) => {
      items = props.items
      cmd = props.command
      selected = Math.min(selected, Math.max(0, items.length - 1))
      paint()
      position(props.clientRect?.())
    },
    onKeyDown: (props) => {
      if (!items.length) return false
      const { key } = props.event
      if (key === 'ArrowDown') {
        selected = (selected + 1) % items.length
        paint()
        return true
      }
      if (key === 'ArrowUp') {
        selected = (selected - 1 + items.length) % items.length
        paint()
        return true
      }
      if (key === 'Enter') {
        cmd?.(items[selected])
        return true
      }
      if (key === 'Escape') {
        return true
      }
      return false
    },
    onExit: () => {
      el?.remove()
      el = null
    },
  }
}
