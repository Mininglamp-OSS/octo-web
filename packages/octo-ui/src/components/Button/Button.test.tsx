import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './index'

vi.mock('@douyinfe/semi-icons', () => ({
  IconAILoading: () => <span data-icon="loading" />,
}))

describe('Button', () => {
  it('renders children and default classes', () => {
    const html = renderToStaticMarkup(<Button>Confirm</Button>)

    expect(html).toContain('octo-ui-button')
    expect(html).toContain('octo-ui-button--tint')
    expect(html).toContain('octo-ui-button--sm')
    expect(html).toContain('Confirm')
    expect(html).toContain('type="button"')
  })

  it('supports variant, size, and custom className', () => {
    const html = renderToStaticMarkup(
      <Button variant="solid" size="xs" className="custom-button">
        Save
      </Button>,
    )

    expect(html).toContain('octo-ui-button--solid')
    expect(html).toContain('octo-ui-button--xs')
    expect(html).toContain('custom-button')
  })

  it('normalizes deprecated variant and size aliases', () => {
    const html = renderToStaticMarkup(
      <Button variant="ghost" size="md">
        Save
      </Button>,
    )

    expect(html).toContain('octo-ui-button--text')
    expect(html).toContain('octo-ui-button--sm')
  })

  it('maps Semi-compatible visual props when variant is omitted', () => {
    const html = renderToStaticMarkup(
      <Button type="primary" theme="solid" size="small">
        Submit
      </Button>,
    )

    expect(html).toContain('octo-ui-button--solid')
    expect(html).toContain('octo-ui-button--xs')
    expect(html).toContain('type="button"')
  })

  it('maps Semi solid theme without explicit visual type to solid', () => {
    const html = renderToStaticMarkup(<Button theme="solid">Create</Button>)

    expect(html).toContain('octo-ui-button--solid')
    expect(html).toContain('type="button"')
  })

  it.each([
    ['bare button', {}, 'octo-ui-button--tint'],
    ['primary omitted theme', { type: 'primary' }, 'octo-ui-button--tint'],
    ['primary solid', { type: 'primary', theme: 'solid' }, 'octo-ui-button--solid'],
    ['primary light', { type: 'primary', theme: 'light' }, 'octo-ui-button--tint'],
    ['secondary light', { type: 'secondary', theme: 'light' }, 'octo-ui-button--secondary'],
    ['tertiary solid', { type: 'tertiary', theme: 'solid' }, 'octo-ui-button--secondary'],
    ['borderless', { theme: 'borderless' }, 'octo-ui-button--text'],
    ['danger solid', { type: 'danger', theme: 'solid' }, 'octo-ui-button--danger'],
    ['danger borderless', { type: 'danger', theme: 'borderless' }, 'octo-ui-button--danger-text'],
    ['warning light', { type: 'warning', theme: 'light' }, 'octo-ui-button--warning'],
  ] as const)('maps legacy %s props', (_, props, expectedClass) => {
    const html = renderToStaticMarkup(<Button {...props}>Action</Button>)

    expect(html).toContain(expectedClass)
  })

  it('keeps native submit type through htmlType', () => {
    const html = renderToStaticMarkup(<Button htmlType="submit">Submit</Button>)

    expect(html).toContain('type="submit"')
  })

  it('marks the button busy and renders the Semi loading state', () => {
    const html = renderToStaticMarkup(<Button loading>Save</Button>)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('octo-ui-button--loading')
    expect(html).toContain('semi-button-loading')
    expect(html).toContain('data-icon="spin"')
  })

  it('renders icon-only buttons without the text label', () => {
    const html = renderToStaticMarkup(
      <Button iconOnly icon={<span data-icon="close">x</span>} aria-label="Close">
        Close
      </Button>,
    )

    expect(html).toContain('octo-ui-button--icon-only')
    expect(html).toContain('data-icon="close"')
    expect(html).not.toContain('octo-ui-button__label')
  })
})
