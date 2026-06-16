import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import TextContent from './index'
import type { MentionInfo, EmojiInfo } from '../../../Messages/Text/MarkdownContent'

const meta: Meta<typeof TextContent> = {
  title: 'ui/message/TextContent',
  component: TextContent,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '600px', padding: '20px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TextContent>

const mockMentions: MentionInfo[] = [
  { name: '@Thomas AI', uid: 'user-1' },
  { name: '@所有人', uid: 'all' },
  { name: '@噜噜', uid: 'user-2' },
]

const mockEmojis: EmojiInfo[] = [
  { key: '[微笑]', url: 'https://twemoji.maxcdn.com/v/latest/72x72/1f604.png' },
  { key: '😀', url: 'https://twemoji.maxcdn.com/v/latest/72x72/1f600.png' },
]

/**
 * 普通文本
 */
export const PlainText: Story = {
  args: {
    content: '这是一条普通文本消息',
  },
}

/**
 * 含 @ 提及
 */
export const WithMention: Story = {
  args: {
    content: '好的，需求 1 和 3 我觉得优先级高。@Thomas AI 先帮忙分析一下 Thread 功能的技术可行性？',
    mentions: mockMentions,
    onMentionClick: (uid) => alert(`点击了 ${uid}`),
  },
}

/**
 * @ 所有人
 */
export const MentionAll: Story = {
  args: {
    content: '看一下 @所有人',
    mentions: mockMentions,
  },
}

/**
 * 含 Emoji
 */
export const WithEmoji: Story = {
  args: {
    content: '👌好的，👏👏👏👏需求 1 和 3 我觉得优先级高。',
    emojis: mockEmojis,
  },
}

/**
 * 大表情（160×160）
 */
export const LargeEmoji: Story = {
  args: {
    content: '[微笑]',
    emojis: [mockEmojis[0]],
    isLargeEmoji: true,
  },
}

/**
 * 混合内容（@ + Emoji + 链接）
 */
export const Mixed: Story = {
  args: {
    content: '好的，需求 1 和 3 我觉得优先级高。@Thomas AI 先帮忙分析一下 Thread 功能的技术可行性？😀 参考文档：https://www.figma.com/design/test',
    mentions: mockMentions,
    emojis: mockEmojis,
    onMentionClick: (uid) => console.log('Clicked:', uid),
  },
}

/**
 * 长文本换行
 */
export const LongText: Story = {
  args: {
    content: `松开 fn+space → 停止录音 → 气泡显示「编辑中」→ 将「原输入框全部内容 + 语音转写文字」拼接后调后端 LLM 接口（系统预设固定 prompt，不可用户配置）处理；output 文字替换输入框内容。`,
  },
}

/**
 * Markdown 支持
 */
export const MarkdownSupport: Story = {
  args: {
    content: `**粗体** 和 *斜体* 和 \`代码\`

- 列表项 1
- 列表项 2

\`\`\`javascript
function hello() {
  console.log('Hello World');
}
\`\`\``,
  },
}

/**
 * @ 三等级对比（参考 318:12716）
 */
export const MentionLevels: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
          交互实体（紫色+浅紫背景）
        </p>
        <TextContent
          content="长按 fn+space → 悬浮气泡显示「语音编辑」（紫色）+ 话筒激活 → 开始录音 @牛爷爷"
          mentions={[{ name: '@牛爷爷', uid: 'user-3' }]}
          onMentionClick={(uid) => alert(uid)}
        />
      </div>
      
      <div>
        <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
          广播 mention（同普通 @ 用户视觉，不可点击）
        </p>
        <TextContent
          content="看一下 @所有人"
          mentions={[{ name: '@所有人', uid: 'all' }]}
        />
      </div>
      
      <div>
        <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
          降级态（同正文色）
        </p>
        <TextContent
          content="MySQL 8 也有 JSON 支持了，但是性能确实不如 PG。@噜噜"
          mentions={[{ name: '@噜噜', uid: '' }]} // uid 为空表示未解析
        />
      </div>
    </div>
  ),
}
