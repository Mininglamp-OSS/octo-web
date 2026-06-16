import React from 'react'
import MessageRow, { MessageRowProps } from '../MessageRow'
import TextContent, { TextContentProps } from '../TextContent'
import ThreadParent, { ThreadParentProps } from '../ThreadParent'
import SingleImage, { SingleImageProps } from '../ImageContent/SingleImage'
import MultiImage, { MultiImageProps } from '../ImageContent/MultiImage'
import SystemMessage, { SystemMessageProps } from '../SystemMessage'

export interface MessageUIProps {
  /** 消息类型 */
  type: 'text' | 'thread' | 'image' | 'system'
  
  /** MessageRow 数据（系统消息不需要） */
  row?: MessageRowProps
  
  /** TextContent 数据（文本消息） */
  text?: TextContentProps
  
  /** ThreadParent 数据（Thread 父消息） */
  thread?: Omit<ThreadParentProps, 'children'>
  
  /** SingleImage 数据（单图消息） */
  singleImage?: SingleImageProps
  
  /** MultiImage 数据（多图消息） */
  multiImage?: MultiImageProps
  
  /** SystemMessage 数据（系统消息） */
  system?: SystemMessageProps
  
  /** 是否为多选模式 */
  selectionMode?: boolean
  
  /** 是否被选中 */
  isSelected?: boolean
  
  /** 选中状态变化回调 */
  onSelect?: (selected: boolean) => void
}

export interface MessageProps extends MessageUIProps {}

/**
 * 统一消息组件
 * 
 * @description 根据 UI Props 渲染对应的消息类型
 * 
 * 这是一个纯 UI 组件，接收预处理好的 UI 数据，不依赖业务 Model。
 * Bridge 层负责从 MessageWrap 转换为 MessageUIProps。
 */
export default function Message({
  type,
  row,
  text,
  thread,
  singleImage,
  multiImage,
  system,
  selectionMode = false,
  isSelected = false,
  onSelect,
}: MessageProps) {
  // 系统消息：居中显示，不需要 MessageRow
  if (type === 'system' && system) {
    return <SystemMessage {...system} />
  }
  
  // 其他消息：使用 MessageRow 容器
  if (!row) {
    console.warn('Message: row props required for non-system messages')
    return null
  }
  
  return (
    <MessageRow
      {...row}
      isSelected={isSelected}
      selectionMode={selectionMode}
      showCheckbox={selectionMode}
      onSelect={onSelect}
    >
      {renderContent(type, { text, thread, singleImage, multiImage })}
    </MessageRow>
  )
}

/**
 * 根据类型渲染内容
 */
function renderContent(
  type: MessageUIProps['type'],
  props: {
    text?: TextContentProps
    thread?: Omit<ThreadParentProps, 'children'>
    singleImage?: SingleImageProps
    multiImage?: MultiImageProps
  }
) {
  const { text, thread, singleImage, multiImage } = props
  
  // Thread 父消息
  if (type === 'thread' && thread && text) {
    return (
      <ThreadParent {...thread}>
        <TextContent {...text} />
      </ThreadParent>
    )
  }
  
  // 单图消息
  if (type === 'image' && singleImage) {
    return <SingleImage {...singleImage} />
  }
  
  // 多图消息
  if (type === 'image' && multiImage) {
    return <MultiImage {...multiImage} />
  }
  
  // 文本消息
  if (type === 'text' && text) {
    return <TextContent {...text} />
  }
  
  return null
}
