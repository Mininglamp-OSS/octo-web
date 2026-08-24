import type { Meta, StoryObj } from '@storybook/react-vite'
import React, { useRef } from 'react'
import VoiceInputButton from './index'
import VoiceService from '../../Service/VoiceService'

// Patch VoiceService so the component renders without a real backend
VoiceService.shared.getConfig = () =>
  Promise.resolve({ enabled: true, max_file_size: 10_000_000 })

const meta: Meta<typeof VoiceInputButton> = {
  title: 'Base/VoiceInputButton',
  component: VoiceInputButton,
  parameters: {
    docs: {
      description: {
        component: `
语音输入按钮，附加在 input/textarea 旁边，提供语音转文字功能。

**使用约束：**
- 必须传入 \`inputRef\`，指向一个已挂载的 \`<input>\` 或 \`<textarea>\`
- 依赖 VoiceService 后端配置（\`/voice/config\`）——未启用时组件不渲染
- 支持两种尺寸：\`sm\`（默认）和 \`md\`
- 点击麦克风直接开始语音输入，点击录音状态按钮结束
- 可通过 \`className="wk-vib--textarea-corner"\` 绝对定位在 textarea 右上角
        `,
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof VoiceInputButton>

// ── 默认状态（带 input） ──
export const Default: Story = {
  name: '默认（sm + input）',
  render: () => {
    const inputRef = useRef<HTMLInputElement>(null)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="输入内容..."
          style={{ width: 240, padding: '4px 8px', border: '1px solid var(--wk-border-default)', borderRadius: 4 }}
        />
        <VoiceInputButton
          inputRef={inputRef}
          onTranscribed={(text) => console.log('transcribed:', text)}
        />
      </div>
    )
  },
}

// ── 离线/禁用状态 ──
export const DisabledOffline: Story = {
  name: '禁用状态（离线模拟）',
  parameters: {
    docs: {
      description: {
        story: '当网络不可用且无本地模型时，按钮呈 disabled 状态（半透明 + not-allowed 光标）。此处通过不挂载 input 来模拟 disabled。',
      },
    },
  },
  render: () => {
    const inputRef = useRef<HTMLInputElement>(null)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--wk-text-tertiary)' }}>无可用输入框 →</span>
        <VoiceInputButton
          inputRef={inputRef}
          onTranscribed={(text) => console.log('transcribed:', text)}
        />
      </div>
    )
  },
}

// ── 尺寸对比 ──
export const Sizes: Story = {
  name: '尺寸对比（sm vs md）',
  render: () => {
    const inputRef = useRef<HTMLInputElement>(null)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="共用 input"
          style={{ width: 240, padding: '4px 8px', border: '1px solid var(--wk-border-default)', borderRadius: 4 }}
        />
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <VoiceInputButton
              inputRef={inputRef}
              onTranscribed={(text) => console.log('transcribed:', text)}
              size="sm"
            />
            <span style={{ fontSize: 12, color: 'var(--wk-text-tertiary)' }}>sm (24×24)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <VoiceInputButton
              inputRef={inputRef}
              onTranscribed={(text) => console.log('transcribed:', text)}
              size="md"
            />
            <span style={{ fontSize: 12, color: 'var(--wk-text-tertiary)' }}>md (28×28)</span>
          </div>
        </div>
      </div>
    )
  },
}

// ── 带模式菜单 ──
export const WithExistingText: Story = {
  name: '已有文本',
  parameters: {
    docs: {
      description: {
        story: '已有文本不会改变语音输入按钮行为。',
      },
    },
  },
  render: () => {
    const inputRef = useRef<HTMLTextAreaElement>(null)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          ref={inputRef}
          defaultValue="这里有一些已有内容，hover 按钮可以看到模式菜单"
          style={{ width: 320, height: 80, padding: 8, border: '1px solid var(--wk-border-default)', borderRadius: 4, resize: 'none' }}
        />
        <div>
          <VoiceInputButton
            inputRef={inputRef}
            onTranscribed={(text) => console.log('transcribed:', text)}
            getCurrentText={() => inputRef.current?.value ?? ''}
            size="md"
          />
        </div>
      </div>
    )
  },
}

// ── Textarea 右上角定位 ──
export const TextareaCorner: Story = {
  name: 'Textarea 右上角定位',
  parameters: {
    docs: {
      description: {
        story: '使用 `className="wk-vib--textarea-corner"` 将按钮绝对定位在 textarea 的右上角。父容器需要 `position: relative`。',
      },
    },
  },
  render: () => {
    const inputRef = useRef<HTMLTextAreaElement>(null)
    return (
      <div style={{ position: 'relative', width: 320 }}>
        <textarea
          ref={inputRef}
          placeholder="按钮在右上角..."
          style={{ width: '100%', height: 100, padding: 8, paddingRight: 36, border: '1px solid var(--wk-border-default)', borderRadius: 4, resize: 'none' }}
        />
        <VoiceInputButton
          inputRef={inputRef}
          onTranscribed={(text) => console.log('transcribed:', text)}
          className="wk-vib--textarea-corner"
        />
      </div>
    )
  },
}

// ── 空内容时编辑模式不可用 ──
export const EmptyContent: Story = {
  name: '空内容',
  parameters: {
    docs: {
      description: {
        story: '空内容也可以直接开始语音输入。',
      },
    },
  },
  render: () => {
    const inputRef = useRef<HTMLTextAreaElement>(null)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          ref={inputRef}
          placeholder="（空内容 — hover 按钮查看菜单）"
          style={{ width: 320, height: 60, padding: 8, border: '1px solid var(--wk-border-default)', borderRadius: 4, resize: 'none' }}
        />
        <div>
          <VoiceInputButton
            inputRef={inputRef}
            onTranscribed={(text) => console.log('transcribed:', text)}
            getCurrentText={() => ''}
            size="md"
          />
        </div>
      </div>
    )
  },
}
