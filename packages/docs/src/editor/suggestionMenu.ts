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
  // Set once the popup is dismissed (Escape / outside click) so a later onUpdate in the same
  // suggestion session does not re-open it. Reset by onExit when the session truly ends (#624).
  let closed = false
  let onOutside: ((e: MouseEvent) => void) | null = null

  function paint() {
    if (!el) return
    el.innerHTML = ''
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

  /** Tear down the popup element and its outside-click listener. Safe to call repeatedly. */
  function destroy() {
    if (onOutside) {
      document.removeEventListener('mousedown', onOutside, true)
      onOutside = null
    }
    el?.remove()
    el = null
  }

  /** Mount the popup element (once) and wire the outside-click dismissal. */
  function mount() {
    if (el) return
    el = document.createElement('div')
    el.className = menuClass
    document.body.appendChild(el)
    onOutside = (e) => {
      if (el && (!(e.target instanceof Node) || !el.contains(e.target))) {
        closed = true
        destroy()
      }
    }
    // Capture phase so the dismissal runs before ProseMirror handles the click.
    document.addEventListener('mousedown', onOutside, true)
  }

  /**
   * Reflect the current items into the DOM: an empty list renders NO box (A), a non-empty list
   * (re)mounts and paints. Never runs once the popup has been dismissed for this session.
   */
  function sync(clientRect?: (() => DOMRect | null) | null) {
    if (closed) return
    if (items.length === 0) {
      destroy()
      return
    }
    mount()
    paint()
    position(clientRect?.())
  }

  return {
    onStart: (props) => {
      items = props.items
      selected = 0
      cmd = props.command
      closed = false
      sync(props.clientRect)
    },
    onUpdate: (props) => {
      items = props.items
      cmd = props.command
      selected = Math.min(selected, Math.max(0, items.length - 1))
      sync(props.clientRect)
    },
    onKeyDown: (props) => {
      const { key } = props.event
      if (key === 'Escape') {
        // Only claim the key when a popup is actually open, so Escape stays available to other
        // handlers (e.g. clearing a selection) when nothing is showing.
        if (!el) return false
        closed = true
        destroy()
        return true
      }
      if (!items.length || !el) return false
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
      return false
    },
    onExit: () => {
      closed = false
      destroy()
    },
  }
}
