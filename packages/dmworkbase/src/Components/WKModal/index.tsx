import React from 'react'
import { Modal } from '@douyinfe/semi-ui'
import { IconClose } from '@douyinfe/semi-icons'
import WKButton from '../WKButton'
import './index.css'

export type WKModalSize = 'md' | 'lg' | 'full'
// md = 400px（默认，覆盖原 380/400/420）
// lg = 720px（内容展示）
// full = '80%'（全局搜索等大型面板）

export interface WKModalFooterConfig {
  okText?: string
  cancelText?: string
  /** 确认按钮的加载状态 */
  isOkLoading?: boolean
  /** 确认按钮变为危险色（用于删除等操作） */
  isDanger?: boolean
  onOk?: () => void | Promise<void>
}

export interface WKModalProps {
  visible: boolean
  onCancel: () => void
  /** 标题；传 null 则不渲染 header 区域 */
  title?: React.ReactNode
  /** 预设尺寸，默认 'md'（400px）；与 width 同时传时 width 优先 */
  size?: WKModalSize
  /** 自定义宽度，优先级高于 size */
  width?: number | string
  /** 完全自定义 footer JSX；传此项时忽略 footerConfig */
  footer?: React.ReactNode
  /** 便捷 footer 配置，渲染标准 ok/cancel 按钮行 */
  footerConfig?: WKModalFooterConfig
  /** 行为开关 */
  options?: {
    /** 是否显示关闭按钮，默认 true */
    closable?: boolean
    /** 点击遮罩是否关闭，默认 true */
    maskClosable?: boolean
    /** 是否显示遮罩，默认 true */
    mask?: boolean
    /** 按 Esc 是否关闭，默认 true */
    closeOnEsc?: boolean
  }
  /** 透传给 Semi Modal 的 style */
  style?: React.CSSProperties
  /** 透传给 Semi Modal body 的 style */
  bodyStyle?: React.CSSProperties
  /** 自定义 header ReactNode（完全替换默认 header） */
  header?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

const SIZE_MAP: Record<WKModalSize, number | string> = {
  md: 400,
  lg: 720,
  full: '80%',
}

function resolveFooter(
  footer: React.ReactNode | undefined,
  footerConfig: WKModalFooterConfig | undefined,
  onCancel: () => void,
): React.ReactNode {
  // 显式传了 footer JSX（包括空字符串等 falsy 要排除，但 null 表示"不渲染"）
  if (footer !== undefined) {
    return footer === null ? null : footer
  }
  if (footerConfig?.onOk) {
    const { okText = '确定', cancelText = '取消', isOkLoading, isDanger, onOk } = footerConfig
    return (
      <div className="wk-modal-footer">
        <WKButton variant="secondary" onClick={onCancel}>
          {cancelText}
        </WKButton>
        <WKButton
          variant={isDanger ? 'danger' : 'primary'}
          loading={isOkLoading}
          onClick={onOk}
        >
          {okText}
        </WKButton>
      </div>
    )
  }
  // 都没有 → 不渲染 footer（项目主流模式）
  return null
}

const WKModal: React.FC<WKModalProps> = ({
  visible,
  onCancel,
  title,
  size = 'md',
  width: customWidth,
  footer,
  footerConfig,
  options,
  style,
  bodyStyle,
  header: customHeader,
  className,
  children,
}) => {
  const closable = options?.closable ?? true
  const maskClosable = options?.maskClosable ?? true
  const mask = options?.mask ?? true
  const closeOnEsc = options?.closeOnEsc ?? true
  const width = customWidth ?? SIZE_MAP[size as WKModalSize]
  const resolvedFooter = resolveFooter(footer, footerConfig, onCancel)

  const cls = ['wk-modal', className].filter(Boolean).join(' ')

  // 当 title=null 且 closable=true 时，需要自定义关闭按钮
  // 因为 Semi Modal 的关闭按钮依赖 header，title=null 时 header 不渲染导致按钮位置错位
  const needCustomCloseBtn = title === null && closable

  return (
    <Modal
      visible={visible}
      onCancel={onCancel}
      title={customHeader ? undefined : title}
      header={customHeader}
      width={width}
      footer={resolvedFooter}
      closable={needCustomCloseBtn ? false : closable} // 自定义关闭按钮时禁用 Semi 默认按钮
      maskClosable={maskClosable}
      mask={mask}
      closeOnEsc={closeOnEsc}
      centered
      className={cls}
      style={style}
      bodyStyle={bodyStyle}
    >
      {needCustomCloseBtn && (
        <button
          className="wk-modal-custom-close-btn"
          onClick={onCancel}
          aria-label="关闭"
        >
          <IconClose />
        </button>
      )}
      {children}
    </Modal>
  )
}

export default WKModal
export { WKModal }
