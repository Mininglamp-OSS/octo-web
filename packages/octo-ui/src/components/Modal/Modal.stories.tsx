import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import Button from '../Button'
import Input from '../Input'
import Switch from '../Switch'
import Modal, { ConfirmModal } from './index'

const meta: Meta<typeof Modal> = {
  title: 'Octo UI/Modal',
  component: Modal,
  parameters: {
    docs: {
      description: {
        component: 'Unified modal backed by Semi Modal behavior and styled to the Octo dialog spec.',
      },
    },
  },
  argTypes: {
    size: {
      control: 'radio',
      options: ['default', 'wide', 'fullscreen'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Modal>

function SpaceCreateModal() {
  const [open, setOpen] = useState(true)

  return (
    <div style={{ minHeight: 420 }}>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal
        open={open}
        title="创建Space："
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="solid" onClick={() => setOpen(false)}>创建</Button>
          </>
        )}
        onOpenChange={setOpen}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: 'var(--wk-text-secondary)', fontSize: 14, fontWeight: 600 }}>Space名称<span style={{ color: 'var(--wk-color-danger)' }}>*</span></span>
          <Input placeholder="请输入" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: 'var(--wk-text-secondary)', fontSize: 14, fontWeight: 600 }}>描述</span>
          <Input.TextArea maxCount={200} placeholder="待填" />
        </label>
        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
          <span style={{ color: 'var(--wk-text-secondary)', fontSize: 14 }}>
            <b style={{ color: 'var(--wk-text-primary)', fontWeight: 500 }}>加入审批</b>（成员需管理员审批后才能加入）
          </span>
          <Switch />
        </div>
      </Modal>
    </div>
  )
}

function ConfirmPlayground() {
  const [open, setOpen] = useState(true)

  return (
    <div style={{ minHeight: 320 }}>
      <Button onClick={() => setOpen(true)}>Open confirm</Button>
      <ConfirmModal
        open={open}
        okText="确认"
        title="确认删除？"
        description="删除后无法恢复"
        onClose={() => setOpen(false)}
        onOk={() => setOpen(false)}
      />
    </div>
  )
}

export const Playground: Story = {
  render: () => <SpaceCreateModal />,
}

export const Confirm: Story = {
  render: () => <ConfirmPlayground />,
}

export const LongContent: Story = {
  render: () => (
    <Modal open motion={false} title="长内容弹窗" footer={<Button variant="solid">完成</Button>}>
      {Array.from({ length: 24 }).map((_, index) => (
        <p key={index} style={{ margin: 0 }}>
          第 {index + 1} 行内容用于验证弹窗超过高度后只在内容区滚动。
        </p>
      ))}
    </Modal>
  ),
}

export const NoFooter: Story = {
  render: () => (
    <Modal open motion={false} title="无底部操作" footer={null}>
      <p style={{ margin: 0 }}>用于信息展示或业务自定义操作区。</p>
    </Modal>
  ),
}
