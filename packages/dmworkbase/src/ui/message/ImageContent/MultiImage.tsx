import React from 'react'
import './index.css'
import SingleImage, { ImageTransferState } from './SingleImage'

export interface ImageItem {
  src: string
  width: number
  height: number
  transferState?: ImageTransferState
}

export interface MultiImageProps {
  /** 图片列表 */
  images: ImageItem[]

  /** 点击图片回调 */
  onImageClick?: (index: number) => void

  /** 多图整体发送/上传状态 */
  transferState?: ImageTransferState
}

/**
 * 多图消息组件
 *
 * @description 显示多张图片，纵向堆叠，每张独立渲染（Figma B-8）
 *
 * 布局规则：
 * - 纵向堆叠（VERTICAL）
 * - 每张图片按 SingleImage 规则显示（最大 660×372）
 * - gap：8px
 */
export default function MultiImage({
  images,
  onImageClick,
  transferState
}: MultiImageProps) {
  return (
    <div className="wk-msg-multi-image">
      {images.map((img, index) => (
        <SingleImage
          key={index}
          src={img.src}
          width={img.width}
          height={img.height}
          transferState={img.transferState || transferState}
          onClick={onImageClick ? () => onImageClick(index) : undefined}
        />
      ))}
    </div>
  )
}
