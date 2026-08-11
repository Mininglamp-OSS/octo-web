// 通用右键菜单。评论用它放「编辑 / 删除」,版本记录用它放「恢复 / 重命名」。
//
// 原本叫 CommentContextMenu、住在 comments/ 下,版本面板要用时才发现它跟评论没有任何耦合
// —— 挪到 ui/ 并改成中性命名,比在 versions/ 里 import 一个叫 Comment* 的东西诚实。
//
// 为什么把编辑和删除挪进右键:评论底部原本挂着「编辑 删除 解决 回复」四个按钮,四个平铺
// 在一起时破坏性的和常用的一样显眼,而「解决 / 回复」才是每天都点的。挪进右键后底部只留
// 那两个,视觉噪声降一半,删除也不再是手一滑就能点到的。
//
// ⚠️ 键盘可达性:只绑 onContextMenu 会让编辑/删除对键盘用户**彻底消失**(那是功能丢失,
// 不是样式问题)。所以同时支持 ContextMenu 键和 Shift+F10 —— 这是右键菜单在 Windows/Linux
// 上的标准键位,浏览器会把它们和 onKeyDown 一起交给我们。

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

export interface ContextMenuItem {
  key: string
  label: string
  onSelect: () => void
  /** 破坏性操作(删除),渲染成红色。 */
  danger?: boolean
}

export interface MenuAnchor {
  x: number
  y: number
}

/**
 * 右键菜单的开合状态。返回值直接摊到宿主元素上:
 *   <li {...menu.triggerProps}>… {menu.render(items)}</li>
 */
export function useContextMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)

  const openAt = useCallback((x: number, y: number) => setAnchor({ x, y }), [])
  const close = useCallback(() => setAnchor(null), [])

  const onContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault()
      // stopPropagation:嵌套结构(回复在根评论的 <li> 里)否则会同时开两个菜单,
      // 而且开的是外层那个 —— 对着回复右键却弹出根评论的编辑/删除,会删错东西。
      e.stopPropagation()
      openAt(e.clientX, e.clientY)
    },
    [openAt],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // ContextMenu 键,或 Shift+F10(同一功能的两个标准键位)。
      const wants = e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')
      if (!wants) return
      e.preventDefault()
      e.stopPropagation()
      // 键盘触发没有鼠标坐标,拿元素自身的位置当锚点。
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openAt(rect.left + 8, rect.top + 8)
    },
    [openAt],
  )

  return { anchor, close, triggerProps: { onContextMenu, onKeyDown } }
}

export function ContextMenu({
  anchor,
  items,
  onClose,
}: {
  anchor: MenuAnchor | null
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Esc 关闭 + 打开后把焦点移进菜单,否则键盘用户打开了也走不进去。
  useEffect(() => {
    if (!anchor) return
    ref.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [anchor, onClose])

  if (!anchor || items.length === 0) return null

  return (
    <>
      {/* 点空白处/再次右键都关掉。覆盖层吃掉这两个事件,免得穿透到下面的评论上。 */}
      <div
        className="octo-comment-ctx-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={ref}
        className="octo-comment-ctx-menu"
        role="menu"
        tabIndex={-1}
        style={{ left: anchor.x, top: anchor.y }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`octo-comment-ctx-item${item.danger ? ' is-danger' : ''}`}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
