import type { Meta, StoryObj } from '@storybook/react-vite'
import Dot from './index'
import type { DotTone } from './types'

const meta: Meta<typeof Dot> = {
  title: 'Octo UI/Dot',
  component: Dot,
  parameters: {
    docs: {
      description: {
        component:
          'Generic status dot. The caller owns status labels and the mapping from business state to tone.',
      },
    },
  },
  argTypes: {
    tone: {
      control: 'radio',
      options: ['neutral', 'danger', 'success', 'warning', 'info'],
    },
    size: { control: 'radio', options: ['default', 'small'] },
  },
}

export default meta
type Story = StoryObj<typeof Dot>

const tones: DotTone[] = ['neutral', 'danger', 'success', 'warning', 'info']

export const Playground: Story = {
  args: { tone: 'danger', size: 'default', 'aria-label': 'Example status' },
}

export const Tones: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--wk-sp-3)' }}>
      {tones.map((tone) => (
        <div
          key={tone}
          style={{
            display: 'flex',
            gap: 'var(--wk-sp-2)',
            alignItems: 'center',
          }}
        >
          <Dot tone={tone} />
          <span>{tone}</span>
        </div>
      ))}
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div
      style={{ display: 'flex', gap: 'var(--wk-sp-4)', alignItems: 'center' }}
    >
      <span
        style={{
          display: 'inline-flex',
          gap: 'var(--wk-sp-2)',
          alignItems: 'center',
        }}
      >
        <Dot tone="success" /> Default 8px
      </span>
      <span
        style={{
          display: 'inline-flex',
          gap: 'var(--wk-sp-2)',
          alignItems: 'center',
        }}
      >
        <Dot tone="success" size="small" /> Small 6px
      </span>
    </div>
  ),
}
