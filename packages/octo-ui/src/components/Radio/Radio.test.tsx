import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Radio, { RadioGroup } from './index'

vi.mock('@douyinfe/semi-ui', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Radio = React.forwardRef<HTMLLabelElement, any>(function MockRadio(
    { checked, className, children, defaultChecked, disabled, extra, prefixCls, ...rest },
    ref,
  ) {
    const isChecked = checked ?? defaultChecked
    const classes = [
      className,
      prefixCls,
      disabled ? `${prefixCls}-disabled` : '',
      isChecked ? `${prefixCls}-checked` : '',
    ].filter(Boolean).join(' ')

    return (
      <label {...rest} ref={ref} className={classes}>
        <span className={`${prefixCls}-inner`}>
          <input type="radio" checked={Boolean(isChecked)} disabled={disabled} readOnly />
          <span className={`${prefixCls}-inner-display`} />
        </span>
        <span className={`${prefixCls}-content`}>
          <span className={`${prefixCls}-addon`}>{children}</span>
          {extra ? <span className={`${prefixCls}-extra`}>{extra}</span> : null}
        </span>
      </label>
    )
  })
  const RadioGroup = ({ className, children, prefixCls, ...rest }: any) => (
    <div {...rest} className={[className, prefixCls].filter(Boolean).join(' ')}>
      {children}
    </div>
  )

  return { Radio, RadioGroup }
})

describe('Radio', () => {
  it('renders Octo and Semi-prefixed classes', () => {
    const html = renderToStaticMarkup(<Radio defaultChecked name="status">Active</Radio>)

    expect(html).toContain('octo-ui-radio')
    expect(html).toContain('octo-ui-radio--md')
    expect(html).toContain('octo-ui-radio-semi')
    expect(html).toContain('octo-ui-radio-semi-checked')
    expect(html).toContain('type="radio"')
    expect(html).toContain('Active')
  })

  it('supports size, disabled, extra, and custom className', () => {
    const html = renderToStaticMarkup(
      <Radio
        className="custom-radio"
        disabled
        extra="More details"
        name="status"
        size="sm"
      >
        Inactive
      </Radio>,
    )

    expect(html).toContain('octo-ui-radio--sm')
    expect(html).toContain('octo-ui-radio-semi-disabled')
    expect(html).toContain('custom-radio')
    expect(html).toContain('More details')
  })

  it('uses Octo classes as the root styling contract', () => {
    const html = renderToStaticMarkup(<Radio name="status">Active</Radio>)

    expect(html).toContain('octo-ui-radio')
    expect(html).toContain('octo-ui-radio-semi')
  })
})

describe('RadioGroup', () => {
  it('renders option items through Octo Radio', () => {
    const html = renderToStaticMarkup(
      <RadioGroup
        defaultValue="manual"
        options={[
          { label: 'Manual', value: 'manual' },
          { label: 'Automatic', value: 'automatic', disabled: true },
        ]}
      />,
    )

    expect(html).toContain('octo-ui-radio-group')
    expect(html).toContain('octo-ui-radio-group--vertical')
    expect(html).toContain('octo-ui-radio')
    expect(html).toContain('Manual')
    expect(html).toContain('Automatic')
  })

  it('passes custom classes and direction to the group root', () => {
    const html = renderToStaticMarkup(
      <RadioGroup className="custom-group" direction="horizontal">
        <Radio value="manual">Manual</Radio>
      </RadioGroup>,
    )

    expect(html).toContain('octo-ui-radio-group--horizontal')
    expect(html).toContain('custom-group')
  })
})
