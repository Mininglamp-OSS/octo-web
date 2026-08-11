import { describe, it, expect, afterEach } from 'vitest'
import { createSuggestionMenuRenderer } from './suggestionMenu.ts'

// The @-mention and :-emoji popups share this renderer, so covering it here covers both
// (octo-web #624): (A) an empty result set must render NO floating box, and (B) Escape and
// an outside mousedown must close an open popup.

interface Row {
  id: string
  label: string
}

const A: Row = { id: 'a', label: 'Alice' }
const B: Row = { id: 'b', label: 'Bob' }

const MENU_CLASS = 'octo-test-menu'

function menu() {
  return createSuggestionMenuRenderer<Row>((r) => r.label, MENU_CLASS)
}

function menuCount(): number {
  return document.querySelectorAll(`.${MENU_CLASS}`).length
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('suggestion menu — A: zero results render nothing (#624)', () => {
  it('appends no menu element when onStart receives an empty item list', () => {
    menu().onStart({ items: [], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
  })

  it('never inserts the "—" empty placeholder', () => {
    menu().onStart({ items: [], command: () => {}, clientRect: null })
    expect(document.querySelector('.octo-suggest-empty')).toBeNull()
  })

  it('renders one row per item when items are present', () => {
    menu().onStart({ items: [A, B], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    expect(document.querySelectorAll('.octo-suggest-item').length).toBe(2)
  })

  it('removes the box when an update drops the results to zero', () => {
    const r = menu()
    r.onStart({ items: [A], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    r.onUpdate({ items: [], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
  })

  it('re-opens the box when a later update brings results back', () => {
    const r = menu()
    r.onStart({ items: [], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
    r.onUpdate({ items: [A], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
  })
})

describe('suggestion menu — B: Esc + outside click close (#624)', () => {
  it('Escape destroys the box and reports the key handled', () => {
    const r = menu()
    r.onStart({ items: [A, B], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    const handled = r.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Escape' }) })
    expect(handled).toBe(true)
    expect(menuCount()).toBe(0)
  })

  it('a mousedown outside the box closes it', () => {
    menu().onStart({ items: [A, B], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menuCount()).toBe(0)
  })

  it('a mousedown inside the box does NOT close it', () => {
    menu().onStart({ items: [A, B], command: () => {}, clientRect: null })
    const row = document.querySelector('.octo-suggest-item') as HTMLElement
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menuCount()).toBe(1)
  })

  it('stays closed on a later update after Escape (until the suggestion exits)', () => {
    const r = menu()
    r.onStart({ items: [A, B], command: () => {}, clientRect: null })
    r.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Escape' }) })
    r.onUpdate({ items: [A, B], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
  })

  it('onExit removes the box and detaches the outside listener (no cross-session leak)', () => {
    const r = menu()
    r.onStart({ items: [A], command: () => {}, clientRect: null })
    r.onExit()
    expect(menuCount()).toBe(0)
    // A stale listener from the first session must not double-close the second session's box.
    const r2 = menu()
    r2.onStart({ items: [A], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
  })
})

// ── C: 弹出方向 ────────────────────────────────────────────────────────────────
// 评论输入框几乎总是钉在面板底部(文档抽屉 / 表格侧栏 / HTML 侧栏都是),往下弹会超出
// 视口下沿并盖住「发送」区 —— 用户看到的是被截断的菜单。所以**默认朝上**,只有朝上
// 确实放不下、且朝下更宽裕时才朝下。
describe('suggestion menu — C: 默认朝上弹,放不下才朝下', () => {
  const MENU_H = 200

  /** 让 offsetHeight 有值:jsdom 里它恒为 0,不桩就无法验证「朝上」的算式。 */
  function withMenuHeight(h: number) {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: h })
    return () => {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', desc)
    }
  }

  function rectAt(top: number, bottom: number): DOMRect {
    return { top, bottom, left: 40, right: 140, width: 100, height: bottom - top, x: 40, y: top,
      toJSON: () => ({}) } as DOMRect
  }

  function openAt(rect: DOMRect): HTMLElement {
    menu().onStart({ items: [A, B], command: () => {}, clientRect: () => rect })
    const el = document.querySelector(`.${MENU_CLASS}`) as HTMLElement
    expect(el).toBeTruthy()
    return el
  }

  it('输入框在底部时朝上弹(top = 光标上沿 - 菜单高 - 间距)', () => {
    const restore = withMenuHeight(MENU_H)
    try {
      // 视口 800 高,光标在 760 —— 下方只剩 40px,装不下 200px 的菜单。
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
      const el = openAt(rectAt(740, 760))
      expect(el.style.top).toBe(`${740 - MENU_H - 4}px`)
    } finally {
      restore()
    }
  })

  it('顶部空间不够、下方更宽裕时朝下弹', () => {
    const restore = withMenuHeight(MENU_H)
    try {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
      // 光标贴着视口顶部:上方只有 10px,下方 770px。
      const el = openAt(rectAt(10, 30))
      expect(el.style.top).toBe(`${30 + 4}px`)
    } finally {
      restore()
    }
  })

  it('上下都放不下时仍朝上(菜单自己滚,不盖住输入区)', () => {
    const restore = withMenuHeight(600)
    try {
      // 视口只有 400 高,600px 的菜单两边都放不下;上方(180)比下方(180 以下)不吃亏。
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
      const el = openAt(rectAt(180, 200))
      expect(el.style.top).toBe(`${180 - 600 - 4}px`)
    } finally {
      restore()
    }
  })

  it('水平位置仍然贴着光标左沿', () => {
    const restore = withMenuHeight(MENU_H)
    try {
      const el = openAt(rectAt(740, 760))
      expect(el.style.left).toBe('40px')
    } finally {
      restore()
    }
  })
})
