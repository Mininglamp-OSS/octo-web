import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import Tag from './index'

const meta: Meta<typeof Tag> = {
  title: 'Octo UI/Tag',
  component: Tag,
  parameters: {
    docs: {
      description: {
        component: 'Lightweight display tag for status and metadata labels.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'radio',
      options: ['neutral', 'brand', 'success', 'warning', 'danger'],
    },
    size: {
      control: 'radio',
      options: ['sm', 'md'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Tag>

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
    {children}
  </div>
)

export const Playground: Story = {
  args: {
    children: 'Active',
    variant: 'neutral',
    size: 'sm',
  },
}

export const Variants: Story = {
  render: () => (
    <Row>
      <Tag variant="neutral">Neutral</Tag>
      <Tag variant="brand">Brand</Tag>
      <Tag variant="success">Success</Tag>
      <Tag variant="warning">Warning</Tag>
      <Tag variant="danger">Danger</Tag>
    </Row>
  ),
}

export const Sizes: Story = {
  render: () => (
    <Row>
      <Tag size="sm">Small</Tag>
      <Tag size="md">Medium</Tag>
      <Tag variant="brand" size="sm">Small brand</Tag>
      <Tag variant="brand" size="md">Medium brand</Tag>
    </Row>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <Row>
      <Tag variant="brand" icon={<span>i</span>}>AI</Tag>
      <Tag variant="success" icon={<span>+</span>}>Ready</Tag>
      <Tag variant="warning" icon={<span>!</span>}>Pending</Tag>
    </Row>
  ),
}

export const EdgeCases: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: '12px', maxWidth: 'min(100%, 280px)' }}>
      <Tag>Short</Tag>
      <Tag variant="brand" size="md">Long metadata label that truncates inside a narrow parent</Tag>
      <Tag variant="danger">Requires attention</Tag>
    </div>
  ),
}
