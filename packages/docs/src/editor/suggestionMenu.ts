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
 * One rendered, SELECTABLE row. A custom body builder returns these in visual order; purely
 * decorative nodes it also appends (group headings, separators, empty-state notices) are simply
 * left out of the returned array, so keyboard navigation never lands on them.
 */
export interface SuggestionRow<T> {
  el: HTMLElement
  item: T
  /** Rendered but not choosable (e.g. an offline Bot). Skipped by arrow keys and never clickable. */
  disabled?: boolean
}

export interface SuggestionMenuOptions<T> {
  /**
   * Build the popup body into `container` and return the selectable rows. Use this when the popup
   * is more than a flat list of identical rows (grouped sections, rich rows, empty-state notices).
   * Omitted → one `.octo-suggest-item` per item painted with `renderItem` (unchanged behaviour).
   */
  renderRows?: (items: T[], container: HTMLElement) => SuggestionRow<T>[]
  /**
   * Should the popup be shown at all for this item list? Defaults to "only when non-empty".
   * Override when the popup has something to say with ZERO items — e.g. the mention menu's
   * "your role cannot @Bot" notice, which must appear even though no candidate matched.
   */
  hasContent?: (items: T[]) => boolean
}

/**
 * Build a popup renderer. `renderItem` returns the visible row text for an item (e.g. a member
 * name or `:shortcode:`). `menuClass` lets callers theme the container (mention vs emoji).
 * `opts` lets a caller take over the body markup while REUSING all the keyboard, outside-click,
 * positioning and teardown behaviour here — that logic must exist exactly once.
 */
export function createSuggestionMenuRenderer<T>(
  renderItem: (item: T) => string,
  menuClass = 'octo-suggest-menu',
  opts: SuggestionMenuOptions<T> = {},
): SuggestionMenuRenderer<T> {
  let el: HTMLDivElement | null = null
  let items: T[] = []
  /** Index into `rows` (NOT `items`) — a custom body may render fewer rows than there are items. */
  let selected = 0
  let rows: SuggestionRow<T>[] = []
  let cmd: ((item: T) => void) | null = null
  // Set once the popup is dismissed (Escape / outside click) so a later onUpdate in the same
  // suggestion session does not re-open it. Reset by onExit when the session truly ends (#624).
  let closed = false
  let onOutside: ((e: MouseEvent) => void) | null = null

  const hasContent = opts.hasContent ?? ((list: T[]) => list.length > 0)

  /** Default body: one flat text row per item — the original rendering. */
  function defaultRows(list: T[], container: HTMLElement): SuggestionRow<T>[] {
    return list.map((item) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'octo-suggest-item'
      row.textContent = renderItem(item)
      container.appendChild(row)
      return { el: row, item }
    })
  }

  /** Next selectable row index from `from` moving `dir`, wrapping; -1 when none is selectable. */
  function nextEnabled(from: number, dir: 1 | -1): number {
    if (rows.length === 0) return -1
    for (let step = 1; step <= rows.length; step++) {
      const i = (((from + dir * step) % rows.length) + rows.length) % rows.length
      if (!rows[i].disabled) return i
    }
    return -1
  }

  function paint() {
    if (!el) return
    el.innerHTML = ''
    rows = (opts.renderRows ?? defaultRows)(items, el)
    // Keep the highlight on a real, selectable row across re-paints (filtering changes the list).
    if (selected < 0 || selected >= rows.length || rows[selected]?.disabled) {
      selected = nextEnabled(-1, 1)
    }
    rows.forEach((row, idx) => {
      if (row.disabled) return
      if (idx === selected) row.el.classList.add('is-selected')
      row.el.addEventListener('mousedown', (e) => {
        e.preventDefault()
        cmd?.(row.item)
      })
    })
  }


  /**
   * 把弹层贴到光标处。**默认往上弹**,放不下才往下。
   *
   * 为什么默认朝上:评论输入框几乎总是钉在面板底部(文档抽屉、表格侧栏、HTML 侧栏都是),
   * 往下弹会直接超出视口下沿 —— 用户看到的是一个被截断、且盖住「发送」区的菜单。
   * 往上弹则朝着列表方向展开,那边总有空间。
   *
   * 仍然做双向判断而不是写死朝上:输入框万一在页面顶部(窄屏下面板折叠),朝上就没地方了。
   * 量的是**实际高度**(offsetHeight),所以调用方必须先把元素插入 DOM 再调这里。
   */
  function position(rect: DOMRect | null | undefined) {
    if (!el || !rect) return
    el.style.position = 'absolute'
    el.style.left = `${rect.left}px`

    const GAP = 4
    // 量实际高度:调用方已经把元素 appendChild 过了,这里读 offsetHeight 会触发一次
    // 同步布局,拿到的是真实高度(过滤后行数变少时高度也跟着变,所以每次都重算)。
    const menuHeight = el.offsetHeight
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom

    // 只有「朝上放不下、而朝下放得下」才朝下。
    //
    // 刻意**不**写成「选更宽裕的一边」:两边都放不下时那个写法会挑朝下,而朝下恰好盖住
    // 输入框和发送按钮 —— 正是要修的症状。两边都放不下就朝上,让菜单顶部超出视口
    // (它有 max-height:320px + overflow-y:auto,内容照样能滚),输入区始终可见。
    const placeBelow = spaceAbove < menuHeight + GAP && spaceBelow >= menuHeight + GAP

    // 坐标基准与原实现保持一致(不加 scrollY):元素挂在 body 上,而这些宿主页面整页不滚
    // —— 滚动发生在内部面板里。贸然加上会在当前所有场景里引入一个未经验证的偏移。
    el.style.top = placeBelow ? `${rect.bottom + GAP}px` : `${rect.top - menuHeight - GAP}px`
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
   * Reflect the current items into the DOM: nothing to show renders NO box (A), otherwise
   * (re)mount and paint. Never runs once the popup has been dismissed for this session.
   * "Nothing to show" is `hasContent`'s call, so a caller with an empty-state notice can still
   * render a box with zero items.
   */
  function sync(clientRect?: (() => DOMRect | null) | null) {
    if (closed) return
    if (!hasContent(items)) {
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
      // paint() re-clamps `selected` against the freshly built rows, so no clamping is needed here
      // (row count is not knowable until the body has been rebuilt).
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
      if (!el) return false
      // Navigation and selection operate on RENDERED rows, and skip disabled ones. A popup showing
      // only an empty-state notice has no rows, so arrows/Enter fall through to the editor.
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        const next = nextEnabled(selected, key === 'ArrowDown' ? 1 : -1)
        if (next < 0) return false
        selected = next
        paint()
        return true
      }
      if (key === 'Enter') {
        const row = rows[selected]
        if (!row || row.disabled) return false
        cmd?.(row.item)
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
