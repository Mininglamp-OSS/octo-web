import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Input from './index'

vi.mock('@douyinfe/semi-icons', () => ({
  IconAlertCircle: ({ size }: { size?: string }) => <span data-icon="alert-circle" data-size={size} />,
  IconSearchStroked: ({ size }: { size?: string }) => <span data-icon="search" data-size={size} />,
}))

vi.mock('@douyinfe/semi-ui/lib/es/input', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Input = React.forwardRef<HTMLInputElement, any>(function MockInput(
    { className, prefix, suffix, validateStatus, value, defaultValue, onEnterPress, ...rest },
    ref,
  ) {
    return (
      <span className={className} data-status={validateStatus}>
        {prefix}
        <input
          {...rest}
          ref={ref}
          value={value ?? defaultValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onEnterPress?.(event)
          }}
          readOnly
        />
        {suffix}
      </span>
    )
  })

  return { default: Input }
})

vi.mock('@douyinfe/semi-ui/lib/es/input/textarea', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    default: React.forwardRef<HTMLTextAreaElement, any>(function MockTextArea(
      { className, validateStatus, value, defaultValue, ...rest },
      ref,
    ) {
      return (
        <span data-status={validateStatus}>
          <textarea {...rest} ref={ref} className={className} value={value ?? defaultValue} readOnly />
        </span>
      )
    }),
  }
})

describe('Input', () => {
  it('renders Octo input classes and passes value props', () => {
    const html = renderToStaticMarkup(<Input defaultValue="Octo" placeholder="请输入" />)

    expect(html).toContain('octo-ui-input')
    expect(html).toContain('octo-ui-input--default')
    expect(html).toContain('value="Octo"')
    expect(html).toContain('placeholder="请输入"')
  })

  it('supports size aliases, status, prefix, suffix, and disabled', () => {
    const html = renderToStaticMarkup(
      <Input
        disabled
        error
        prefix={<span data-prefix="protocol" />}
        size="md"
        suffix={<span data-suffix="domain" />}
      />,
    )

    expect(html).toContain('octo-ui-input--default')
    expect(html).toContain('octo-ui-input--error')
    expect(html).toContain('octo-ui-input--disabled')
    expect(html).toContain('octo-ui-input--has-prefix')
    expect(html).toContain('octo-ui-input--has-suffix')
    expect(html).toContain('data-status="error"')
  })

  it('renders search as a round input with the search icon', () => {
    const html = renderToStaticMarkup(<Input.Search placeholder="搜索" />)

    expect(html).toContain('octo-ui-input--round')
    expect(html).toContain('data-icon="search"')
  })

  it('renders error message with icon and text', () => {
    const html = renderToStaticMarkup(<Input.ErrorMessage>请输入正确的内容</Input.ErrorMessage>)

    expect(html).toContain('octo-ui-input-error')
    expect(html).toContain('data-icon="alert-circle"')
    expect(html).toContain('请输入正确的内容')
  })
})

describe('Input.TextArea', () => {
  it('renders textarea classes and count', () => {
    const html = renderToStaticMarkup(
      <Input.TextArea defaultValue="abc" maxCount={200} placeholder="待填" />,
    )

    expect(html).toContain('octo-ui-textarea')
    expect(html).toContain('octo-ui-textarea--with-count')
    expect(html).toContain('octo-ui-textarea__control')
    expect(html).toContain('3/200')
  })

  it('supports error state and exceeded count', () => {
    const html = renderToStaticMarkup(
      <Input.TextArea status="error" value="abcdef" maxCount={3} />,
    )

    expect(html).toContain('octo-ui-textarea--error')
    expect(html).toContain('octo-ui-textarea__count--exceeded')
  })
})
