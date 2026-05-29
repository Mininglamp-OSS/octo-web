import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { TimelinePanel } from './index'
import type { TimelineEntry, TimelineAttachment } from '../../bridge/types'

const longText = [
  '这是一条很长很长的时间线内容，用来验证改成多行换行之后，整行的时间、用户、冒号以及右侧原消息按钮是否仍然和第一行正确对齐。',
  '同时也要覆盖超长英文串：SuperLongUnbrokenToken_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ。',
  '最后再补一段中文，确保 pre-wrap + break-word + overflow-wrap:anywhere 的组合表现稳定。',
].join(' ')

const baseEntry: TimelineEntry = {
  id: 'tl-1',
  matter_id: 'matter-1',
  source_channel_id: 'channel-1',
  user_id: 'user-1',
  content: longText,
  source_msgs: ['msg-1'],
  attachments: [],
  created_at: '2026-05-25T08:30:00.000Z',
}

const sampleAttachments: TimelineAttachment[] = [
  {
    id: 'att-1',
    entry_id: 'tl-3',
    file_url: 'https://example.com/files/proposal-v3.pdf',
    file_name: '产品策略方案v3.pdf',
    file_size: 1_280_000,
    mime_type: 'application/pdf',
    created_at: '2026-05-25T08:30:00.000Z',
  },
  {
    id: 'att-2',
    entry_id: 'tl-3',
    file_url: 'https://example.com/files/metrics.xlsx',
    file_name: '关键指标-Q2.xlsx',
    file_size: 56_320,
    mime_type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    created_at: '2026-05-25T08:30:00.000Z',
  },
  {
    id: 'att-3',
    entry_id: 'tl-3',
    file_url: 'https://example.com/files/0byte.txt',
    file_name: '空文件.txt',
    file_size: 0,
    mime_type: 'text/plain',
    created_at: '2026-05-25T08:30:00.000Z',
  },
]

const meta: Meta<typeof TimelinePanel> = {
  title: 'Matter/TimelinePanel',
  component: TimelinePanel,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof TimelinePanel>

export const LongWrappedWithAnchor: Story = {
  args: {
    entries: [baseEntry],
    onShowAnchor: () => {},
  },
}

export const LongWrappedWithoutAnchor: Story = {
  args: {
    entries: [
      {
        ...baseEntry,
        id: 'tl-2',
        source_msgs: [],
      },
    ],
    onShowAnchor: () => {},
  },
}

// 嵌入聊天侧边栏: 预览 + 下载两个按钮都可用
export const WithAttachmentsPreviewable: Story = {
  args: {
    entries: [
      {
        ...baseEntry,
        id: 'tl-3',
        content: '上传了本周的产品策略和指标文件，请评审',
        attachments: sampleAttachments,
      },
    ],
    onShowAnchor: () => {},
    onPreviewAttachment: () => {},
    onDownloadAttachment: () => {},
  },
}

// 独立 matter 页面: 没有预览, 只有下载
export const WithAttachmentsDownloadOnly: Story = {
  args: {
    entries: [
      {
        ...baseEntry,
        id: 'tl-4',
        content: '附件随便看看',
        attachments: sampleAttachments,
      },
    ],
    onShowAnchor: () => {},
    onDownloadAttachment: () => {},
  },
}
