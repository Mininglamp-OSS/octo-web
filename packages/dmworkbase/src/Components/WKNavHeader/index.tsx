import React, { ReactNode } from 'react'
import './index.css'

export interface WKNavHeaderProps {
  title: string
  rightView?: ReactNode
  className?: string
}

const WKNavHeader: React.FC<WKNavHeaderProps> = ({ title, rightView, className }) => (
  <div data-desktop-chrome="header" className={['wk-navheader', className || ''].filter(Boolean).join(' ')}>
    <div className="wk-navheader__content" data-desktop-chrome="layout">
      <div className="wk-navheader__title">{title}</div>
      {rightView && <div className="wk-navheader__right">{rightView}</div>}
    </div>
  </div>
)

export default WKNavHeader
