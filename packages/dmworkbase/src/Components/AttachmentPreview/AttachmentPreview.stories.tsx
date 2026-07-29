import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'
import AttachmentPreview from './index'
import ConversationContext from '../Conversation/context'

const meta: Meta<typeof AttachmentPreview> = {
  title: 'Business/AttachmentPreview',
  component: AttachmentPreview,
  parameters: {
    docs: {
      description: {
        component: `
附件发送前的预览区（#143 附件延迟发送 / #144 批量附件）。

显示在输入框上方，横向滚动排列所有待发送文件。

**行为：**
- 图片、PDF、Word、Excel、PPT、ZIP 等各有对应颜色图标
- 每个附件右侧有 ✕ 移除按钮
- 超过显示宽度时横向滚动，不换行
- 跟随系统 light / dark 主题
        `,
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof AttachmentPreview>

// Mock context，只实现 story 需要的方法
// 用 size 作为元数据，不实际分配内存
const mockFile = (name: string, size: number, type = '') => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const mockFiles = [
  mockFile('会议纪要.pdf', 1_240_000, 'application/pdf'),
  mockFile('设计稿.png', 3_800_000, 'image/png'),
  mockFile('数据报告.xlsx', 560_000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  mockFile('方案说明.docx', 890_000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  mockFile('演示文稿.pptx', 5_200_000, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  mockFile('素材包.zip', 12_400_000, 'application/zip'),
]

const makeMockContext = (files: File[], onRemove?: (i: number) => void): ConversationContext => ({
  getPendingAttachments: () => files,
  addPendingAttachments: async () => null,
  removePendingAttachment: (i) => onRemove?.(i),
  clearPendingAttachments: () => {},
} as unknown as ConversationContext)

// ── 单文件 ──
export const SingleFile: Story = {
  name: '单个文件',
  render: () => (
    <AttachmentPreview
      conversationContext={makeMockContext([mockFiles[0]])}
      files={[mockFiles[0]]}
    />
  ),
}

// ── 混合多文件 ──
export const MultipleFiles: Story = {
  name: '多个文件（混合类型）',
  render: () => (
    <AttachmentPreview
      conversationContext={makeMockContext(mockFiles)}
      files={mockFiles}
    />
  ),
}

// ── 溢出滚动 ──
export const OverflowScroll: Story = {
  name: '超出宽度横向滚动',
  render: () => {
    const manyFiles = Array.from({ length: 10 }, (_, i) =>
      mockFile(`文件-${i + 1}.pdf`, (i + 1) * 100_000, 'application/pdf')
    )
    return (
      <div style={{ width: 500 }}>
        <AttachmentPreview
          conversationContext={makeMockContext(manyFiles)}
          files={manyFiles}
        />
      </div>
    )
  },
}

// ── 长文件名截断 ──
export const LongFileName: Story = {
  name: '长文件名截断',
  render: () => {
    const files = [
      mockFile('这是一个非常非常非常长的文件名字测试截断效果.pdf', 500_000, 'application/pdf'),
      mockFile('another-very-long-filename-that-should-be-truncated.docx', 200_000),
    ]
    return (
      <AttachmentPreview
        conversationContext={makeMockContext(files)}
        files={files}
      />
    )
  },
}
