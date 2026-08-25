import { forwardRef, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { TabItem, TabsProps } from './types'

let tabsInstance = 0

const firstEnabledKey = (items: readonly TabItem[]) => items.find((item) => !item.isDisabled)?.key

const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    items,
    activeKey,
    defaultActiveKey,
    onChange,
    size = 'md',
    variant = 'line',
    className,
    id,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...rest
  },
  ref
) {
  const isControlled = activeKey !== undefined
  const [generatedId] = useState(() => `octo-ui-tabs-${++tabsInstance}`)
  const baseId = id ?? generatedId
  const [internalKey, setInternalKey] = useState(() => {
    const defaultItem = items.find((item) => item.key === defaultActiveKey && !item.isDisabled)
    return defaultItem?.key ?? firstEnabledKey(items)
  })
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const uncontrolledItem = items.find((item) => item.key === internalKey && !item.isDisabled)
  const resolvedKey = isControlled
    ? items.find((item) => item.key === activeKey)?.key
    : uncontrolledItem?.key ?? firstEnabledKey(items)
  const selectedItem = items.find((item) => item.key === resolvedKey)
  const focusKey = selectedItem?.isDisabled ? firstEnabledKey(items) : resolvedKey ?? firstEnabledKey(items)

  useEffect(() => {
    if (!isControlled && internalKey !== resolvedKey) {
      setInternalKey(resolvedKey)
    }
  }, [internalKey, isControlled, resolvedKey])

  useEffect(() => {
    if (!resolvedKey) return
    tabRefs.current[resolvedKey]?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [resolvedKey])

  const activate = (item: TabItem) => {
    if (item.isDisabled || item.key === resolvedKey) return
    if (!isControlled) setInternalKey(item.key)
    onChange?.(item.key)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentKey: string) => {
    const enabledItems = items.filter((item) => !item.isDisabled)
    const currentIndex = enabledItems.findIndex((item) => item.key === currentKey)
    if (currentIndex < 0 || enabledItems.length === 0) return

    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % enabledItems.length
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + enabledItems.length) % enabledItems.length
    }
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = enabledItems.length - 1
    if (nextIndex === undefined) return

    event.preventDefault()
    const nextItem = enabledItems[nextIndex]
    tabRefs.current[nextItem.key]?.focus()
    activate(nextItem)
  }

  const classes = ['octo-ui-tabs', `octo-ui-tabs--${variant}`, `octo-ui-tabs--${size}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={ref} id={baseId} className={classes} {...rest}>
      <div className="octo-ui-tabs__list" role="tablist" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
        {items.map((item, index) => {
          const isActive = item.key === resolvedKey
          const hasPanel = item.children !== undefined
          const tabId = `${baseId}-tab-${index}`
          const panelId = `${baseId}-panel-${index}`

          return (
            <button
              key={item.key}
              ref={(node) => {
                tabRefs.current[item.key] = node
              }}
              id={tabId}
              className="octo-ui-tabs__tab"
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={isActive && hasPanel ? panelId : undefined}
              aria-disabled={item.isDisabled || undefined}
              disabled={item.isDisabled}
              tabIndex={item.key === focusKey ? 0 : -1}
              onClick={() => activate(item)}
              onKeyDown={(event) => handleKeyDown(event, item.key)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      {selectedItem?.children !== undefined ? (
        <div
          id={`${baseId}-panel-${items.indexOf(selectedItem)}`}
          className="octo-ui-tabs__panel"
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${items.indexOf(selectedItem)}`}
          tabIndex={0}
        >
          {selectedItem.children}
        </div>
      ) : null}
    </div>
  )
})

export default Tabs
export { Tabs }
