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
- 通过 \`showModeMenu\` 开启"语音输入/语音编辑"模式切换菜单
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
export const WithModeMenu: Story = {
  name: '带模式菜单（showModeMenu）',
  parameters: {
    docs: {
      description: {
        story: '启用 `showModeMenu` 后，hover 时显示"语音输入/语音编辑"下拉菜单。需要 textarea 有内容时语音编辑才可用。',
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
            showModeMenu
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
export const EmptyContentEditGuard: Story = {
  name: '空内容时编辑模式禁用',
  parameters: {
    docs: {
      description: {
        story: '当 `showModeMenu` 开启且 `getCurrentText()` 返回空字符串时，"语音编辑"选项置灰不可点击。',
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
            showModeMenu
            size="md"
          />
        </div>
      </div>
    )
  },
}
