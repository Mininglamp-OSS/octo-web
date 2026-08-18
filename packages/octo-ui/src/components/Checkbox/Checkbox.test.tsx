import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Checkbox, { CheckboxGroup } from './index'

vi.mock('@douyinfe/semi-ui', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Checkbox = React.forwardRef<HTMLSpanElement, any>(function MockCheckbox(
    { checked, className, children, defaultChecked, disabled, extra, indeterminate, prefixCls, size, ...rest },
    ref,
  ) {
    const isChecked = checked ?? defaultChecked
    const classes = [
      className,
      prefixCls,
      disabled ? `${prefixCls}-disabled` : '',
      isChecked ? `${prefixCls}-checked` : '',
      indeterminate ? `${prefixCls}-indeterminate` : '',
    ].filter(Boolean).join(' ')

    return (
      <span {...rest} ref={ref} className={classes}>
        <span className={`${prefixCls}-inner`}>
          <input type="checkbox" checked={Boolean(isChecked)} disabled={disabled} readOnly />
          <span className={`${prefixCls}-inner-display`} />
        </span>
        <span className={`${prefixCls}-content`}>
          <span className={`${prefixCls}-addon`}>{children}</span>
          {extra ? <span className={`${prefixCls}-extra`}>{extra}</span> : null}
        </span>
      </span>
    )
  })
  const CheckboxGroup = ({ className, children, prefixCls, ...rest }: any) => (
    <div {...rest} className={[className, prefixCls].filter(Boolean).join(' ')}>
      {children}
    </div>
  )

  return { Checkbox, CheckboxGroup }
})

describe('Checkbox', () => {
  it('renders Octo and Semi-prefixed classes', () => {
    const html = renderToStaticMarkup(<Checkbox defaultChecked>Enable</Checkbox>)

    expect(html).toContain('octo-ui-checkbox')
    expect(html).toContain('octo-ui-checkbox--md')
    expect(html).toContain('octo-ui-checkbox-semi')
    expect(html).toContain('octo-ui-checkbox-semi-checked')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('Enable')
  })

  it('supports size, disabled, indeterminate, extra, and custom className', () => {
    const html = renderToStaticMarkup(
      <Checkbox
        className="custom-checkbox"
        disabled
        extra="More details"
        indeterminate
        size="sm"
      >
        Select all
      </Checkbox>,
    )

    expect(html).toContain('octo-ui-checkbox--sm')
    expect(html).toContain('octo-ui-checkbox-semi-disabled')
    expect(html).toContain('octo-ui-checkbox-semi-indeterminate')
    expect(html).toContain('custom-checkbox')
    expect(html).toContain('More details')
  })

  it('does not expose Semi class names as the wrapper contract', () => {
    const html = renderToStaticMarkup(<Checkbox>Enable</Checkbox>)

    expect(html).not.toContain('semi-checkbox')
  })
})

describe('CheckboxGroup', () => {
  it('renders option items through Octo Checkbox', () => {
    const html = renderToStaticMarkup(
      <CheckboxGroup
        defaultValue={['message']}
        options={[
          { label: 'Message', value: 'message' },
          { label: 'Mention', value: 'mention', disabled: true },
        ]}
      />,
    )

    expect(html).toContain('octo-ui-checkbox-group')
    expect(html).toContain('octo-ui-checkbox-group--vertical')
    expect(html).toContain('octo-ui-checkbox')
    expect(html).toContain('Message')
    expect(html).toContain('Mention')
  })

  it('passes custom classes and direction to the group root', () => {
    const html = renderToStaticMarkup(
      <CheckboxGroup className="custom-group" direction="horizontal">
        <Checkbox value="message">Message</Checkbox>
      </CheckboxGroup>,
    )

    expect(html).toContain('octo-ui-checkbox-group--horizontal')
    expect(html).toContain('custom-group')
  })
})
