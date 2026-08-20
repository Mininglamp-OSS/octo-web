import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Select from './index'

vi.mock('@douyinfe/semi-icons', () => ({
  IconChevronDown: ({ size }: { size?: string }) => <span data-icon="chevron-down" data-size={size} />,
  IconClear: ({ size }: { size?: string }) => <span data-icon="clear" data-size={size} />,
  IconInbox: ({ className }: { className?: string }) => <span className={className} data-icon="inbox" />,
  IconTick: ({ size }: { size?: string }) => <span data-icon="tick" data-size={size} />,
}))

vi.mock('@douyinfe/semi-ui', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  const Option = ({ children, label, value, disabled }: any) => (
    <div data-disabled={String(Boolean(disabled))} data-value={value}>
      {children ?? label}
    </div>
  )

  const Select = React.forwardRef<HTMLDivElement, any>(function MockSelect(
    {
      children,
      className,
      dropdownClassName,
      emptyContent,
      multiple,
      optionList,
      placeholder,
      renderOptionItem,
      showArrow,
      showClear,
      triggerRender,
      validateStatus,
      value,
      maxHeight,
      ...rest
    },
    ref,
  ) {
    const options = optionList ?? []
    const valueArray = Array.isArray(value) ? value : value === undefined ? [] : [value]
    const selected = options
      .filter((option: any) => valueArray.includes(option.value))
      .map((option: any) => ({ ...option, _selected: true }))

    return (
      <div
        {...rest}
        ref={ref}
        className={className}
        data-dropdown-class={dropdownClassName}
        data-multiple={String(Boolean(multiple))}
        data-show-arrow={String(Boolean(showArrow))}
        data-show-clear={String(Boolean(showClear))}
        data-status={validateStatus}
        data-max-height={maxHeight}
      >
        {triggerRender?.({
          componentProps: { multiple, showArrow, size: rest.size, showClear },
          placeholder,
          value: selected,
        })}
        <div data-testid="options">
          {options.length
            ? options.map((option: any) => renderOptionItem?.({ ...option, selected: valueArray.includes(option.value) }))
            : emptyContent}
          {children}
        </div>
      </div>
    )
  }) as any
  Select.Option = Option

  const LocaleConsumer = ({ children }: any) => children({ emptyText: 'No options' })

  return { LocaleConsumer, Select }
})

describe('Select', () => {
  it('renders Octo trigger and option classes', () => {
    const html = renderToStaticMarkup(
      <Select
        value="asc"
        optionList={[
          { value: 'asc', label: '时间正序' },
          { value: 'desc', label: '时间倒序' },
        ]}
      />,
    )

    expect(html).toContain('octo-ui-select')
    expect(html).toContain('octo-ui-select--default')
    expect(html).toContain('octo-ui-select__trigger-inner')
    expect(html).toContain('octo-ui-select-option')
    expect(html).toContain('octo-ui-select-option--selected')
    expect(html).toContain('时间正序')
  })

  it('supports multiple values and clearable trigger state', () => {
    const html = renderToStaticMarkup(
      <Select
        clearable
        clearAriaLabel="Clear selection"
        multiple
        removeOptionAriaLabel="Remove option"
        value={['frontend', 'design']}
        optionList={[
          { value: 'frontend', label: '前端' },
          { value: 'design', label: '设计' },
        ]}
      />,
    )

    expect(html).toContain('data-multiple="true"')
    expect(html).toContain('data-show-clear="true"')
    expect(html).toContain('octo-ui-select__chip')
    expect(html).toContain('前端')
    expect(html).toContain('设计')
  })

  it('renders disabled, status, size, placeholder, and empty content', () => {
    const html = renderToStaticMarkup(
      <Select
        disabled
        placeholder="选择项目"
        optionList={[]}
        size="small"
        status="error"
      />,
    )

    expect(html).toContain('octo-ui-select--small')
    expect(html).toContain('octo-ui-select--error')
    expect(html).toContain('选择项目')
    expect(html).toContain('No options')
    expect(html).toContain('octo-ui-select-empty__icon')
    expect(html).toContain('data-icon="inbox"')
  })

  it('wraps string empty content with the Octo empty state layout', () => {
    const html = renderToStaticMarkup(
      <Select
        emptyContent="No matching options"
        placeholder="搜索结果"
        optionList={[]}
      />,
    )

    expect(html).toContain('octo-ui-select-empty')
    expect(html).toContain('octo-ui-select-empty__text')
    expect(html).toContain('No matching options')
  })

  it('keeps children Option API available', () => {
    const html = renderToStaticMarkup(
      <Select value="one">
        <Select.Option value="one">One</Select.Option>
      </Select>,
    )

    expect(html).toContain('One')
  })

  it('respects option showTick=false for compatibility', () => {
    const html = renderToStaticMarkup(
      <Select
        value="zh-CN"
        optionList={[
          { value: 'zh-CN', label: '中文', showTick: false },
          { value: 'en-US', label: 'EN', showTick: false },
        ]}
      />,
    )

    expect(html).not.toContain('data-icon="tick"')
  })

  it('uses the design option-list max height by default', () => {
    const html = renderToStaticMarkup(
      <Select
        optionList={[
          { value: 'one', label: 'One' },
        ]}
      />,
    )

    expect(html).toContain('data-max-height="268"')
  })
})
