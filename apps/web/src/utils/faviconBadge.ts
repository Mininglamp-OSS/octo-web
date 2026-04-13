/**
 * faviconBadge.ts
 * 在浏览器 Tab favicon 上叠加未读数角标。
 * - count 0：恢复原始 favicon
 * - 1~99：显示数字
 * - >99：显示 "99+"
 *
 * 基于 84f5d52 大尺寸胶囊方案，修正数字居中 + 圆角矩形
 */

const RENDER_SIZE = 128
const BADGE_COLOR = '#e53935'
const BADGE_TEXT_COLOR = '#ffffff'
const FALLBACK_BG_COLOR = '#5b6abf'

let originalFaviconHref: string | null = null
let originalTitle: string | null = null

function getFaviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  return link
}

function saveOriginals(): void {
  if (originalFaviconHref === null) {
    originalFaviconHref = getFaviconLink().getAttribute('href') || '/favicon.ico'
  }
  if (originalTitle === null) {
    originalTitle = document.title
  }
}

function drawBadge(ctx: CanvasRenderingContext2D, text: string, size: number): void {
  const isLong     = text.length > 2   // "99+"
  const isTwoDigit = text.length === 2

  const badgeH = size * 0.60
  const ry     = badgeH / 2  // 圆角半径 = 高度一半（完整胶囊）

  // 宽度撑满图标全宽
  const rx = size / 2

  // 贴底部，水平居中
  const cx = size / 2
  const cy = size - ry

  // 圆角矩形
  const x1 = cx - rx, y1 = cy - ry
  const x2 = cx + rx, y2 = cy + ry

  ctx.beginPath()
  ctx.moveTo(x1 + ry, y1)
  ctx.lineTo(x2 - ry, y1)
  ctx.quadraticCurveTo(x2, y1, x2, y1 + ry)
  ctx.lineTo(x2, y2 - ry)
  ctx.quadraticCurveTo(x2, y2, x2 - ry, y2)
  ctx.lineTo(x1 + ry, y2)
  ctx.quadraticCurveTo(x1, y2, x1, y2 - ry)
  ctx.lineTo(x1, y1 + ry)
  ctx.quadraticCurveTo(x1, y1, x1 + ry, y1)
  ctx.closePath()
  ctx.fillStyle = BADGE_COLOR
  ctx.fill()

  // 数字：字号最大化，900 粗细
  const fontSize = Math.round(badgeH * 0.80)
  ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`
  ctx.fillStyle    = BADGE_TEXT_COLOR
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, cy)
}

function renderBadge(img: HTMLImageElement | null, text: string): string {
  const size   = RENDER_SIZE
  const canvas = document.createElement('canvas')
  canvas.width  = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { alpha: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (img) {
    ctx.drawImage(img, 0, 0, size, size)
  } else {
    const rad = size * 0.18
    ctx.fillStyle = FALLBACK_BG_COLOR
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

// title 前缀（兜底）
function setTitlePrefix(count: number) {
  if (originalTitle === null) return
  const base = originalTitle.replace(/^\(\d+\+?\)\s*/, '')
  document.title = `(${count > 99 ? '99+' : count}) ${base}`
}

function clearTitlePrefix() {
  if (originalTitle !== null) document.title = originalTitle
}

export function setFaviconBadge(count: number): void {
  if (typeof document === 'undefined') return
  saveOriginals()
  setTitlePrefix(count)

  const text = count > 99 ? '99+' : String(count)
  const src  = originalFaviconHref || '/favicon.ico'

  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload  = () => { getFaviconLink().href = renderBadge(img, text) }
  img.onerror = () => { getFaviconLink().href = renderBadge(null, text) }
  img.src = src
}

export function clearFaviconBadge(): void {
  if (typeof document === 'undefined') return
  clearTitlePrefix()
  getFaviconLink().href = originalFaviconHref || '/favicon.ico'
}
