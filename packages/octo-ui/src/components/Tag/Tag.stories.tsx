import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import Tag from './index'
import type { TagTone, TagVariant } from './types'

const meta: Meta<typeof Tag> = {
  title: 'Octo UI/Tag',
  component: Tag,
  parameters: {
    docs: {
      description: {
        component: 'Unified octo tag chip. Use light, solid, pastel, or AI gradient palettes from the octo token preview.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'radio',
      options: ['light', 'solid', 'pastel', 'ai'],
    },
    size: {
      control: 'radio',
      options: ['default', 'small', 'xs'],
    },
    tone: {
      control: 'select',
      options: [
        'gray',
        'red',
        'amber',
        'green',
        'blue',
        'cyan',
        'purple',
        'orange',
        'pink',
        'dark',
        'teal',
        'indigo',
        'magenta',
        'sky',
        'yellow',
        'peach',
      ],
    },
  },
}

export default meta
type Story = StoryObj<typeof Tag>

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'flex', gap: 'var(--wk-sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
    {children}
  </div>
)

const Stack = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'grid', gap: 'var(--wk-sp-3)' }}>{children}</div>
)

const lightTones: Array<[string, TagTone]> = [
  ['浅灰', 'gray'],
  ['红', 'red'],
  ['琥珀', 'amber'],
  ['绿', 'green'],
  ['蓝', 'blue'],
  ['青', 'cyan'],
  ['紫', 'purple'],
  ['橙', 'orange'],
  ['桃红', 'pink'],
]

const solidTones: Array<[string, TagTone]> = [
  ['黑40', 'dark'],
  ['深灰', 'gray'],
  ['青绿', 'teal'],
  ['靛蓝', 'indigo'],
  ['橙', 'orange'],
  ['绿', 'green'],
  ['品红', 'magenta'],
  ['天蓝', 'sky'],
  ['黄', 'yellow'],
]

const pastelTones: Array<[string, TagTone]> = [
  ['黄', 'yellow'],
  ['青', 'cyan'],
  ['蓝', 'blue'],
  ['紫', 'purple'],
  ['橙', 'orange'],
  ['桃', 'peach'],
  ['绿', 'green'],
  ['红', 'red'],
]

const Palette = ({ variant, tones }: { variant: TagVariant; tones: Array<[string, TagTone]> }) => (
  <Stack>
    <Row>
      {tones.map(([label, tone], index) => (
        index === tones.length - 1 ? (
          <Tag key={`${variant}-${tone}`} variant={variant} tone={tone} closable closeAriaLabel={`Remove ${label} tag`}>
            {label}
          </Tag>
        ) : (
          <Tag key={`${variant}-${tone}`} variant={variant} tone={tone}>{label}</Tag>
        )
      ))}
    </Row>
    <Row>
      {tones.map(([label, tone], index) => (
        index === tones.length - 1 ? (
          <Tag key={`${variant}-${tone}-small`} variant={variant} tone={tone} size="small" closable closeAriaLabel={`Remove ${label} tag`}>
            {label}
          </Tag>
        ) : (
          <Tag key={`${variant}-${tone}-small`} variant={variant} tone={tone} size="small">{label}</Tag>
        )
      ))}
    </Row>
    <Row>
      {tones.map(([label, tone], index) => (
        index === tones.length - 1 ? (
          <Tag key={`${variant}-${tone}-xs`} variant={variant} tone={tone} size="xs" closable closeAriaLabel={`Remove ${label} tag`}>
            {label}
          </Tag>
        ) : (
          <Tag key={`${variant}-${tone}-xs`} variant={variant} tone={tone} size="xs">{label}</Tag>
        )
      ))}
    </Row>
  </Stack>
)

export const Playground: Story = {
  args: {
    children: '标签',
    variant: 'light',
    tone: 'gray',
    size: 'default',
    closable: false,
  },
}

export const LightPalette: Story = {
  render: () => <Palette variant="light" tones={lightTones} />,
}

export const SolidPalette: Story = {
  render: () => <Palette variant="solid" tones={solidTones} />,
}

export const PastelPalette: Story = {
  render: () => <Palette variant="pastel" tones={pastelTones} />,
}

export const AIGradient: Story = {
  render: () => (
    <Row>
      <Tag variant="ai">AI</Tag>
      <Tag variant="ai" closable closeAriaLabel="Remove AI collaboration tag">AI协作</Tag>
      <Tag variant="ai" size="small">AI</Tag>
      <Tag variant="ai" size="small" closable closeAriaLabel="Remove AI collaboration tag">AI协作</Tag>
      <Tag variant="ai" size="xs">AI</Tag>
      <Tag variant="ai" size="xs" closable closeAriaLabel="Remove AI collaboration tag">AI协作</Tag>
    </Row>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <Row>
      <Tag variant="light" tone="purple" icon={<span>AI</span>}>AI协作</Tag>
      <Tag variant="solid" tone="teal" icon={<span>+</span>}>已加入</Tag>
      <Tag variant="pastel" tone="yellow" icon={<span>!</span>}>待确认</Tag>
    </Row>
  ),
}

export const Closable: Story = {
  render: () => (
    <Row>
      <Tag variant="light" tone="pink" closable closeAriaLabel="Remove tag">可关闭</Tag>
      <Tag variant="solid" tone="indigo" closable closeAriaLabel="Remove tag">实心关闭</Tag>
      <Tag variant="pastel" tone="cyan" size="small" closable closeAriaLabel="Remove tag">小尺寸</Tag>
      <Tag variant="light" tone="purple" size="xs" closable closeAriaLabel="Remove tag">最小尺寸</Tag>
    </Row>
  ),
}

export const Truncation: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--wk-sp-3)', maxWidth: 'min(100%, 280px)' }}>
      <Tag>短标签</Tag>
      <Tag variant="light" tone="blue" closable closeAriaLabel="Remove tag">超长标签内容会在较窄容器内截断显示</Tag>
      <Tag variant="pastel" tone="purple">需要配合 Tooltip 展示完整内容</Tag>
    </div>
  ),
}
