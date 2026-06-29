// 与服务端 pkg/avatarrender 对齐的最小版「群头像文字」规则，仅用于本地**实时预览**。
// 不追求与服务端逐像素一致（保存后会拉服务端真图），只求视觉接近。

const MAX_VISIBLE = 4

// isInvisible 近似服务端 isInvisible：空白 / 控制 / 零宽 / BOM。
function isInvisible(ch: string): boolean {
  if (/\s/.test(ch)) return true
  const c = ch.codePointAt(0) ?? 0
  return (
    (c >= 0x00 && c <= 0x1f) ||
    (c >= 0x7f && c <= 0x9f) ||
    (c >= 0x200b && c <= 0x200f) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0xfeff
  )
}

// visibleChars 去除不可见字符，按「字符」（含代理对/emoji）切分。
export function visibleChars(s: string): string[] {
  const out: string[] = []
  for (const ch of s) {
    if (!isInvisible(ch)) out.push(ch)
  }
  return out
}

// cleanAvatarText 取可见字符前 4（对齐服务端 GroupText）。
export function cleanAvatarText(s: string): string {
  return visibleChars(s).slice(0, MAX_VISIBLE).join("")
}

// visibleCount 可见字符数（供输入框 ≤4 校验）。
export function visibleCount(s: string): number {
  return visibleChars(s).length
}

// isWideChar 近似服务端 isWideRune（CJK / 假名 / 谚文 / 全角）。
function isWideChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xff00 && c <= 0xff60)
  )
}

// groupNameText 镜像服务端 GroupNameText（命名群按群名取前 2 字，script 感知）：
// 含宽字符（CJK/假名/谚文）→ 只取宽字符前 2；纯数字 → 前 2；含字母 → 首字母缩写 ≤2、
// 大写；否则空。仅供「命名群（is_named=1）无自定义文字」时的本地预览，与服务端默认头像
// 取字保持一致。
export function groupNameText(name: string): string {
  const rs = visibleChars(name)
  if (rs.length === 0) return ""
  const wide = rs.filter(isWideChar)
  if (wide.length > 0) return wide.slice(0, 2).join("")
  if (rs.every((c) => /[0-9]/.test(c))) return rs.slice(0, 2).join("")
  if (rs.some((c) => /\p{L}/u.test(c))) return initials(name, 2)
  return ""
}

// initials 取每个分词（空白/标点切分）的首字母，≤limit、大写。简化版（不做 camelCase
// 细分），用于预览近似服务端的拉丁缩写。
function initials(name: string, limit: number): string {
  const out: string[] = []
  let took = false
  for (const ch of name) {
    if (/\s/.test(ch) || !/[\p{L}\p{N}]/u.test(ch)) {
      took = false
      continue
    }
    if (!took && /\p{L}/u.test(ch)) {
      out.push(ch.toUpperCase())
      took = true
      if (out.length === limit) break
    }
  }
  return out.join("")
}

// groupAvatarLines 对齐服务端 GroupAvatarLines：≤2 字或无宽字符 → 单行；≥3 且含宽字符
// → 两行（上少下多）。
export function groupAvatarLines(text: string): string[] {
  const chars = [...text]
  if (chars.length <= 2 || !chars.some(isWideChar)) return [text]
  const top = Math.floor(chars.length / 2)
  return [chars.slice(0, top).join(""), chars.slice(top).join("")]
}

// colorIndexForName 在用户未选色时按群名稳定派生一个色板下标，使预览有颜色且随名稳定。
// 注意：服务端默认色按 group_no 派生（建群前无 group_no），故此处仅用于**预览**——
// 未自定义颜色时建群后服务端的实际色可能与预览略有不同（详见 brief caveat C1）。
export function colorIndexForName(name: string, size: number): number {
  if (size <= 0) return 0
  let h = 0
  for (const ch of name) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  }
  return h % size
}
