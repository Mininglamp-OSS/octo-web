import React from 'react'
import { useI18n } from '../../i18n'
import AITag from '../AITag'
import './index.css'

export interface AIParticipant {
  id: string
  name: string
  avatar: string
}

export interface AIMessageCardProps {
  /** AI 参与者列表 */
  participants: AIParticipant[]
  
  /** 消息内容预览 */
  content: string
  
  /** 消息数量 */
  messageCount: number
  
  /** 是否展开 */
  isExpanded?: boolean
  
  /** 展开/收起回调 */
  onToggle?: () => void
}

/**
 * AI 消息卡片组件
 * 
 * @description 显示 AI 协作消息的折叠卡片
 * 
 * 设计规范:
 * - 左边条: 4px 蓝紫渐变
 * - AI Tag: 渐变背景,单AI显示"AI助手",多AI显示"AI协作"
 * - 超过5个AI折叠显示,hover展开tooltip
 * - "展开X条讨论"链接: 深紫色 #7D58F5
 */
export default function AIMessageCard({
  participants,
  content,
  messageCount,
  isExpanded = false,
  onToggle,
}: AIMessageCardProps) {
  const { t } = useI18n()
  const isMultiAI = participants.length > 1
  const tagLabel = isMultiAI ? t('base.aiMessageCard.collaboration') : t('base.aiMessageCard.assistant')
  const shouldCollapse = participants.length > 5
  
  // 参与者名字显示
  let participantNames: string
  if (shouldCollapse) {
    participantNames = t('base.aiMessageCard.collapsedParticipants', {
      values: { name: participants[0].name, count: participants.length },
    })
  } else {
    participantNames = participants.map(p => p.name).join(' × ')
  }
  
  return (
    <div className="wk-ai-message-card">
      {/* 左边条 (渐变) */}
      <div className="wk-ai-message-card__border" />
      
      <div className="wk-ai-message-card__content">
        {/* 头部区域 */}
        <div className="wk-ai-message-card__header">
          {/* AI 头像堆叠 */}
          <div className="wk-ai-message-card__avatars">
            {participants.slice(0, 3).map((p, idx) => (
              <img
                key={p.id}
                src={p.avatar}
                alt={p.name}
                className="wk-ai-message-card__avatar"
                style={{ marginLeft: idx > 0 ? '-8px' : 0 }}
              />
            ))}
          </div>
          
          {/* AI 名字 (渐变) */}
          <span className="wk-ai-message-card__names">
            {participantNames}
          </span>
          
          {/* AI Tag */}
          <AITag>
            {tagLabel}
          </AITag>
          
          {/* 展开/收起按钮 */}
          <button
            type="button"
            className="wk-ai-message-card__toggle"
            onClick={onToggle}
          >
            {isExpanded
              ? t('base.aiMessageCard.collapse')
              : t('base.aiMessageCard.expandDiscussions', { values: { count: messageCount } })}
          </button>
        </div>
        
        {/* 消息内容预览 */}
        {!isExpanded && (
          <div className="wk-ai-message-card__preview">
            {content}
          </div>
        )}
        
        {/* Tooltip (超过5个AI时显示) */}
        {shouldCollapse && (
          <div className="wk-ai-message-card__tooltip">
            {participants.map(p => (
              <div key={p.id} className="wk-ai-message-card__tooltip-item">
                <img src={p.avatar} alt={p.name} />
                <span>{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
