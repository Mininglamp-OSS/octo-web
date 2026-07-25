import type { AppBotInfo } from "../Service/AppBotService"
import type { AppBotSections, AppBotViewItem } from "./types"

export function toAppBotViewItem(bot: AppBotInfo): AppBotViewItem {
  return {
    id: bot.id,
    uid: bot.uid,
    displayName: bot.display_name || bot.uid,
    description: bot.description || "",
    scope: bot.scope,
  }
}

export function filterAppBots(
  bots: AppBotViewItem[],
  keyword: string,
): AppBotViewItem[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return bots
  return bots.filter((bot) =>
    bot.displayName.toLowerCase().includes(kw) ||
    bot.description.toLowerCase().includes(kw)
  )
}

export function groupAppBots(bots: AppBotViewItem[]): AppBotSections {
  return {
    platformBots: bots.filter((bot) => bot.scope === "platform"),
    spaceBots: bots.filter((bot) => bot.scope === "space"),
  }
}
