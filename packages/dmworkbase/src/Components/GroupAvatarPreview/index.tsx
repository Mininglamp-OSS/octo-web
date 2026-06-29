import React, { useEffect, useState } from "react"
import {
  GroupColorHex,
  getCachedPalette,
  fetchGroupAvatarPalette,
  colorAt,
} from "./palette"
import {
  cleanAvatarText,
  groupAvatarLines,
  colorIndexForName,
  groupNameText,
} from "./text"
import "./index.css"

export interface GroupAvatarPreviewProps {
  /** 自定义头像文字（≤4 可见字符），优先级最高 */
  avatarText?: string
  /** 色板下标；未指定（undefined/<0）时按 name 稳定派生（仅预览） */
  colorIndex?: number
  /** 群名：用于派生颜色，且 nameAsFallback 时用于取字 */
  name?: string
  /**
   * 无自定义文字时是否按群名取字（前 2 字，对齐服务端命名群 is_named=1 的渲染）。
   * 创建/命名群场景传 true，使预览与建群后服务端出图一致；缺省 false（→ 双人图标）。
   */
  nameAsFallback?: boolean
  /** 直径（px），默认 56 */
  size?: number
  className?: string
}

// GroupAvatarPreview 本地渲染群头像预览，与服务端 PNG 视觉对齐（浅底描边圆 + 主色文字 /
// 双人图标）。用于「修改头像」二次弹窗实时预览与「发起群聊」创建弹窗头像占位——建群/改群
// 前没有服务端真图，故在前端按同一色板与取字/换行规则复刻。
const GroupAvatarPreview: React.FC<GroupAvatarPreviewProps> = ({
  avatarText,
  colorIndex,
  name = "",
  nameAsFallback = false,
  size = 56,
  className,
}) => {
  const [palette, setPalette] = useState<GroupColorHex[]>(getCachedPalette())
  useEffect(() => {
    let active = true
    fetchGroupAvatarPalette().then((p) => {
      if (active) setPalette(p)
    })
    return () => {
      active = false
    }
  }, [])

  const idx =
    colorIndex != null && colorIndex >= 0
      ? colorIndex
      : colorIndexForName(name, palette.length)
  const color = colorAt(palette, idx)

  // 文字优先级：自定义文字 > （命名群场景）群名前 2 字 > 空（→ 双人图标）。
  const text =
    cleanAvatarText(avatarText ?? "") ||
    (nameAsFallback ? groupNameText(name) : "")
  const cls = ["wk-group-avatar-preview", className].filter(Boolean).join(" ")
  const style: React.CSSProperties = {
    width: size,
    height: size,
    background: color.fill,
    borderColor: color.main,
  }

  if (text) {
    const lines = groupAvatarLines(text)
    const fontSize = Math.round(size * (lines.length > 1 ? 0.3 : 0.4))
    return (
      <div className={cls} style={style}>
        <div
          className="wk-group-avatar-preview-text"
          style={{ color: color.main, fontSize }}
        >
          {lines.map((ln, i) => (
            <span key={i}>{ln}</span>
          ))}
        </div>
      </div>
    )
  }

  // 双人图标兜底（与服务端 RenderIcon 同构：后景人浅色 + 前景人主色）。
  const iconSize = Math.round(size * 0.62)
  return (
    <div className={cls} style={style}>
      <svg
        className="wk-group-avatar-preview-icon"
        viewBox="0 0 24 24"
        width={iconSize}
        height={iconSize}
        aria-hidden="true"
      >
        <g fill={color.iconBack}>
          <circle cx="15.5" cy="8.2" r="3.1" />
          <path d="M15.5 12.2c-3 0-5.4 1.9-6 4.4-.2.8.4 1.6 1.3 1.6h9.4c.9 0 1.5-.8 1.3-1.6-.6-2.5-3-4.4-6-4.4Z" />
        </g>
        <g fill={color.main}>
          <circle cx="9" cy="8.8" r="3.4" />
          <path d="M9 13c-3.3 0-6 2.1-6.6 4.9-.2.9.5 1.7 1.4 1.7h10.4c.9 0 1.6-.8 1.4-1.7C15 15.1 12.3 13 9 13Z" />
        </g>
      </svg>
    </div>
  )
}

export default GroupAvatarPreview
export { GroupAvatarPreview }
