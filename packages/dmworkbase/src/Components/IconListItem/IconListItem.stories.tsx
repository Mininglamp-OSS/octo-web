import type { Meta, StoryObj } from '@storybook/react-vite'
import IconListItem from './index'
import icon from '../../assets/icons/filled-interface-add.svg'

const meta: Meta<typeof IconListItem> = {
  title: 'Base/IconListItem',
  component: IconListItem,
  parameters: {
    docs: {
      description: {
        component:
          'Contact entry using the generic @octo/ui Badge for its optional numeric count.',
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof IconListItem>

export const WithBadge: Story = {
  args: {
    icon,
    title: '新的朋友',
    badge: 8,
    backgroudColor: 'var(--wk-bg-surface)',
  },
}

export const WithoutBadge: Story = {
  args: {
    icon,
    title: '新的朋友',
    backgroudColor: 'var(--wk-bg-surface)',
  },
}

export const OverflowBadge: Story = {
  args: {
    icon,
    title: '新的朋友',
    badge: 128,
    backgroudColor: 'var(--wk-bg-surface)',
  },
}
