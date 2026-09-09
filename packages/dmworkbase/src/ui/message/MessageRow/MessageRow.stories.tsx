import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect } from '@storybook/test'
import MessageRow from './index'
import Bubble from '../Bubble'

const meta: Meta<typeof MessageRow> = {
  title: 'ui/message/MessageRow',
  component: MessageRow,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', background: '#fff' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof MessageRow>

/**
 * 接收方消息（默认）
 */
export const RecvDefault: Story = {
  args: {
    isSend: false,
    isContinue: false,
    isSelected: false,
    showAvatar: true,
    avatarUrl: 'https://i.pravatar.cc/32?img=20',
    senderName: '张三',
    timestamp: '10:30',
    isOnline: true,
    children: (
      <Bubble position="single" isSend={false}>
        这是一条接收方消息
      </Bubble>
    ),
  },
}

/**
 * 发送方消息
 */
export const SendDefault: Story = {
  args: {
    isSend: true,
    isContinue: false,
    isSelected: false,
    showAvatar: true,
    avatarUrl: 'https://i.pravatar.cc/32?img=21',
    senderName: '我',
    timestamp: '10:31',
    children: (
      <Bubble position="single" isSend={true}>
        这是一条发送方消息
      </Bubble>
    ),
  },
}

/**
 * 连续消息（接收方）
 */
export const RecvContinue: Story = {
  args: {
    isSend: false,
    isContinue: true,
    isSelected: false,
    showAvatar: false,
    avatarUrl: 'https://i.pravatar.cc/32?img=20',
    senderName: '张三',
    timestamp: '10:32',
    children: (
      <Bubble position="middle" isSend={false}>
        这是连续消息（头像隐藏）
      </Bubble>
    ),
  },
}

/**
 * 多选模式
 */
export const WithCheckbox: Story = {
  args: {
    isSend: false,
    isContinue: false,
    isSelected: false,
    showAvatar: true,
    avatarUrl: 'https://i.pravatar.cc/32?img=22',
    senderName: '李四',
    timestamp: '10:33',
    showCheckbox: true,
    onSelect: (selected) => alert(`选中状态: ${selected}`),
    children: (
      <Bubble position="single" isSend={false}>
        多选模式消息
      </Bubble>
    ),
  },
}

/**
 * 选中状态
 */
export const Selected: Story = {
  args: {
    isSend: false,
    isContinue: false,
    isSelected: true,
    showAvatar: true,
    avatarUrl: 'https://i.pravatar.cc/32?img=23',
    senderName: '王五',
    timestamp: '10:34',
    showCheckbox: true,
    children: (
      <Bubble position="single" isSend={false}>
        已选中的消息
      </Bubble>
    ),
  },
}

/**
 * 完整对话场景
 */
export const Conversation: Story = {
  render: () => (
    <div>
      {/* 接收方第一条 */}
      <MessageRow
        isSend={false}
        isContinue={false}
        isSelected={false}
        showAvatar={true}
        avatarUrl="https://i.pravatar.cc/32?img=24"
        senderName="张兴朝"
        timestamp="10:27"
        isOnline={true}
      >
        <Bubble position="first" isSend={false}>
          大家早，昨天提的新需求我整理了一下
        </Bubble>
      </MessageRow>

      {/* 接收方连续消息 */}
      <MessageRow
        isSend={false}
        isContinue={true}
        isSelected={false}
        showAvatar={false}
        avatarUrl="https://i.pravatar.cc/32?img=24"
        senderName="张兴朝"
        timestamp="10:27"
      >
        <Bubble position="last" isSend={false}>
          主要有三点：用户分组、Thread 功能、消息搜索优化
        </Bubble>
      </MessageRow>

      {/* 发送方回复 */}
      <MessageRow
        isSend={true}
        isContinue={false}
        isSelected={false}
        showAvatar={true}
        avatarUrl="https://i.pravatar.cc/32?img=25"
        senderName="我"
        timestamp="10:30"
      >
        <Bubble position="single" isSend={true}>
          好的，需求 1 和 3 我觉得优先级高
        </Bubble>
      </MessageRow>
    </div>
  ),
}

/**
 * Chromium layout regression guard for the sender / source-space header.
 * This intentionally checks rendered geometry because jsdom does not perform
 * flex layout or calculate ellipsis metrics.
 */
export const HeaderLayoutRegression: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div data-testid="wide-message-row" style={{ width: '760px' }}>
        <MessageRow
          isSend={false}
          isContinue={false}
          isSelected={false}
          showAvatar={false}
          avatarUrl=""
          senderName="宽容器中可完整显示的发送者名称"
          timestamp="10:30"
          isExternal
          sourceSpaceName="宽容器中可完整显示的来源空间名称"
        >
          <Bubble position="single" isSend={false}>
            宽容器布局回归检查
          </Bubble>
        </MessageRow>
      </div>
      <div data-testid="narrow-message-row" style={{ width: '380px' }}>
        <MessageRow
          isSend={false}
          isContinue={false}
          isSelected={false}
          showAvatar={false}
          avatarUrl=""
          senderName="这是一个在窄容器中需要省略的超长发送者名称"
          timestamp="10:30"
          isExternal
          sourceSpaceName="这是一个在窄容器中需要省略的超长来源空间名称"
        >
          <Bubble position="single" isSend={false}>
            窄容器布局回归检查
          </Bubble>
        </MessageRow>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const wide = canvasElement.querySelector('[data-testid="wide-message-row"]')
    const narrow = canvasElement.querySelector(
      '[data-testid="narrow-message-row"]'
    )
    expect(wide).not.toBeNull()
    expect(narrow).not.toBeNull()

    const wideName = wide!.querySelector('.wk-msg-row-sender') as HTMLElement
    const wideSpace = wide!.querySelector(
      '.wk-msg-row-sender-space'
    ) as HTMLElement
    const wideTime = wide!.querySelector('.wk-msg-row-timestamp') as HTMLElement
    expect(wideName.scrollWidth).toBeLessThanOrEqual(wideName.clientWidth)
    expect(wideSpace.scrollWidth).toBeLessThanOrEqual(wideSpace.clientWidth)
    expect(wideTime.getBoundingClientRect().right).toBeLessThanOrEqual(
      wide!.querySelector('.wk-msg-row')!.getBoundingClientRect().right
    )
    expect(
      wideSpace.getBoundingClientRect().left -
        wideName.getBoundingClientRect().right
    ).toBeCloseTo(8, 0)

    const narrowName = narrow!.querySelector(
      '.wk-msg-row-sender'
    ) as HTMLElement
    const narrowSpace = narrow!.querySelector(
      '.wk-msg-row-sender-space'
    ) as HTMLElement
    const narrowTime = narrow!.querySelector(
      '.wk-msg-row-timestamp'
    ) as HTMLElement
    expect(narrowName.scrollWidth).toBeGreaterThan(narrowName.clientWidth)
    expect(narrowSpace.scrollWidth).toBeGreaterThan(narrowSpace.clientWidth)
    expect(narrowTime.scrollWidth).toBe(narrowTime.clientWidth)
    expect(
      narrow!.querySelector('.wk-msg-row')!.scrollWidth
    ).toBeLessThanOrEqual(narrow!.querySelector('.wk-msg-row')!.clientWidth)
  },
}

/**
 * 头像 + 用户名点击（恢复 #941 中断的私聊 / @ 交互）
 * - 点头像 → onAvatarClick（模拟打开私聊）
 * - 点用户名 → onSenderNameClick（模拟展示用户信息）
 * Storybook Actions 面板可看到触发记录；也可直接点看 alert。
 */
export const WithClickHandlers: Story = {
  args: {
    isSend: false,
    isContinue: false,
    isSelected: false,
    showAvatar: true,
    avatarUrl: 'https://i.pravatar.cc/36?img=30',
    senderName: '张三（点我名字）',
    timestamp: '10:30',
    isOnline: true,
    onAvatarClick: (e) => alert(`头像点击 → 打开私聊 (x:${e.clientX})`),
    onSenderNameClick: () => alert('用户名点击 → 展示用户信息'),
    children: (
      <Bubble position="single" isSend={false}>
        点左侧头像或顶部名字，验证回调触发
      </Bubble>
    ),
  },
}

/**
 * Hover 态演示
 */
export const HoverDemo: Story = {
  render: () => (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: '12px', color: '#666' }}>
        Hover 任意消息行，背景色变为 rgba(28,28,35,0.04)
      </p>
      <MessageRow
        isSend={false}
        isContinue={false}
        isSelected={false}
        showAvatar={true}
        avatarUrl="https://i.pravatar.cc/32?img=26"
        senderName="用户A"
        timestamp="10:35"
      >
        <Bubble position="single" isSend={false}>
          Hover 我试试
        </Bubble>
      </MessageRow>
      <MessageRow
        isSend={false}
        isContinue={false}
        isSelected={false}
        showAvatar={true}
        avatarUrl="https://i.pravatar.cc/32?img=27"
        senderName="用户B"
        timestamp="10:36"
      >
        <Bubble position="single" isSend={false}>
          我也可以 Hover
        </Bubble>
      </MessageRow>
    </div>
  ),
}
