import WKApp from "../../App"

// 群头像色板的一档配色（十六进制）。与服务端 avatarrender.GroupColorHex 对应：
// main 为主题主色（圆描边 + 文字 + 双人图标前景人），fill 为浅底圆背景，iconBack 为
// 双人图标后景人浅色。
export interface GroupColorHex {
  index: number
  main: string
  fill: string
  iconBack: string
}

// 兜底色板：仅在 GET /group/avatar_palette 拉取失败或尚未就绪时使用，保证 UI 不破。
// 服务端接口才是色板的**唯一数据源**；此处仅为离线兜底，**同步自 octo-server
// pkg/avatarrender/palette.go**（顺序固定、不可重排，否则既有头像换色）。
const FALLBACK_PALETTE: GroupColorHex[] = [
  { index: 0, main: "#14C0FF", fill: "#ECF9FE", iconBack: "#7EDAFB" },
  { index: 1, main: "#00D6B9", fill: "#EAFAF8", iconBack: "#64E8D6" },
  { index: 2, main: "#34C724", fill: "#F0FBEF", iconBack: "#8EE085" },
  { index: 3, main: "#B3D600", fill: "#F7FAE5", iconBack: "#D2E76A" },
  { index: 4, main: "#FFC60A", fill: "#FDF9ED", iconBack: "#F7DC82" },
  { index: 5, main: "#FF8800", fill: "#FFF5EB", iconBack: "#FFBA6B" },
  { index: 6, main: "#F01D94", fill: "#FEF1F8", iconBack: "#F57AC0" },
  { index: 7, main: "#D136D1", fill: "#FCEEFC", iconBack: "#E58FE5" },
  { index: 8, main: "#7F3BF5", fill: "#F6F1FE", iconBack: "#AD82F7" },
  { index: 9, main: "#4954E6", fill: "#F2F3FD", iconBack: "#7B83EA" },
]

interface PaletteRespColor {
  index: number
  main: string
  fill: string
  icon_back: string
}
interface PaletteResp {
  size: number
  colors: PaletteRespColor[]
}

let cache: GroupColorHex[] | undefined
let inflight: Promise<GroupColorHex[]> | undefined

// fetchGroupAvatarPalette 拉取并进程内缓存服务端色板（唯一数据源）。并发调用共享同一
// 请求；失败回退兜底色板且不缓存（下次重试）。
export function fetchGroupAvatarPalette(): Promise<GroupColorHex[]> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  try {
    inflight = WKApp.apiClient
      .get("group/avatar_palette")
      .then((resp: PaletteResp) => {
        const colors = (resp?.colors ?? []).map((c) => ({
          index: c.index,
          main: c.main,
          fill: c.fill,
          iconBack: c.icon_back,
        }))
        // 空响应不缓存：回退兜底并允许下次重试，避免把异常空结果钉死。
        if (colors.length === 0) {
          inflight = undefined
          return FALLBACK_PALETTE
        }
        cache = colors
        return cache
      })
      .catch(() => {
        inflight = undefined
        return FALLBACK_PALETTE
      })
  } catch {
    // apiClient 尚未初始化等异常：回退兜底色板，不缓存（下次重试）。
    inflight = undefined
    return Promise.resolve(FALLBACK_PALETTE)
  }
  return inflight
}

// getCachedPalette 同步返回已缓存色板；未就绪时返回兜底色板并在后台触发拉取，供渲染
// 首帧即时取色（拉取完成后由调用方 setState 刷新）。
export function getCachedPalette(): GroupColorHex[] {
  if (cache) return cache
  void fetchGroupAvatarPalette()
  return FALLBACK_PALETTE
}

// colorAt 取色板第 index 档，越界回退首档。
export function colorAt(palette: GroupColorHex[], index: number): GroupColorHex {
  if (index >= 0 && index < palette.length) return palette[index]
  return palette[0] ?? FALLBACK_PALETTE[0]
}

// paletteSize 返回色板档数（= avatar_color 合法上界）。
export function paletteSize(palette?: GroupColorHex[]): number {
  return (palette ?? cache ?? FALLBACK_PALETTE).length
}
