import React from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@octo/base", () => ({
  Conversation: ({ channel }: { channel: { channelID: string } }) =>
    React.createElement("div", { "data-channel": channel.channelID }),
  createCurrentEmptyImConversation: vi.fn(),
  findCurrentImConversation: vi.fn(),
  setCurrentImChannelInfoCache: vi.fn(),
  WKApp: {
    routeRight: {
      popToRoot: vi.fn(),
      replaceToRoot: vi.fn(),
    },
    remoteConfig: {
      octoAssistantUids: [],
    },
  },
  Dap: {
    shared: {
      track: vi.fn(),
    },
  },
}))

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string
    channelType: number

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID
      this.channelType = channelType
    }

    getChannelKey() {
      return `${this.channelID}-${this.channelType}`
    }
  }

  class ChannelInfo {
    channel: unknown
    title = ""
    logo = ""
    orgData: Record<string, unknown> = {}
  }

  return {
    Channel,
    ChannelInfo,
    ChannelTypePerson: 1,
    WKSDK: {
      shared: vi.fn(),
    },
  }
})

vi.mock("../features/AppBotAvatar", () => ({
  default: ({ uid }: { uid: string }) => React.createElement("span", null, uid),
}))

vi.mock("../Service/AppBotService", () => ({
  default: {
    applyBot: vi.fn(),
  },
}))

import { openAppBotConversation } from "../features/appBotConversation"
import { WKApp, Dap } from "@octo/base"

const noopDeps = () => ({
  applyBot: async () => {},
  setChannelInfo: vi.fn(),
  findConversation: () => undefined,
  createEmptyConversation: () => {},
  replaceToRoot: vi.fn(),
})

describe("openAppBotConversation", () => {
  it("keeps apply, SDK cache, empty conversation, and route rendering in order", async () => {
    const calls: string[] = []
    const setChannelInfo = vi.fn((info) => {
      calls.push("cache")
      expect(info.title).toBe("Docs Bot")
      expect(info.logo).toBe("users/robot_1/avatar")
      expect(info.orgData).toEqual({
        displayName: "Docs Bot",
        robot: 1,
        name: "Docs Bot",
      })
    })
    const replaceToRoot = vi.fn((element: React.ReactElement) => {
      calls.push("route")
      expect(element.props.className).toBe("appbot-chat-wrap")
    })

    await openAppBotConversation({
      id: "bot-1",
      uid: "robot_1",
      displayName: "Docs Bot",
      description: "Search docs",
      scope: "platform",
    }, {
      applyBot: async (uid) => {
        calls.push(`apply:${uid}`)
      },
      setChannelInfo,
      findConversation: () => undefined,
      createEmptyConversation: () => {
        calls.push("create")
      },
      replaceToRoot,
    })

    expect(calls).toEqual(["apply:robot_1", "cache", "create", "route"])
    expect(setChannelInfo).toHaveBeenCalledTimes(1)
    expect(replaceToRoot).toHaveBeenCalledTimes(1)
  })

  it("tracks octo_assistant_opened when the bot uid is an Octo assistant", async () => {
    vi.mocked(Dap.shared.track).mockClear()
    WKApp.remoteConfig.octoAssistantUids = ["assistant_1"]

    await openAppBotConversation(
      { id: "b", uid: "assistant_1", displayName: "Octo", description: "", scope: "platform" },
      noopDeps(),
    )

    expect(Dap.shared.track).toHaveBeenCalledWith("octo_assistant_opened", { source: "app_bot_list" })
    expect(Dap.shared.track).not.toHaveBeenCalledWith("app_opened", expect.anything())
  })

  it("tracks app_opened with app_name/app_category when the bot is not an Octo assistant", async () => {
    vi.mocked(Dap.shared.track).mockClear()
    WKApp.remoteConfig.octoAssistantUids = ["assistant_1"]

    await openAppBotConversation(
      { id: "b", uid: "robot_9", displayName: "Docs Bot", description: "", scope: "platform" },
      noopDeps(),
    )

    expect(Dap.shared.track).toHaveBeenCalledWith("app_opened", {
      app_name: "Docs Bot",
      app_category: "platform",
    })
    expect(Dap.shared.track).not.toHaveBeenCalledWith("octo_assistant_opened", expect.anything())
  })
})
