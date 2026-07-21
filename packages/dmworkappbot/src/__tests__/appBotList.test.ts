import { describe, expect, it } from "vitest"
import { filterAppBots, groupAppBots, toAppBotViewItem } from "../bridge/appBotList"
import type { AppBotInfo } from "../Service/AppBotService"

const bots: AppBotInfo[] = [
  {
    id: "platform-doc",
    uid: "robot_doc",
    display_name: "Docs Bot",
    description: "Search platform docs",
    scope: "platform",
  },
  {
    id: "space-report",
    uid: "robot_report",
    display_name: "Report Bot",
    description: "Weekly space update",
    scope: "space",
  },
]

describe("appBotList bridge helpers", () => {
  it("maps API rows into UI view items", () => {
    expect(toAppBotViewItem(bots[0])).toEqual({
      id: "platform-doc",
      uid: "robot_doc",
      displayName: "Docs Bot",
      description: "Search platform docs",
      scope: "platform",
    })
  })

  it("filters by display name and description case-insensitively", () => {
    const viewItems = bots.map(toAppBotViewItem)

    expect(filterAppBots(viewItems, "weekly")).toEqual([viewItems[1]])
    expect(filterAppBots(viewItems, "DOCS")).toEqual([viewItems[0]])
  })

  it("groups platform and space bots separately", () => {
    const grouped = groupAppBots(bots.map(toAppBotViewItem))

    expect(grouped.platformBots.map((bot) => bot.uid)).toEqual(["robot_doc"])
    expect(grouped.spaceBots.map((bot) => bot.uid)).toEqual(["robot_report"])
  })
})
