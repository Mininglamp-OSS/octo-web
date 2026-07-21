import React from "react"
import ReactDOM from "react-dom"

import MessageReactionPicker from "./index"
import { DEFAULT_FREQUENT, DEFAULT_TOKENS, type PickerEmoji } from "./data"
import { reactionMockStore } from "../MessageReactionSummary/mockStore"
import { EmojiPanel } from "../../../Components/EmojiToolbar"
import { t } from "../../../i18n"
import WKApp from "../../../App"

/**
 * ⚠️ DEMO-ONLY 命令式 popover 单例，随 feature flag 一同存在。
 *
 * 右键菜单「贴表情」和消息 reaction summary 的「+」按钮都调 open() 在点击位置
 * 弹出 quick-pick 浮窗。点其中的「更多」再弹完整表情面板（复用 EmojiPanel，
 * hideStickerTab 过滤贴纸 tab）。选中 emoji 后走本地 mock store 的 toggle。
 *
 * 交互取舍：右键菜单点「贴表情」后菜单关闭、picker 以独立浮窗弹出（非企微式
 * 二级子菜单）。这样无需改动共享 ContextMenus 组件，改动面最小。
 *
 * 生产化时替换点：
 * - onSelect/onEmoji 改为调 datasource 的 reactMessage/unreactMessage（见 spec）
 * - 定位逻辑可抽出与 EmojiToolbar.computePanelPos 共用
 * - selectedKeys 从真实 message.reactions 读取
 */

const PICKER_W = 264
const PICKER_H = 100
const FULL_W = 360
const FULL_H = 340
const MARGIN = 8

interface OpenOptions {
  /** 触发点视口坐标（右键 event.clientX/Y 或 + 按钮 rect） */
  x: number
  y: number
  messageId: string
}

// 记录最后一次指针位置，供右键菜单项 onClick（拿不到 event）定位 picker。
// 关键：监听不在模块加载时安装（否则 flag 关的生产会话也会永久挂上全局 capture
// 监听，违背「flag OFF = 运行时 no-op」的承诺）。改为由 enablePointerTracking()
// 在 feature flag 打开时显式、幂等安装，disablePointerTracking() 拆除。
const lastPointer = { x: 0, y: 0 }
let pointerTrackingOn = false

function trackPointer(e: MouseEvent): void {
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
}

/** feature flag 打开时安装指针追踪（幂等）。flag 关时永不调用 → 零全局副作用。 */
export function enablePointerTracking(): void {
  if (pointerTrackingOn || typeof document === "undefined") return
  document.addEventListener("contextmenu", trackPointer, true)
  document.addEventListener("mousedown", trackPointer, true)
  pointerTrackingOn = true
}

/** 拆除指针追踪（对称清理，便于 HMR / 关闭功能 / 测试）。 */
export function disablePointerTracking(): void {
  if (!pointerTrackingOn || typeof document === "undefined") return
  document.removeEventListener("contextmenu", trackPointer, true)
  document.removeEventListener("mousedown", trackPointer, true)
  pointerTrackingOn = false
}

/** 把浮窗尺寸夹进视口，优先在点击点上方弹出（贴近右键菜单习惯），空间不足则下方。 */
function clampPosition(x: number, y: number, w: number, h: number) {
  const left = Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN))
  const above = y - h - MARGIN
  // fallback（下方）分支同样要 Math.max(MARGIN, …)，否则视口高度 < h+MARGIN 时
  // top 变负、顶部表情不可见。
  const top =
    above >= MARGIN
      ? above
      : Math.max(MARGIN, Math.min(y + MARGIN, window.innerHeight - h - MARGIN))
  return { left, top }
}

function currentUid(): string {
  return WKApp.loginInfo?.uid || "__me__"
}

class ReactionPickerOverlayController {
  private container: HTMLDivElement | null = null
  /** 打开前的焦点元素，关闭时归还（键盘可达性）。 */
  private prevFocus: HTMLElement | null = null

  /** 在最后已知指针位置弹出（右键菜单「贴表情」用，onClick 拿不到 event）。 */
  openAtLastPointer(messageId: string): void {
    this.open({ x: lastPointer.x, y: lastPointer.y, messageId })
  }

  open(opts: OpenOptions): void {
    const { left, top } = clampPosition(opts.x, opts.y, PICKER_W, PICKER_H)

    const mineKeys = reactionMockStore
      .get(opts.messageId)
      .filter((r) => r.uid === currentUid())
      .map((r) => r.reactionKey)

    this.render(
      <div style={{ position: "fixed", left, top, zIndex: 9999 }}>
        <MessageReactionPicker
          tokens={DEFAULT_TOKENS}
          frequentlyUsed={DEFAULT_FREQUENT}
          selectedKeys={mineKeys}
          moreLabel={t("base.reaction.more")}
          onSelect={(emoji: PickerEmoji) => {
            // token 用 char（[xxx]），emoji 用 unicode 字符，均作 reactionKey
            reactionMockStore.toggle(opts.messageId, emoji.char, emoji.char)
            this.close()
          }}
          onMore={() => this.openFull(opts)}
        />
      </div>,
    )
  }

  /**
   * 「更多」→ 完整表情面板（复用 EmojiPanel，隐藏贴纸 tab），同样以浮窗呈现。
   *
   * 已知限制（demo）：EmojiPanel 未接 selectedKeys，完整面板不高亮「已选」reaction，
   * 且点击已选项会静默取消（toggle）。与 quick-pick 的高亮不一致 —— 补齐需给共享
   * EmojiPanel 增加 selectedKeys 支持（会影响消息输入区用法），故 demo 阶段暂不做。
   */
  private openFull(opts: OpenOptions): void {
    const { left, top } = clampPosition(opts.x, opts.y, FULL_W, FULL_H)
    this.render(
      <div
        style={{
          position: "fixed",
          left,
          top,
          width: FULL_W,
          height: FULL_H,
          zIndex: 9999,
          background: "var(--wk-bg-surface)",
          border: "1px solid var(--wk-border-strong)",
          borderRadius: "var(--wk-r-md)",
          boxShadow: "var(--wk-shadow-lg)",
          overflow: "hidden",
        }}
      >
        <EmojiPanel
          hideStickerTab
          onEmoji={(emoji) => {
            reactionMockStore.toggle(opts.messageId, emoji.key, emoji.key)
            this.close()
          }}
        />
      </div>,
    )
  }

  /** 统一渲染：全屏透明遮罩（点击/右键关闭）+ 传入的浮窗节点。 */
  private render(panel: React.ReactNode): void {
    this.close()
    // 记录打开前的焦点，关闭时归还（键盘用户从触发元素来，应回到触发元素）。
    this.prevFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const container = document.createElement("div")
    container.className = "wk-msg-reaction-picker-overlay-root"
    document.body.appendChild(container)
    this.container = container

    // Escape 关闭：触发元素（右键菜单项 / +按钮）打开后即被卸载，需在 document 上监听。
    document.addEventListener("keydown", this.onKeyDown, true)

    ReactDOM.render(
      <>
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998 }}
          onClick={() => this.close()}
          onContextMenu={(e) => {
            e.preventDefault()
            this.close()
          }}
        />
        {/* 焦点承载：打开后把焦点移入浮窗（原触发元素已卸载），outline 去掉不干扰视觉 */}
        <div tabIndex={-1} style={{ outline: "none" }} ref={(el) => el?.focus()}>
          {panel}
        </div>
      </>,
      container,
    )
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation()
      this.close()
    }
  }

  close(): void {
    if (this.container) {
      document.removeEventListener("keydown", this.onKeyDown, true)
      ReactDOM.unmountComponentAtNode(this.container)
      this.container.remove()
      this.container = null
      // 归还焦点到打开前的触发元素（若仍在文档内）。
      if (this.prevFocus && document.contains(this.prevFocus)) {
        this.prevFocus.focus()
      }
      this.prevFocus = null
    }
  }
}

export const reactionPickerOverlay = new ReactionPickerOverlayController()
