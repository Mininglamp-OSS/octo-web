import type { AppBotInfo, AppBotScope } from "../Service/AppBotService"

export type { AppBotInfo, AppBotScope }

export type AppBotLoadState = "loading" | "ready" | "error"

export interface AppBotViewItem {
  id: string
  uid: string
  displayName: string
  description: string
  scope: AppBotScope
}

export interface AppBotSections {
  platformBots: AppBotViewItem[]
  spaceBots: AppBotViewItem[]
}
