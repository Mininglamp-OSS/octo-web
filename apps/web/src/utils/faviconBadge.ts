/**
 * faviconBadge.ts
 * 在浏览器 Tab favicon 上叠加未读数角标，同步更新 document.title 前缀。
 *
 * 设计原则：
 * - canvas 尺寸跟随原始 favicon 尺寸（64px ICO → 64px canvas）
 * - 角标高度 = canvas 高度的 35%，位于右下角，不超出边界
 * - 圆角矩形 + 粗字体，无描边
 * - document.title 前缀作为兜底
 */

const BADGE_BG  = '#F03D25'
const BADGE_FG  = '#ffffff'
const FALLBACK_BG = '#5b6abf'

// 角标占图标高度的比例（0~1）
const BADGE_HEIGHT_RATIO = 0.36

let originalFaviconHref: string | null = null
let originalTitle: string | null = null

// ── DOM helpers ──────────────────────────────────────────────────────────────

function setFaviconHref(url: string) {
  // 移除旧节点再插入，Safari 需要替换节点才刷新
  document.querySelectorAll('link[rel~="icon"]').forEach(el => el.remove())
  const link = document.createElement('link')
  link.rel  = 'icon'
  link.type = 'image/png'
  link.href = url
  document.head.appendChild(link)
}

function getOriginalFaviconHref(): string {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  return link?.getAttribute('href') || '/favicon.ico'
}

// ── 保存原始状态 ───────────────────────────────────────────────────────────

function saveOriginals() {
  if (originalFaviconHref === null) {
    originalFaviconHref = getOriginalFaviconHref()
  }
  if (originalTitle === null) {
    originalTitle = document.title
  }
}

// ── 角标绘制 ─────────────────────────────────────────────────────────────────

/**
 * 在 canvas 右下角绘制红色圆角矩形角标
 * @param ctx  canvas 2d context
 * @param text 显示文字，如 "3" / "18" / "99+"
 * @param size canvas 边长（px）
 */
function drawBadge(ctx: CanvasRenderingContext2D, text: string, size: number) {
  const bh     = Math.round(size * BADGE_HEIGHT_RATIO)  // 角标高度
  const radius = bh / 2                                  // 圆角 = 高度一半 → 胶囊形

  // 字体大小：撑满高度的 70%
  const fontSize = Math.round(bh * 0.70)
  ctx.font = `bold ${fontSize}px system-ui, arial, sans-serif`

  // 先量文字宽度，动态确定角标宽度（保证文字不被截断）
  const textW  = ctx.measureText(text).width
  const bw     = Math.max(bh, textW + radius * 1.2)  // 最小宽 = 高（正圆），宽时按文字撑开

  // 贴右下角，允许超出 canvas 边界 25%（模拟 iOS 角标悬浮效果）
  const overhang = Math.round(bh * 0.25)
  const x  = size - bw + overhang   // 左边缘
  const y  = size - bh + overhang   // 上边缘
  const x2 = size + overhang        // 右边缘（可超出）
  const y2 = size + overhang        // 下边缘（可超出）

  // 圆角矩形
  ctx.fillStyle = BADGE_BG
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x2 - radius, y)
  ctx.quadraticCurveTo(x2, y, x2, y + radius)
  ctx.lineTo(x2, y2 - radius)
  ctx.quadraticCurveTo(x2, y2, x2 - radius, y2)
  ctx.lineTo(x + radius, y2)
  ctx.quadraticCurveTo(x, y2, x, y2 - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
  ctx.fill()

  // 文字居中
  ctx.fillStyle    = BADGE_FG
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + bw / 2, y + bh / 2)
}

function renderBadge(img: HTMLImageElement | null, text: string, size: number): string {
  const canvas = document.createElement('canvas')
  // 扩展 canvas 一点，让超出部分可见
  const overhang = Math.round(size * BADGE_HEIGHT_RATIO * 0.25)
  canvas.width  = size + overhang
  canvas.height = size + overhang
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (img) {
    ctx.drawImage(img, 0, 0, size, size)
  } else {
    const rad = size * 0.18
    ctx.fillStyle = FALLBACK_BG
    ctx.beginPath()
    ctx.moveTo(rad, 0); ctx.lineTo(size - rad, 0)
    ctx.quadraticCurveTo(size, 0, size, rad)
    ctx.lineTo(size, size - rad)
    ctx.quadraticCurveTo(size, size, size - rad, size)
    ctx.lineTo(rad, size)
    ctx.quadraticCurveTo(0, size, 0, size - rad)
    ctx.lineTo(0, rad)
    ctx.quadraticCurveTo(0, 0, rad, 0)
    ctx.closePath()
    ctx.fill()
  }

  drawBadge(ctx, text, size)
  return canvas.toDataURL('image/png')
}

// ── title 前缀 ────────────────────────────────────────────────────────────────

function setTitlePrefix(count: number) {
  if (originalTitle === null) return
  const base = originalTitle.replace(/^\(\d+\+?\)\s*/, '')
  document.title = `(${count > 99 ? '99+' : count}) ${base}`
}

function clearTitlePrefix() {
  if (originalTitle !== null) document.title = originalTitle
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

export function setFaviconBadge(count: number): void {
  if (typeof document === 'undefined') return

  saveOriginals()
  setTitlePrefix(count)

  const label = count > 99 ? '99+' : String(count)
  const src   = originalFaviconHref || '/favicon.ico'

  const img = new Image()
  img.crossOrigin = 'anonymous'

  const render = (loadedImg: HTMLImageElement | null) => {
    // 使用图片自身尺寸（64px ICO 就用 64），没有就用 64
    const size = loadedImg ? Math.max(loadedImg.naturalWidth, loadedImg.naturalHeight, 64) : 64
    setFaviconHref(renderBadge(loadedImg, label, size))
  }

  img.onload  = () => render(img)
  img.onerror = () => render(null)
  img.src = src
}

export function clearFaviconBadge(): void {
  if (typeof document === 'undefined') return
  clearTitlePrefix()
  setFaviconHref(originalFaviconHref || '/favicon.ico')
}
