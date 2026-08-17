import { forwardRef } from 'react'
import type { LegacyTagVariant, TagPaletteVariant, TagProps, TagTone } from './types'

const legacyVariantMap: Record<LegacyTagVariant, [TagPaletteVariant, TagTone]> = {
  neutral: ['light', 'gray'],
  brand: ['light', 'purple'],
  success: ['light', 'green'],
  warning: ['light', 'amber'],
  danger: ['light', 'red'],
}

const normalizeAppearance = (variant: TagProps['variant'], tone?: TagTone) => {
  const legacyAppearance = variant && variant in legacyVariantMap
    ? legacyVariantMap[variant as LegacyTagVariant]
    : undefined

  return {
    variant: legacyAppearance?.[0] ?? variant ?? 'light',
    tone: tone ?? legacyAppearance?.[1] ?? 'gray',
  }
}

const normalizeSize = (size: TagProps['size']) => {
  if (size === 'sm') return 'small'
  if (size === 'md') return 'default'
  return size ?? 'default'
}

const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  {
    variant,
    size,
    tone,
    icon,
    children,
    className,
    closable = false,
    closeAriaLabel,
    onClose,
    ...rest
  },
  ref,
) {
  const appearance = normalizeAppearance(variant, tone)
  const normalizedSize = normalizeSize(size)
  const classes = [
    'octo-ui-tag',
    `octo-ui-tag--${appearance.variant}`,
    `octo-ui-tag--${appearance.tone}`,
    `octo-ui-tag--${normalizedSize}`,
    className,
  ].filter(Boolean).join(' ')

  return (
    <span ref={ref} className={classes} {...rest}>
      {icon ? <span className="octo-ui-tag__icon" aria-hidden="true">{icon}</span> : null}
      <span className="octo-ui-tag__label">{children}</span>
      {closable ? (
        <button
          className="octo-ui-tag__close"
          type="button"
          aria-label={closeAriaLabel}
          onClick={(event) => {
            event.stopPropagation()
            onClose?.(event)
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
            <path
              d="M11.7712 13.1855C12.1617 13.576 12.7949 13.576 13.1854 13.1855C13.5759 12.795 13.5759 12.1618 13.1854 11.7713L9.41416 8.00007L13.1854 4.22884C13.5759 3.83831 13.5759 3.20515 13.1854 2.81462C12.7949 2.4241 12.1617 2.4241 11.7712 2.81462L7.99995 6.58586L4.22871 2.81462C3.83819 2.4241 3.20502 2.4241 2.8145 2.81462C2.42398 3.20515 2.42398 3.83831 2.8145 4.22884L6.58574 8.00007L2.8145 11.7713C2.42398 12.1618 2.42398 12.795 2.8145 13.1855C3.20502 13.576 3.83819 13.576 4.22871 13.1855L7.99995 9.41428L11.7712 13.1855Z"
              fill="currentColor"
            />
          </svg>
        </button>
      ) : null}
    </span>
  )
})

export default Tag
export { Tag }
