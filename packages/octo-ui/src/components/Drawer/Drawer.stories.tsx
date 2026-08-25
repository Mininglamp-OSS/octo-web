import type { Meta, StoryObj } from '@storybook/react-vite'
import { MessageCircle, MoreHorizontal, Search, Smile, AtSign, Maximize2 } from 'lucide-react'
import { useState } from 'react'
import Drawer from './index'
import Switch from '../Switch'

const meta: Meta<typeof Drawer> = {
  title: 'Octo UI/Drawer',
  component: Drawer,
  parameters: {
    docs: {
      description: {
        component: 'Unified drawer backed by Semi SideSheet behavior and styled to the Octo right-panel spec.',
      },
    },
  },
  argTypes: {
    placement: {
      control: 'radio',
      options: ['right', 'left', 'top', 'bottom'],
    },
    size: {
      control: 'radio',
      options: ['compact', 'default', 'wide'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Drawer>

function IconButton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button
      aria-label={label}
      type="button"
      style={{
        alignItems: 'center',
        background: 'transparent',
        border: 0,
        color: 'var(--wk-icon-muted)',
        cursor: 'pointer',
        display: 'inline-flex',
        height: 16,
        justifyContent: 'center',
        padding: 0,
        width: 16,
      }}
    >
      {children}
    </button>
  )
}

function SettingRow({ label, value, danger }: { label: string; value?: React.ReactNode; danger?: boolean }) {
  return (
    <div
      style={{
        alignItems: 'center',
        cursor: 'pointer',
        display: 'flex',
        gap: 8,
        height: 44,
        padding: '0 16px',
      }}
    >
      <span style={{ color: danger ? 'var(--wk-color-danger)' : 'var(--wk-text-primary)', fontSize: 14, fontWeight: 500, lineHeight: '20px' }}>
        {label}
      </span>
      {value ? (
        <span style={{ color: 'var(--wk-text-secondary)', flex: 1, fontSize: 14, lineHeight: '20px', minWidth: 0, overflow: 'hidden', textAlign: 'right', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </span>
      ) : null}
    </div>
  )
}

function SectionGap() {
  return <div style={{ background: 'var(--wk-brand-tint-06)', height: 8 }} />
}

function DrawerPlayground() {
  const [open, setOpen] = useState(true)

  return (
    <div style={{ background: 'var(--wk-bg-base)', height: 420, overflow: 'hidden', position: 'relative' }}>
      <button type="button" onClick={() => setOpen(true)}>
        Open drawer
      </button>
      <Drawer
        open={open}
        inline
        motion={false}
        title="聊天信息"
        onOpenChange={setOpen}
      >
        <SettingRow label="群聊名称" value="后端架构讨论" />
        <SectionGap />
        <SettingRow label="消息免打扰" value={<Switch size="sm" />} />
      </Drawer>
    </div>
  )
}

export const Playground: Story = {
  render: () => <DrawerPlayground />,
}

export const InfoPanel: Story = {
  render: () => (
    <div style={{ display: 'flex', height: 360, justifyContent: 'flex-end', overflow: 'hidden', background: 'var(--wk-bg-base)' }}>
      <Drawer inline open motion={false} size="compact" title="聊天信息" bodyFlush>
        <SettingRow label="群聊名称" value="后端架构讨论" />
        <SettingRow label="群公告" value="未设置" />
        <SettingRow label="备注" value="哈哈哈哈哈哈哈哈哈哈哈哈哈哈" />
        <SectionGap />
        <SettingRow label="消息免打扰" value={<Switch size="sm" />} />
        <SettingRow label="聊天置顶" value={<Switch size="sm" />} />
        <SectionGap />
        <SettingRow label="我在本群的昵称" value="我是保洁" />
        <SectionGap />
        <SettingRow label="清空聊天记录" />
        <SettingRow label="退出群聊" danger />
      </Drawer>
    </div>
  ),
}

export const ThreadPanel: Story = {
  render: () => (
    <div style={{ display: 'flex', height: 360, justifyContent: 'flex-end', overflow: 'hidden', background: 'var(--wk-bg-base)' }}>
      <Drawer
        open
        inline
        motion={false}
        title="数据库选型"
        extra={<IconButton label="More"><MoreHorizontal size={16} /></IconButton>}
        footer={(
          <>
            <span className="octo-ui-drawer__footer-placeholder">在 Thread 中回复...</span>
            <span className="octo-ui-drawer__footer-action"><Smile size={16} /></span>
            <span className="octo-ui-drawer__footer-action"><AtSign size={16} /></span>
            <span className="octo-ui-drawer__footer-action"><Maximize2 size={16} /></span>
          </>
        )}
      >
        <p style={{ color: 'var(--wk-text-secondary)', fontSize: 13, lineHeight: 1.8, margin: 0 }}>
          张兴朝 · 10:20<br />
          我先抛个结论：倾向 PG。我们有大量非结构化数据，JSONB 原生支持这个太重要了。
        </p>
        <p style={{ color: 'var(--wk-text-secondary)', fontSize: 13, lineHeight: 1.8, margin: 0 }}>
          沙东惠 · 10:20<br />
          MySQL 8 也有 JSON 支持了，但是性能确实不如 PG。
        </p>
      </Drawer>
    </div>
  ),
}

export const WidePanel: Story = {
  render: () => (
    <div style={{ display: 'flex', height: 360, justifyContent: 'flex-end', overflow: 'hidden', background: 'var(--wk-bg-base)' }}>
      <Drawer
        open
        inline
        motion={false}
        size="wide"
        title="数据库选型"
        closable={false}
        extra={(
          <>
            <IconButton label="Search"><Search size={16} /></IconButton>
            <IconButton label="Thread"><MessageCircle size={16} /></IconButton>
            <IconButton label="More"><MoreHorizontal size={16} /></IconButton>
          </>
        )}
        footer={<span className="octo-ui-drawer__footer-placeholder">在 Thread 中回复...</span>}
      >
        <div style={{ color: 'var(--wk-text-tertiary)', fontSize: 12 }}>完整视图内容区</div>
      </Drawer>
    </div>
  ),
}
