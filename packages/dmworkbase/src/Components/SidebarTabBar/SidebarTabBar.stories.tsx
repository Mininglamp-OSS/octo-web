import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within, userEvent } from '@storybook/test'
import React, { useState } from 'react'
import SidebarTabBar from './index'
import type { SidebarTab } from './index'

const meta: Meta<typeof SidebarTabBar> = {
  title: 'Business/SidebarTabBar',
  component: SidebarTabBar,
  parameters: {
    docs: {
      description: {
        component: `
关注/最近 Tab 切换栏。

**Props：**
- \`activeTab\`：当前激活的 Tab（'follow' | 'recent'）
- \`followUnread\`：关注未读总数
- \`recentUnread\`：最近未读总数
- \`onTabChange\`：切换回调
- \`onActiveTabClick\`：点击当前已激活 Tab 时触发

**States：**
- 关注激活
- 最近激活
- 有未读角标（数字 / 99+）
- 无未读
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 280, background: 'var(--wk-bg-base, #F7F8FA)', borderRadius: 8 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof SidebarTabBar>

// ─── 静态 Stories ───────────────────────────────────────────

export const FollowActive: Story = {
  name: '关注 Tab 激活',
  args: {
    activeTab: 'follow',
    followUnread: 5,
    recentUnread: 3,
    onTabChange: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const btns = canvas.getAllByRole('button')
    // 关注按钮有 active 样式
    expect(btns[0].className).toContain('active')
    // 角标数字正确
    expect(canvas.getByText('5')).toBeInTheDocument()
    expect(canvas.getByText('3')).toBeInTheDocument()
  },
}

export const RecentActive: Story = {
  name: '最近 Tab 激活',
  args: {
    activeTab: 'recent',
    followUnread: 5,
    recentUnread: 3,
    onTabChange: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const btns = canvas.getAllByRole('button')
    expect(btns[1].className).toContain('active')
  },
}

export const NoBadge: Story = {
  name: '无未读角标',
  args: {
    activeTab: 'follow',
    followUnread: 0,
    recentUnread: 0,
    onTabChange: () => {},
  },
  play: async ({ canvasElement }) => {
    // 无角标元素
    expect(canvasElement.querySelectorAll('.wk-sidebar-tabbar__badge').length).toBe(0)
  },
}

export const LargeUnread: Story = {
  name: '99+ 角标',
  args: {
    activeTab: 'follow',
    followUnread: 999,
    recentUnread: 100,
    onTabChange: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const badges = canvas.getAllByText('99+')
    expect(badges.length).toBe(2)
  },
}

// ─── 交互 Story ─────────────────────────────────────────────

export const TabSwitch: Story = {
  name: 'Tab 切换交互（play function）',
  render: () => {
    const [tab, setTab] = useState<SidebarTab>('follow')
    return (
      <SidebarTabBar
        activeTab={tab}
        followUnread={5}
        recentUnread={3}
        onTabChange={setTab}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const btns = canvas.getAllByRole('button')

    // 初始：关注 active
    expect(btns[0].className).toContain('active')
    expect(btns[1].className).not.toContain('active')

    // 点击最近 Tab
    await userEvent.click(btns[1])
    expect(btns[1].className).toContain('active')
    expect(btns[0].className).not.toContain('active')

    // 再点回关注
    await userEvent.click(btns[0])
    expect(btns[0].className).toContain('active')
  },
}

export const ActiveTabClick: Story = {
  name: '点击已激活 Tab',
  render: () => {
    const [activeClicks, setActiveClicks] = useState<SidebarTab[]>([])
    return (
      <div>
        <SidebarTabBar
          activeTab="recent"
          followUnread={0}
          recentUnread={3}
          onTabChange={() => {}}
          onActiveTabClick={(tab) => setActiveClicks((items) => [...items, tab])}
        />
        <div data-testid="active-clicks">{activeClicks.join(',')}</div>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const btns = canvas.getAllByRole('button')

    await userEvent.click(btns[1])
    expect(canvas.getByTestId('active-clicks').textContent).toBe('recent')

    await userEvent.click(canvas.getByText('3'))
    expect(canvas.getByTestId('active-clicks').textContent).toBe('recent,recent')
  },
}
