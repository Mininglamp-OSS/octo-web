import React from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import { X } from "lucide-react"
import WKAvatar from "../../WKAvatar"
import Checkbox from "../../Checkbox"
import AiBadge from "../../AiBadge"
import { useI18n } from "../../../i18n"
import type { ForwardItem } from "../ForwardModal"
import type { ForwardBotSnapshot } from "../grant"

/** One selected person's Bots, read from the authoritative snapshot (checked = still selected). */
export interface SelectedRowBots {
  bots: Array<{ uid: string; name: string; selected: boolean }>
  /** Toggle a Bot's selection — the SAME authoritative snapshot toggle the 授权区 uses. */
  toggleBot: (uid: string) => void
}

/** 右列已选列表项：头像 + 名称 + 移除按钮。 */
export interface SelectedRowProps {
  item: ForwardItem
  onRemove: (item: ForwardItem) => void
  /**
   * Selected-person Bot readout (Scope C). Present ONLY for a person/private-chat target that has
   * Bots in the authoritative snapshot; the child rows mirror the 授权区 selection and their
   * checkbox delegates to the SAME snapshot.toggleBot (no duplicate selection state). Group/thread
   * targets never pass this — the right panel keeps them as a single flat target.
   */
  bots?: SelectedRowBots
}

export function SelectedRow({ item, onRemove, bots }: SelectedRowProps) {
  const { t } = useI18n()
  const channel = new Channel(item.channelID, item.channelType)
  const nested = bots?.bots ?? []
  return (
    <div className="wk-fm-selected-item-wrap">
      <div className="wk-fm-selected-item">
        <div className="wk-fm-avatar-wrap">
          {/* 右列已选列表项数量少且都在视口内，不启用 lazy 避免占位 SVG → 真实
              图的视觉闪烁 */}
          <WKAvatar channel={channel} />
        </div>
        <span className="wk-fm-item-name">{item.displayName}</span>
        <button
          type="button"
          className="wk-fm-remove-btn"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(item)
          }}
          aria-label={t("base.forwardModal.remove")}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {nested.length > 0 && (
        // Representational Bot children (Scope C): they show the person's currently checked/default
        // Bots nested beneath them. The checkbox is the SAME authoritative toggle as the 授权区, so
        // cancelling/restoring here syncs everywhere immediately; there is no independent remove.
        <div className="wk-fm-selected-bots">
          {nested.map((bot) => (
            <label className="wk-fm-selected-bot" key={bot.uid}>
              <Checkbox
                checked={bot.selected}
                onCheck={() => bots?.toggleBot(bot.uid)}
                ariaLabel={t(
                  bot.selected ? "base.forwardModal.grant.botCheckedFor" : "base.forwardModal.grant.botUncheckedFor",
                  { values: { bot: bot.name, person: item.displayName } },
                )}
              />
              <span className="wk-fm-selected-bot-name">{bot.name}</span>
              <AiBadge size="small" />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** True when a forward target is a plain person peer (its Bots may nest under it in the right panel). */
export function isPersonTarget(item: ForwardItem): boolean {
  return item.channelType === ChannelTypePerson && !item.isThread
}

/** Read one person's Bot group out of the authoritative snapshot (empty when none / not a person). */
export function selectedBotsForPerson(
  item: ForwardItem,
  snapshot: ForwardBotSnapshot | undefined,
): SelectedRowBots | undefined {
  if (!snapshot || !snapshot.ready || !isPersonTarget(item)) return undefined
  const group = snapshot.groups.find((g) => g.uid === item.channelID)
  if (!group || group.bots.length === 0) return undefined
  return { bots: group.bots, toggleBot: snapshot.toggleBot }
}
