import React, { useCallback, useRef, useState } from "react"
import { Channel, ChannelInfo, ChannelTypePerson } from "wukongimjssdk"
import {
  Conversation,
  WKApp,
  createCurrentEmptyImConversation,
  findCurrentImConversation,
  setCurrentImChannelInfoCache,
} from "@octo/base"
import AppBotService from "../Service/AppBotService"
import type { AppBotViewItem } from "../bridge/types"
import AppBotAvatar from "./AppBotAvatar"
import { showErrorToast } from "./appBotToast"
import AppBotChatHeader from "../ui/AppBotChatHeader"

interface OpenAppBotConversationDeps {
  applyBot: (robotUid: string) => Promise<unknown>
  setChannelInfo: (info: ChannelInfo) => void
  findConversation: (channel: Channel) => unknown
  createEmptyConversation?: (channel: Channel) => unknown
  replaceToRoot: (element: React.ReactElement) => void
}

function createAppBotChannel(bot: AppBotViewItem) {
  return new Channel(bot.uid, ChannelTypePerson)
}

function createAppBotChannelInfo(bot: AppBotViewItem, channel: Channel) {
  const info = new ChannelInfo()
  info.channel = channel
  info.title = bot.displayName
  info.logo = `users/${bot.uid}/avatar`
  info.orgData = {
    displayName: bot.displayName,
    robot: 1,
    name: bot.displayName,
  }
  return info
}

function renderAppBotConversation(bot: AppBotViewItem, channel: Channel) {
  return (
    <div key={channel.getChannelKey()} className="appbot-chat-wrap">
      <AppBotChatHeader
        avatar={<AppBotAvatar uid={bot.uid} />}
        displayName={bot.displayName}
      />
      <Conversation channel={channel} />
    </div>
  )
}

function defaultOpenConversationDeps(): OpenAppBotConversationDeps {
  return {
    applyBot: AppBotService.applyBot,
    setChannelInfo: (info) => setCurrentImChannelInfoCache(info),
    findConversation: (channel) => findCurrentImConversation(channel),
    createEmptyConversation: (channel) => createCurrentEmptyImConversation(channel),
    replaceToRoot: (element) => WKApp.routeRight.replaceToRoot(element),
  }
}

export async function openAppBotConversation(
  bot: AppBotViewItem,
  deps: OpenAppBotConversationDeps = defaultOpenConversationDeps(),
  callbacks: { onApplied?: () => void } = {},
) {
  await deps.applyBot(bot.uid)
  callbacks.onApplied?.()

  const channel = createAppBotChannel(bot)
  const info = createAppBotChannelInfo(bot, channel)
  deps.setChannelInfo(info)

  if (!deps.findConversation(channel) && deps.createEmptyConversation) {
    deps.createEmptyConversation(channel)
  }

  deps.replaceToRoot(renderAppBotConversation(bot, channel))
}

interface UseAppBotConversationOptions {
  connectFailedMessage: string
  onError?: (message: string) => void
}

export function useAppBotConversation({
  connectFailedMessage,
  onError = showErrorToast,
}: UseAppBotConversationOptions) {
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const isSelectingRef = useRef(false)

  const resetSelection = useCallback(() => {
    isSelectingRef.current = false
    setSelectedUid(null)
    WKApp.routeRight.popToRoot()
  }, [])

  const selectBot = useCallback(async (bot: AppBotViewItem) => {
    if (isSelectingRef.current) return
    isSelectingRef.current = true
    try {
      await openAppBotConversation(bot, undefined, {
        onApplied: () => setSelectedUid(bot.uid),
      })
    } catch (err) {
      console.error("[AppBotPage] handleSelect failed:", err)
      onError(connectFailedMessage)
    } finally {
      isSelectingRef.current = false
    }
  }, [connectFailedMessage, onError])

  return {
    selectedUid,
    selectBot,
    resetSelection,
  }
}
