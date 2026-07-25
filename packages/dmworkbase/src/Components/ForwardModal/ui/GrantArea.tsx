import React from "react"
import Checkbox from "../../Checkbox"
import { useI18n } from "../../../i18n"
import type { ForwardGrantConfig } from "../grant"

/**
 * 授权区（opt-in）。仅当 ForwardModal 的调用方显式传入 grant 配置时才渲染。
 * canGrant=false 走灰化+提示分支；canGrant=true 走开关 + 角色下拉 + 目标人数提示分支。
 */
export function GrantArea({ grant }: { grant: ForwardGrantConfig }) {
  const { t } = useI18n()
  if (!grant.canGrant) {
    return (
      <div className="wk-fm-grant wk-fm-grant--disabled">
        <span className="wk-fm-grant-lock">🔒</span>
        <span className="wk-fm-grant-hint">
          {grant.disabledReason ?? t("base.forwardModal.grant.disabledReason")}
        </span>
      </div>
    )
  }
  return (
    <div className="wk-fm-grant">
      <div className="wk-fm-grant-row">
        <label className="wk-fm-grant-switch">
          <Checkbox checked={grant.enabled} onCheck={() => grant.onEnabledChange(!grant.enabled)} />
          <span className="wk-fm-grant-label">{t("base.forwardModal.grant.enableLabel")}</span>
        </label>
        <select
          className="wk-fm-grant-role"
          value={grant.role}
          disabled={!grant.enabled}
          onChange={(e) => grant.onRoleChange(e.target.value as ForwardGrantConfig["role"])}
        >
          <option value="reader">{t("base.forwardModal.grant.roleReader")}</option>
          <option value="writer">{t("base.forwardModal.grant.roleWriter")}</option>
        </select>
      </div>
      {grant.enabled && typeof grant.targetMemberCount === "number" && grant.targetMemberCount > 0 && (
        <div className="wk-fm-grant-members">
          {t("base.forwardModal.grant.targetMembers", { values: { count: grant.targetMemberCount } })}
        </div>
      )}
    </div>
  )
}
