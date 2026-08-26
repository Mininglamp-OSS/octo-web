import React, { ReactNode } from 'react'
import './index.css'

export interface IconClickProps {
  icon: string | ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  /** 尺寸，影响 padding */
  size?: 'sm' | 'md'
  title?: string
  /** 埋点锚点：透传到根节点，供 Dap 规则表 fallback 命中（可选，不传即原行为，向后兼容）。 */
  'data-testid'?: string
}

const IconClick: React.FC<IconClickProps> = ({
  icon,
  onClick,
  disabled = false,
  className,
  size = 'md',
  title,
  'data-testid': dataTestId,
}) => {
  const cls = [
    'wk-iconclick',
    `wk-iconclick--${size}`,
    disabled ? 'wk-iconclick--disabled' : '',
    className || '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={cls}
      data-testid={dataTestId}
      onClick={() => { if (!disabled && onClick) onClick() }}
      role="button"
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title={title}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !disabled) { e.preventDefault(); onClick?.() } }}
    >
      {typeof icon === 'string' ? (
        <img src={icon} width={20} height={20} alt={title || ''} />
      ) : icon}
    </div>
  )
}

export default IconClick
