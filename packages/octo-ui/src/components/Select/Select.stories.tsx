import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import Select from './index'

const meta: Meta<typeof Select> = {
  title: 'Octo UI/Select',
  component: Select,
  parameters: {
    docs: {
      description: {
        component: 'Unified select control backed by Semi behavior with Octo UI trigger and option rendering.',
      },
    },
  },
  argTypes: {
    size: {
      control: 'radio',
      options: ['small', 'default', 'large'],
    },
    status: {
      control: 'radio',
      options: ['default', 'error', 'warning', 'success'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Select>

const basicOptions = [
  { value: 'asc', label: '时间正序' },
  { value: 'desc', label: '时间倒序' },
  { value: 'score', label: '相关度' },
]

const manyOptions = Array.from({ length: 24 }, (_, index) => ({
  value: `option-${index + 1}`,
  label: `选项 ${String(index + 1).padStart(2, '0')}`,
}))

const longOptions = [
  {
    value: 'daily-summary',
    label: '这是一个非常长的选项名称，用于验证下拉菜单达到最大宽度后是否正确省略',
  },
  {
    value: 'weekly-review',
    label: '超长项目名称 - 跨团队周会复盘与后续任务同步列表',
  },
  {
    value: 'quarterly-plan',
    label: '季度目标拆解、风险项追踪、资源协调与阶段性验收计划',
  },
]

const roleOptions = [
  { value: 'frontend', label: '前端' },
  { value: 'backend', label: '后端' },
  { value: 'design', label: '设计' },
  { value: 'data', label: '数据' },
  { value: 'product', label: '产品' },
  { value: 'qa', label: '测试' },
  { value: 'ops', label: '运维' },
  { value: 'research', label: '研究' },
  { value: 'support', label: '支持' },
  { value: 'security', label: '安全' },
  { value: 'docs', label: '文档' },
  { value: 'growth', label: '增长' },
]

export const Playground: Story = {
  args: {
    placeholder: '选择排序',
    optionList: basicOptions,
    style: { width: 210 },
  },
}

export const States: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 260 }}>
      <Select placeholder="搜索成员" optionList={basicOptions} />
      <Select value="asc" optionList={basicOptions} />
      <Select disabled placeholder="不可选" optionList={basicOptions} />
      <Select status="error" placeholder="请选择项目" optionList={basicOptions} />
      <Select placeholder="无数据" optionList={[]} />
    </div>
  ),
}

export const MaxWidth: Story = {
  render: () => (
    <Select
      defaultOpen
      defaultValue="daily-summary"
      dropdownMatchSelectWidth={false}
      dropdownStyle={{ width: 360 }}
      maxHeight={260}
      optionList={longOptions}
      placeholder="最大宽度"
      style={{ width: 210 }}
    />
  ),
}

export const CompactHeight: Story = {
  render: () => (
    <Select
      defaultOpen
      defaultValue="option-1"
      maxHeight={148}
      optionList={manyOptions.slice(0, 12)}
      placeholder="紧凑高度"
      style={{ width: 240 }}
    />
  ),
}

export const MaxHeight: Story = {
  render: () => (
    <Select
      defaultOpen
      defaultValue="option-1"
      optionList={manyOptions}
      placeholder="最大高度"
      style={{ width: 240 }}
    />
  ),
}

export const Multiple: Story = {
  render: () => {
    const [value, setValue] = useState<Array<string | number>>(['frontend', 'design'])
    return (
      <Select
        multiple
        clearable
        value={value}
        onValueChange={(next) => setValue(Array.isArray(next) ? next : [])}
        optionList={roleOptions.slice(0, 4)}
        placeholder="选择标签"
        style={{ width: 240 }}
      />
    )
  },
}

export const MultipleManyOptions: Story = {
  render: () => {
    const [value, setValue] = useState<Array<string | number>>([
      'frontend',
      'backend',
      'design',
      'data',
      'product',
      'qa',
    ])

    return (
      <Select
        multiple
        clearable
        defaultOpen
        maxHeight={260}
        value={value}
        onValueChange={(next) => setValue(Array.isArray(next) ? next : [])}
        optionList={roleOptions}
        placeholder="选择标签"
        style={{ width: 320 }}
      />
    )
  },
}

export const Empty: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 96, maxWidth: 240, paddingBottom: 96 }}>
      <Select defaultOpen placeholder="无数据" optionList={[]} />
      <Select defaultOpen emptyContent="没有匹配的选项" placeholder="搜索结果" optionList={[]} />
    </div>
  ),
}

export const ChildrenOptions: Story = {
  render: () => (
    <Select defaultValue="database" style={{ width: 240 }}>
      <Select.Option value="database">数据库选型</Select.Option>
      <Select.Option value="frontend">前端框架评审</Select.Option>
      <Select.Option value="disabled" disabled>不可选项目</Select.Option>
    </Select>
  ),
}
