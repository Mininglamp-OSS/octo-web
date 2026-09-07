import React from 'react'
import { useI18n } from '../../i18n'
import './index.css'

export interface AITagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** AI 数量: 单个 AI 显示 "AI助手", 多个显示 "AI协作" */
  aiCount?: number
  size?: 'small' | 'xs'
}

/**
 * AI Tag 组件
 * 
 * @description 显示 AI 协作或 AI 助手标签,渐变背景
 */
export default function AITag({ aiCount = 1, size = 'small', className, children, ...props }: AITagProps) {
  const { t } = useI18n()
  const label = aiCount > 1 ? t('base.aiTag.collaboration') : t('base.aiTag.assistant')
  const classes = ['wk-ai-tag', `wk-ai-tag--${size}`, className].filter(Boolean).join(' ')
  
  return (
    <span className={classes} {...props}>
      {children ?? label}
    </span>
  )
}
