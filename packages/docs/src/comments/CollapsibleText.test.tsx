// 长评论折叠 / 「展开全文」(原型 `.comment-text.is-collapsible`)。
//
// 这里的核心不是「有没有按钮」,而是**按什么判断该有按钮**:折叠靠 -webkit-line-clamp,
// 实际行数取决于渲染宽度和字号,所以只能量 scrollHeight。jsdom 不做布局(scrollHeight
// 恒为 0),因此测试直接把 scrollHeight / lineHeight 桩掉,钉住判定逻辑本身。

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { CollapsibleText } from './CollapsibleText.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** 桩掉 jsdom 缺的布局:lineHeight 走 getComputedStyle,scrollHeight 走元素原型。 */
function stubLayout(lineHeightCss: string, scrollHeight: number) {
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = real(el as Element, pseudo)
    return { ...style, lineHeight: lineHeightCss } as CSSStyleDeclaration
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight)
}

describe('CollapsibleText', () => {
  it('offers no toggle when the text fits inside the limit', () => {
    stubLayout('20px', 100) // 5 行 × 20px,正好装得下
    render(<CollapsibleText lineLimit={5}>short</CollapsibleText>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('.octo-comment-text.is-collapsed')).toBeNull()
  })

  it('collapses and offers a toggle when the text overflows', () => {
    stubLayout('20px', 240) // 12 行
    render(<CollapsibleText lineLimit={5}>long</CollapsibleText>)
    const toggle = screen.getByRole('button')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const p = document.querySelector('.octo-comment-text')
    expect(p?.className).toContain('is-collapsed')
    // 行数走内联样式:同一个类要同时服务根评论(5)和回复(3),写死在 CSS 里做不到。
    expect((p as HTMLElement).style.webkitLineClamp).toBe('5')
  })

  it('expands on click and can collapse again', () => {
    stubLayout('20px', 240)
    render(<CollapsibleText lineLimit={3}>long</CollapsibleText>)
    const toggle = screen.getByRole('button')

    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.octo-comment-text')?.className).not.toContain('is-collapsed')

    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('.octo-comment-text')?.className).toContain('is-collapsed')
  })

  it('offers no toggle when line-height is not a resolvable pixel value', () => {
    // line-height: normal 量不出像素值。挂一个点了没反应的按钮比不挂更糟,所以此时不折叠。
    stubLayout('normal', 9999)
    render(<CollapsibleText lineLimit={5}>long</CollapsibleText>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
