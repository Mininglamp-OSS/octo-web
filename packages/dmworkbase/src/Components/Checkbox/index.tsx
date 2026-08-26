import React from 'react'
import './index.css'

export interface CheckboxProps {
  checked?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  /** @deprecated 用 onChange 代替 */
  onCheck?: () => void
  className?: string
  children?: React.ReactNode
  /** Accessible name for a checkbox with no visible <label> text association (icon-only rows). */
  ariaLabel?: string
}

const Checkbox: React.FC<CheckboxProps> = ({
  checked = false,
  disabled = false,
  onChange,
  onCheck,
  className,
  children,
  ariaLabel,
}) => {
  const handleClick = () => {
    if (disabled) return
    if (onChange) onChange(!checked)
    else if (onCheck) onCheck()
  }

  return (
    <div
      className={['wk-checkbox', checked ? 'wk-checkbox--checked' : '', disabled ? 'wk-checkbox--disabled' : '', className || ''].filter(Boolean).join(' ')}
      onClick={handleClick}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleClick() } }}
    >
      <span className="wk-checkbox__box">
        {checked && (
          <svg className="wk-checkbox__check" viewBox="0 0 12 10" fill="none">
            <path d="M1 5L4.5 8.5L11 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children && <span className="wk-checkbox__label">{children}</span>}
    </div>
  )
}

export default Checkbox
