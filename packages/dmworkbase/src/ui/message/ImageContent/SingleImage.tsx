import React, { useRef, useState, useEffect } from 'react'
import { useI18n } from '../../../i18n'
import './index.css'

export interface ImageTransferState {
  status: 'sending' | 'uploading' | 'failed'
  progress?: number
  onRetry?: () => void
  labelKey?: string
}

export interface SingleImageProps {
  /** 图片 URL */
  src: string
  
  /** 原始宽度 */
  width: number
  
  /** 原始高度 */
  height: number
  
  /** 点击回调 */
  onClick?: () => void

  /** 图片发送/上传状态 */
  transferState?: ImageTransferState
}

const FALLBACK_MAX_WIDTH = 660
const MAX_HEIGHT = 372

/**
 * 单图消息组件
 *
 * @description 显示单张图片，宽度自适应容器（最大 660px），高度上限 372px，按比例缩放（Figma 334:14414）
 */
export default function SingleImage({
  src,
  width,
  height,
  onClick,
  transferState,
}: SingleImageProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const [maxWidth, setMaxWidth] = useState(FALLBACK_MAX_WIDTH)
  const isInteractive = !!onClick && !transferState

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const available = entry.contentRect.width
        // 容器实际宽度为 0 时（首次挂载前）用 fallback，否则取实际宽度上限
        setMaxWidth(available > 0 ? Math.min(available, FALLBACK_MAX_WIDTH) : FALLBACK_MAX_WIDTH)
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 按比例缩放
  let displayWidth = width
  let displayHeight = height

  if (width > maxWidth || height > MAX_HEIGHT) {
    const widthRatio = maxWidth / width
    const heightRatio = MAX_HEIGHT / height
    const ratio = Math.min(widthRatio, heightRatio)

    displayWidth = Math.round(width * ratio)
    displayHeight = Math.round(height * ratio)
  }

  const handleRetryKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!transferState?.onRetry) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      transferState.onRetry()
    }
  }

  const renderTransferOverlay = () => {
    if (!transferState) return null

    const pct = typeof transferState.progress === 'number'
      ? Math.max(0, Math.min(100, Math.round(transferState.progress)))
      : null
    const showProgress = transferState.status === 'uploading' && pct !== null
    const label = transferState.status === 'failed'
      ? t(transferState.labelKey || 'base.message.uploadFailedRetry')
      : transferState.status === 'uploading'
        ? t('base.message.uploading')
        : t('base.message.sending')

    if (transferState.status === 'failed') {
      return (
        <div
          className="wk-msg-image-transfer wk-msg-image-transfer--failed"
          role={transferState.onRetry ? 'button' : undefined}
          tabIndex={transferState.onRetry ? 0 : undefined}
          onClick={(event) => {
            event.stopPropagation()
            transferState.onRetry?.()
          }}
          onKeyDown={handleRetryKeyDown}
        >
          <span className="wk-msg-image-transfer-warning" aria-hidden="true">!</span>
          <span className="wk-msg-image-transfer-label">{label}</span>
        </div>
      )
    }

    return (
      <div
        className="wk-msg-image-transfer"
        aria-live="polite"
        aria-label={showProgress ? `${label} ${pct}%` : label}
      >
        {showProgress ? (
          <>
            <div className="wk-msg-image-transfer-progress">
              <div
                className="wk-msg-image-transfer-progress-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="wk-msg-image-transfer-label">{pct}%</span>
          </>
        ) : (
          <>
            <span className="wk-msg-image-transfer-spinner" aria-hidden="true" />
            <span className="wk-msg-image-transfer-label">{label}</span>
          </>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="wk-msg-single-image-wrap"
    >
      <div
        className="wk-msg-single-image"
        style={{ width: displayWidth, height: displayHeight }}
        onClick={isInteractive ? onClick : undefined}
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-busy={!!transferState || undefined}
      >
        <img
          src={src}
          alt=""
          width={displayWidth}
          height={displayHeight}
        />
        {renderTransferOverlay()}
      </div>
    </div>
  )
}
