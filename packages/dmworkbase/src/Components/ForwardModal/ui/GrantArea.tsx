import React from "react"
import { Lock } from "lucide-react"
import Checkbox from "../../Checkbox"
import { useI18n } from "../../../i18n"
import type { ForwardGrantConfig } from "../grant"

/**
 * 授权区（opt-in）。仅当 ForwardModal 的调用方显式传入 grant 配置时才渲染。
 * canGrant=false 走灰化+提示分支；canGrant=true 走开关 + 角色下拉 + 目标人数提示分支。
 *
 * Bot 展开器（feature: user+Bot grants）：授权开关开启且选中人员创建过 Bot 时，渲染
 * 「N 人 / M Bot」汇总 + 每个人可展开、逐个取消其 Bot 的列表；默认全选。无 Bot 时不渲染该区块。
 *
 * 逐人那一层列表默认整体折叠（只留一行「查看 N 人的 M 个 Bot」）：以前选几个人就长几行，
 * 人多时授权区会顶掉 Footer 的转发按钮、压塌两列列表（转发弹窗固定 560px + overflow:hidden）。
 */
export function GrantArea({ grant }: { grant: ForwardGrantConfig }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [listOpen, setListOpen] = React.useState(false)
  if (!grant.canGrant) {
    return (
      <div className="wk-fm-grant wk-fm-grant--disabled">
        <Lock className="wk-fm-grant-lock" size={16} strokeWidth={2} aria-hidden="true" />
        <span className="wk-fm-grant-hint">
          {grant.disabledReason ?? t("base.forwardModal.grant.disabledReason")}
        </span>
      </div>
    )
  }
  const bots = grant.bots
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
          <option value="commenter">{t("base.forwardModal.grant.roleCommenter")}</option>
          <option value="writer">{t("base.forwardModal.grant.roleWriter")}</option>
        </select>
      </div>
      {grant.enabled && typeof grant.targetMemberCount === "number" && grant.targetMemberCount > 0 && (
        <div className="wk-fm-grant-members">
          {t("base.forwardModal.grant.targetMembers", { values: { count: grant.targetMemberCount } })}
        </div>
      )}
      {grant.enabled && bots && !bots.ready && !bots.error && (
        <div className="wk-fm-grant-bots-summary">{t("base.forwardModal.grant.botLoading")}</div>
      )}
      {grant.enabled && bots?.error && (
        <div className="wk-fm-grant-bots-summary wk-fm-grant-bots-error" role="alert">
          <span className="wk-fm-grant-bots-error-text">{t("base.forwardModal.grant.botError")}</span>
          <button type="button" className="wk-fm-grant-bot-retry" onClick={bots.retry}>
            {t("base.forwardModal.grant.botRetry")}
          </button>
        </div>
      )}
      {grant.enabled && bots?.ready && bots.groups.length > 0 && (
        <div className="wk-fm-grant-bots">
          <div className="wk-fm-grant-bots-header">
            <span className="wk-fm-grant-bots-summary">
              {t("base.forwardModal.grant.botSummary", {
                values: { people: bots.peopleCount, bots: bots.botCount },
              })}
            </span>
            <button
              type="button"
              className="wk-fm-grant-bots-toggle"
              aria-expanded={listOpen}
              onClick={() => setListOpen((prev) => !prev)}
            >
              {t(
                listOpen
                  ? "base.forwardModal.grant.botListCollapse"
                  : "base.forwardModal.grant.botListExpand",
                { values: { people: bots.peopleCount, bots: bots.botCount } },
              )}
            </button>
          </div>
          {listOpen && (
            <div className="wk-fm-grant-bot-list">
              {bots.groups.map((group) => {
                const isExpanded = expanded.has(group.uid)
                return (
                  <div className="wk-fm-grant-bot-group" key={group.uid}>
                    <button
                      type="button"
                      className="wk-fm-grant-bot-expand"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpanded((prev: Set<string>) => {
                          const next = new Set(prev)
                          if (next.has(group.uid)) next.delete(group.uid)
                          else next.add(group.uid)
                          return next
                        })
                      }
                    >
                      {t(isExpanded ? "base.forwardModal.grant.hideBots" : "base.forwardModal.grant.showBots", {
                        values: { name: group.name, count: group.bots.length },
                      })}
                    </button>
                    {isExpanded &&
                      group.bots.map((bot) => (
                        <label className="wk-fm-grant-bot" key={bot.uid}>
                          <Checkbox
                            checked={bot.selected}
                            onCheck={() => bots.toggleBot(bot.uid)}
                            ariaLabel={t(
                              bot.selected
                                ? "base.forwardModal.grant.botCheckedFor"
                                : "base.forwardModal.grant.botUncheckedFor",
                              { values: { bot: bot.name, person: group.name } },
                            )}
                          />
                          <span className="wk-fm-grant-bot-name">{bot.name}</span>
                        </label>
                      ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
