import { useCallback, useRef, useState } from "react"
import type { ForwardGrant, ForwardGrantRole, ForwardGrantTargetPrincipals } from "../grant"

/**
 * 授权区（feature #511）状态。仅在调用方传入 grantOptions 时激活。
 *
 * 语义（对齐既有 useForwardModal 行为）：
 *   - 开关默认关闭：需用户主动打开才走授权（AC-4 / AC-15）
 *   - 打开开关时角色复位为 defaultRole（不记忆上次更高级别）
 *   - `readConfirmPayload()` 供稳定的 confirm() 读取当前 grant 快照，避免上层为读快照
 *     重造 confirm 引用。
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
  /** Record the final, target-scoped principal snapshot displayed by the grant UI. */
  setGrantPrincipalsByTarget: (targets: ForwardGrantTargetPrincipals[]) => void
  /** Record the currently-selected Bot uids so confirm() can carry them in the grant payload. */
  setGrantBotUids: (uids: string[]) => void
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
    [defaultRole]
  )

  const stateRef = useRef<{
    active: boolean
    enabled: boolean
    role: ForwardGrantRole
    principalsByTarget?: ForwardGrantTargetPrincipals[]
    botUids: string[]
  }>({
    active,
    enabled: grantEnabled,
    role: grantRole,
    botUids: [],
  })
  stateRef.current = {
    ...stateRef.current,
    active,
    enabled: grantEnabled,
    role: grantRole,
  }

  const setGrantPrincipalsByTarget = useCallback((targets: ForwardGrantTargetPrincipals[]) => {
    stateRef.current.principalsByTarget = targets.map((target) => ({
      channelID: target.channelID,
      channelType: target.channelType,
      uids: [...new Set(target.uids.filter(Boolean))],
    }))
  }, [])

  const setGrantBotUids = useCallback((uids: string[]) => {
    stateRef.current.botUids = [...new Set(uids.filter(Boolean))]
  }, [])

  const readConfirmPayload = useCallback((): ForwardGrant | undefined => {
    const { active: a, enabled, role, principalsByTarget, botUids } = stateRef.current
    if (!a || !enabled) return undefined
    return {
      role,
      ...(principalsByTarget !== undefined ? { principalsByTarget } : {}),
      ...(botUids.length > 0 ? { botUids } : {}),
    }
  }, [])

  return {
    grantEnabled,
    grantRole,
    setGrantEnabled,
    setGrantRole,
    setGrantPrincipalsByTarget,
    setGrantBotUids,
    readConfirmPayload,
  }
}
