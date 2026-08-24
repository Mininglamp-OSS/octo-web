import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Switch from './index'

vi.mock('@douyinfe/semi-ui', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  // This mock only supports static markup assertions. The real Semi Switch ref
  // resolves to Semi's class instance, not this mock DOM element.
  const Switch = React.forwardRef<HTMLDivElement, any>(function MockSwitch(
    { checked, className, defaultChecked, disabled, loading, size, ...rest },
    ref,
  ) {
    const isChecked = checked ?? defaultChecked
    const classes = [
      className,
      'semi-switch',
      isChecked ? 'semi-switch-checked' : '',
      disabled ? 'semi-switch-disabled' : '',
      loading ? 'semi-switch-loading' : '',
      size === 'large' ? 'semi-switch-large' : '',
      size === 'small' ? 'semi-switch-small' : '',
    ].filter(Boolean).join(' ')

    return (
      <div {...rest} ref={ref} className={classes}>
        {loading ? <span className="semi-switch-loading-spin" /> : <div className="semi-switch-knob" />}
        <input
          aria-checked={Boolean(isChecked)}
          className="semi-switch-native-control"
          disabled={disabled || loading}
          readOnly
          role="switch"
          type="checkbox"
        />
      </div>
    )
  })

  return { Switch }
})

describe('Switch', () => {
  it('renders Octo and Semi switch classes', () => {
    const html = renderToStaticMarkup(<Switch defaultChecked aria-label="Enable" />)

    expect(html).toContain('octo-ui-switch')
    expect(html).toContain('octo-ui-switch--md')
    expect(html).toContain('semi-switch')
    expect(html).toContain('semi-switch-checked')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-label="Enable"')
  })

  it('maps sizes to stable Octo classes', () => {
    const large = renderToStaticMarkup(<Switch size="lg" aria-label="Large" />)
    const small = renderToStaticMarkup(<Switch size="sm" aria-label="Small" />)

    expect(large).toContain('octo-ui-switch--lg')
    expect(large).toContain('semi-switch-large')
    expect(small).toContain('octo-ui-switch--sm')
    expect(small).toContain('semi-switch-small')
  })

  it('supports disabled, loading, and custom className', () => {
    const html = renderToStaticMarkup(
      <Switch
        aria-label="Loading disabled"
        className="custom-switch"
        disabled
        loading
      />,
    )

    expect(html).toContain('custom-switch')
    expect(html).toContain('semi-switch-disabled')
    expect(html).toContain('semi-switch-loading')
    expect(html).toContain('semi-switch-loading-spin')
  })
})
