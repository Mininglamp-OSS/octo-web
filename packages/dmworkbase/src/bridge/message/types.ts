/**
 * Message UI Bridge Types
 * 
 * 这些类型定义了 UI 组件需要的数据结构。
 * Bridge 层负责从业务数据（MessageWrap）转换成这些类型。
 * UI 组件只依赖这些类型，不直接引用 WKSDK / WKApp。
 */

/**
 * 消息行容器 Props
 * 
 * @description 控制消息行的整体布局、头像、时间戳、选择状态等
 */
export interface MessageRowUIProps {
  /** 是否为发送方消息（控制布局方向） */
  isSend: boolean
  
  /** 是否为连续消息（同一发送者的连续消息，头像占位但隐藏） */
  isContinue: boolean
  
  /** 是否被选中（多选模式） */
  isSelected: boolean
  
  /** 是否显示头像 */
  showAvatar: boolean
  
  /** 头像 URL */
  avatarUrl: string
  
  /** 发送者名称 */
  senderName: string

  /** 发送者是否为 bot（用于显示 AI 标识） */
  isBot?: boolean

  /**
   * 发送者是否为群入站 Webhook（FromUID = iwh_*，永远不是群成员）。
   * 为 true 时名称/头像来自消息 payload 的 `from` 元信息（bridge 层已解析），
   * 名称旁渲染 Webhook 标识，且头像/名称不可点击（无个人资料页）。
   */
  isWebhook?: boolean

  /** 时间戳（格式化后的字符串，如 "10:30" 或 "2026-03-28 10:30:12"） */
  timestamp: string

  /** 仅时间部分（HH:mm），用于连续消息 hover 时显示 */
  timeOnly?: string
  
  /** 发送者是否在线（可选，用于显示在线状态点） */
  isOnline?: boolean
  
  /** 选择状态变化回调 */
  onSelect?: (selected: boolean) => void

  /** 当前消息是否显示多选 Checkbox */
  showCheckbox?: boolean

  /** 当前是否处于多选模式（当前消息不可选时也可为 true） */
  selectionMode?: boolean

  /** 头像点击回调（私聊场景：点头像打开私聊） */
  onAvatarClick?: (e: React.MouseEvent) => void

  /** 发送者名称点击回调（@ 场景：点名字展示用户信息） */
  onSenderNameClick?: () => void
  
  /** 消息是否被编辑过（显示「已编辑」标签） */
  isEdit?: boolean

  /**
   * 相对当前查看 Space，发送者是否来自外部 Space。
   * 由 bridge 层调用 `resolveExternalForViewer` 计算（基于 message.fromHomeSpaceId
   * 等字段），UI 只做渲染，不直接依赖 WKApp / WKSDK。
   */
  isExternal?: boolean

  /**
   * 外部来源 Space 名称（相对当前查看 Space 解析后）。
   * 非空且 `isExternal === true` 时，在昵称后以 `@{sourceSpaceName}` 形式
   * 内联展示，与新组件 `wk-msg-head-space` 行为对齐（dmwork-web#1069）。
   */
  sourceSpaceName?: string

  /**
   * 发送者是否已完成 OCTO 实名认证（Epic dmwork-web#1169 Phase A）。
   * 为 true 时在发送者名右侧紧贴渲染 `<RealnameVerifiedBadge variant="icon" />`
   * 迷你蓝色 ✓ 圆点。Bridge 层优先从群成员 orgData 读取 `realname_verified`，
   * 回落到 Person channelInfo.orgData。未实名 / AI / 字段缺失：一律不渲染
   * （不加灰色 badge / 警告标，以免给未实名用户施压）。
   */
  isRealnameVerified?: boolean

  /** 消息内容（子组件） */
  children: React.ReactNode
}

/**
 * 消息气泡 Props
 * 
 * @description 控制消息气泡的形态、圆角、背景色
 */
export interface BubbleUIProps {
  /** 气泡位置（影响圆角） */
  position: 'single' | 'first' | 'middle' | 'last'
  
  /** 是否为发送方消息（控制背景色和对齐方向） */
  isSend: boolean
  
  /** 自定义样式（用于特殊消息类型，如大表情透明背景） */
  style?: React.CSSProperties
  
  /** 气泡内容 */
  children: React.ReactNode
}

/**
 * 头像 Props
 */
export interface AvatarUIProps {
  /** 头像 URL */
  src: string
  
  /** 头像尺寸（默认 32px） */
  size?: number
  
  /** 是否在线 */
  isOnline?: boolean
  
  /** 是否显示在线状态点 */
  showOnlineDot?: boolean
  
  /** alt 文本 */
  alt?: string
}

/**
 * 时间戳 Props
 */
export interface TimestampUIProps {
  /** 时间戳（毫秒或秒） */
  time: number | string
  
  /** 格式化选项（可选，默认 "HH:mm"） */
  format?: string
}

/**
 * 系统通知 Tag Props
 * 
 * @description 居中胶囊样式，用于入群、撤回、截屏等系统消息
 */
export interface SystemTagUIProps {
  /** 通知文本 */
  text: string
  
  /** 小头像 URL（可选，如入群通知显示被邀请人头像） */
  avatarUrl?: string
  
  /** 关闭按钮点击回调 */
  onClose?: () => void
}

/**
 * Thread 回复统计徽章 Props
 * 
 * @description 显示在 Thread 父消息底部的回复统计信息
 */
export interface ThreadBadgeUIProps {
  /** 回复数量 */
  replyCount: number
  
  /** 参与者列表（最多显示 4 个头像） */
  participants: Array<{
    uid: string
    avatarUrl: string
  }>
  
  /** 最后回复时间（格式化后的字符串，如 "5分钟前"） */
  lastReplyTime: string
  
  /** 点击回调 */
  onClick?: () => void
}

/**
 * Thread 父消息容器 Props
 * 
 * @description 带灰背景 + 左侧蓝条的消息容器
 */
export interface ThreadParentUIProps {
  /** 消息内容 */
  children: React.ReactNode
  
  /** 回复数量 */
  replyCount: number
  
  /** 参与者列表 */
  participants: Array<{
    uid: string
    avatarUrl: string
  }>
  
  /** 最后回复时间 */
  lastReplyTime: string
  
  /** 点击 Thread 徽章回调 */
  onThreadClick?: () => void
}

/**
 * 文本消息内容 Props
 */
export interface TextContentUIProps {
  /** 消息文本内容（支持 Markdown） */
  content: string

  /** 是否为发送方消息 */
  isSend: boolean

  /** @ 提及列表 */
  mentions?: MentionInfo[]

  /** Emoji 列表 */
  emojis?: EmojiInfo[]

  /** 是否为大表情（单个自定义 emoji） */
  isLargeEmoji?: boolean

  /** 是否为流式消息（正在流式输出中） */
  isStreaming?: boolean

  /** 点击 @ 提及回调 */
  onMentionClick?: (uid: string) => void
}

/**
 * @ 提及信息
 */
export interface MentionInfo {
  /** 显示名称（如 "@Thomas AI"） */
  name: string
  
  /** 用户 UID */
  uid: string
  
  /** @ 类型（可选，用于区分 @个人 / @所有人 / @降级） */
  type?: 'entity' | 'highlight' | 'fallback'
}

/**
 * Emoji 信息
 */
export interface EmojiInfo {
  /** Emoji key（如 ":smile:" 或自定义 emoji ID） */
  key: string
  
  /** Emoji 图片 URL */
  url: string
}

/**
 * 单图消息内容 Props
 */
export interface SingleImageUIProps {
  /** 图片 URL */
  src: string
  
  /** 原始宽度 */
  width: number
  
  /** 原始高度 */
  height: number
  
  /** 点击回调 */
  onClick?: () => void
}

/**
 * 多图消息内容 Props
 */
export interface MultiImageUIProps {
  /** 图片列表 */
  images: Array<{
    src: string
    width: number
    height: number
  }>
  
  /** 点击回调 */
  onImageClick?: (index: number) => void
}

/**
 * AI 协作消息 - 复合发送者 Props
 */
export interface CompositeSenderUIProps {
  /** 发送者名称列表（如 ["Thomas AI", "AoLi"]） */
  names: string[]
  
  /** 状态标签（如 ["优", "暂离", "AI协作"]） */
  tags?: string[]
  
  /** 时间戳 */
  timestamp: string
}

/**
 * AI 协作消息 - 讨论记录 Props
 */
export interface DiscussionRecordsUIProps {
  /** 讨论记录列表 */
  records: Array<{
    sender: string
    time: string
    content: string
    tags?: string[]
  }>
  
  /** 是否展开 */
  isExpanded: boolean
  
  /** 折叠/展开回调 */
  onToggle?: () => void
}

/**
 * 多选工具栏 Props
 */
export interface SelectionToolbarUIProps {
  /** 已选中的消息数量 */
  selectedCount: number
  
  /** 逐条转发回调 */
  onForwardIndividual?: () => void
  
  /** 合并转发回调 */
  onForwardMerged?: () => void
  
  /** 删除回调 */
  onDelete?: () => void
}
