import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import AITag from './index'

const meta: Meta<typeof AITag> = {
  title: 'UI/AITag',
  component: AITag,
  tags: ['autodocs'],
  argTypes: {
    aiCount: {
      control: { type: 'number', min: 1, max: 10 },
      description: 'AI 数量: 1 显示 "AI助手", >1 显示 "AI协作"',
    },
  },
}

export default meta
type Story = StoryObj<typeof AITag>

/**
 * AI 助手 tag (单个 AI)
 */
export const Single: Story = {
  args: {
    aiCount: 1,
  },
}

/**
 * AI 协作 tag (多个 AI)
 */
export const Multiple: Story = {
  args: {
    aiCount: 3,
  },
}

/**
 * 设计稿对比
 */
export const DesignComparison: Story = {
  args: {
    aiCount: 2,
  },
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '24px' }}>
      <div>
        <h3 style={{ marginBottom: '8px' }}>AI 助手 (aiCount=1)</h3>
        <AITag aiCount={1} />
      </div>
      
      <div>
        <h3 style={{ marginBottom: '8px' }}>AI 协作 (aiCount=2+)</h3>
        <AITag aiCount={2} />
      </div>
      
      <div>
        <h3 style={{ marginBottom: '8px' }}>设计规范</h3>
        <ul style={{ fontSize: '14px', lineHeight: '1.6' }}>
          <li>背景: linear-gradient(90deg, #41DFFF 0%, #6E7CF7 50%, #7F3BF5 100%)</li>
          <li>文字: 白色, 12px, font-weight 500</li>
          <li>圆角: 全圆角</li>
          <li>内边距: 2px 8px</li>
          <li>高度: 20px</li>
        </ul>
      </div>
    </div>
  ),
}
