import React from "react"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import WKAvatar from "@octo/base/src/Components/WKAvatar"

interface AppBotAvatarProps {
  uid: string
}

export default function AppBotAvatar({ uid }: AppBotAvatarProps) {
  return (
    <WKAvatar
      channel={new Channel(uid, ChannelTypePerson)}
      style={{ width: "100%", height: "100%" }}
    />
  )
}

export { AppBotAvatar }
