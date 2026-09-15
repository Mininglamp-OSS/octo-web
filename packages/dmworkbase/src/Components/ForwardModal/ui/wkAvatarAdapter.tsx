import React, { useMemo } from "react"
import { Channel } from "wukongimjssdk"
import WKAvatar from "../../WKAvatar"
import type { ForwardAvatarDescriptor, ForwardAvatarRenderer } from "./avatar"

/**
 * Default Web avatar adapter used by the ForwardModal compatibility export.
 * Loads wukongimjssdk / WKApp, so it lives in a module that ONLY the default
 * ForwardModal path imports — never the standalone ForwardModalView.
 */
function WebForwardAvatar(item: ForwardAvatarDescriptor) {
  const channel = useMemo(() => new Channel(item.channelID, item.channelType), [item.channelID, item.channelType])
  return <WKAvatar channel={channel} lazy={item.lazy} />
}

export const wkAvatarRenderer: ForwardAvatarRenderer = (item) => <WebForwardAvatar {...item} />
