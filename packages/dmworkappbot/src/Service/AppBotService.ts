import APIClient from "@octo/base/src/Service/APIClient"

export type AppBotScope = "platform" | "space"

export interface AppBotInfo {
  id: string
  uid: string
  display_name: string
  description?: string
  avatar?: string
  scope: AppBotScope
}

function isAppBotInfo(value: unknown): value is AppBotInfo {
  if (!value || typeof value !== "object") return false
  const bot = value as Partial<AppBotInfo>
  return Boolean(bot.id && bot.uid)
}

const AppBotService = {
  async getAvailableBots(spaceId?: string): Promise<AppBotInfo[]> {
    const config = spaceId ? { param: { space_id: spaceId } } : undefined
    const res = await APIClient.shared.get("/app_bot/available", config)
    return Array.isArray(res) ? res.filter(isAppBotInfo) : []
  },

  applyBot(robotUid: string): Promise<void> {
    return APIClient.shared.post("/app_bot/apply", { robot_uid: robotUid })
  },
}

export default AppBotService
