import { useCallback, useRef, useState } from "react"
import type { ForwardGrant, ForwardGrantRole } from "../grant"

/**
 * 授权区（feature #511）状态。仅在调用方传入 grantOptions 时激活。
 *
 * 语义（对齐既有 useForwardModal 行为）：
 *   - 开关默认关闭：需用户主动打开才走授权（AC-4 / AC-15）
 *   - 打开开关时角色复位为 defaultRole（不记忆上次更高级别）
 *   - `confirmPayload()` 供稳定的 confirm() 读取当前 grant 快照（active && enabled
 *     时返回 { role }，否则 undefined），避免上层为读快照重造 confirm 引用。
 */
export interface UseForwardGrantOptions {
  canGrant: boolean
  defaultRole?: ForwardGrantRole
}

export interface UseForwardGrantResult {
  grantEnabled: boolean
  grantRole: ForwardGrantRole
  setGrantEnabled: (v: boolean) => void
  setGrantRole: (r: ForwardGrantRole) => void
  /** 供 confirm() 读取当前授权快照：未激活或未开启时返回 undefined。 */
  readConfirmPayload: () => ForwardGrant | undefined
}

export function useForwardGrant(options?: UseForwardGrantOptions): UseForwardGrantResult {
  const active = !!options
  const defaultRole = options?.defaultRole ?? "reader"

  const [grantEnabled, setGrantEnabledState] = useState<boolean>(false)
  const [grantRole, setGrantRole] = useState<ForwardGrantRole>(defaultRole)

  // 重开开关时复位为 defaultRole（不记忆上次更高级别）→ AC-4 / AC-15。
  const setGrantEnabled = useCallback(
    (v: boolean) => {
      setGrantEnabledState(v)
      if (v) setGrantRole(defaultRole)
    },
    [defaultRole],
  )

  const stateRef = useRef<{ active: boolean; enabled: boolean; role: ForwardGrantRole }>({
    active,
    enabled: grantEnabled,
    role: grantRole,
  })
  stateRef.current = { active, enabled: grantEnabled, role: grantRole }

  const readConfirmPayload = useCallback((): ForwardGrant | undefined => {
    const { active: a, enabled, role } = stateRef.current
    return a && enabled ? { role } : undefined
  }, [])

  return {
    grantEnabled,
    grantRole,
    setGrantEnabled,
    setGrantRole,
    readConfirmPayload,
  }
}
