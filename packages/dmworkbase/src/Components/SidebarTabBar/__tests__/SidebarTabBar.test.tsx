import React from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let SidebarTabBar: typeof import('../index').default
let container: HTMLDivElement

beforeAll(async () => {
  vi.doMock('../../../i18n', () => ({
    useI18n: () => ({ t: (key: string) => key }),
  }))
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    fillStyle: '',
  })) as any
  SidebarTabBar = (await import('../index')).default
})

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container)
  })
  container.remove()
})

describe('SidebarTabBar', () => {
  it('calls onTabChange when clicking an inactive tab', () => {
    const onTabChange = vi.fn()
    const onActiveTabClick = vi.fn()

    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="follow"
          followUnread={0}
          recentUnread={3}
          onTabChange={onTabChange}
          onActiveTabClick={onActiveTabClick}
        />,
        container
      )
    })

    act(() => {
      container.querySelectorAll('button')[1].click()
    })

    expect(onTabChange).toHaveBeenCalledWith('recent')
    expect(onActiveTabClick).not.toHaveBeenCalled()
  })

  it('calls onActiveTabClick when clicking the active tab', () => {
    const onTabChange = vi.fn()
    const onActiveTabClick = vi.fn()

    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="recent"
          followUnread={0}
          recentUnread={3}
          onTabChange={onTabChange}
          onActiveTabClick={onActiveTabClick}
        />,
        container
      )
    })

    act(() => {
      container.querySelectorAll('button')[1].click()
    })

    expect(onActiveTabClick).toHaveBeenCalledWith('recent')
    expect(onTabChange).not.toHaveBeenCalled()
  })

  it('treats clicking the unread badge as clicking the active tab', () => {
    const onActiveTabClick = vi.fn()

    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="recent"
          followUnread={0}
          recentUnread={3}
          onTabChange={() => {}}
          onActiveTabClick={onActiveTabClick}
        />,
        container
      )
    })

    const badge = Array.from(
      container.querySelectorAll('.wk-sidebar-tabbar__badge')
    ).find((el) => el.textContent === '3') as HTMLElement
    act(() => {
      badge.click()
    })

    expect(onActiveTabClick).toHaveBeenCalledWith('recent')
  })

  it('renders follow and recent unread counts with the shared soft badge', () => {
    act(() => {
      ReactDOM.render(
        <SidebarTabBar
          activeTab="recent"
          followUnread={100}
          recentUnread={3}
          onTabChange={() => {}}
        />,
        container
      )
    })

    const badges = container.querySelectorAll('.wk-sidebar-tabbar__badge')
    expect(badges).toHaveLength(2)
    expect(badges[0].classList.contains('octo-ui-badge--soft')).toBe(true)
    expect(badges[0].textContent).toBe('99+')
    expect(badges[1].textContent).toBe('3')
  })
})
