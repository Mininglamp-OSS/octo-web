import React, { createContext, useContext } from "react"
import type { ForwardModalViewItem } from "../ForwardModalView"

export interface ForwardAvatarDescriptor extends ForwardModalViewItem {
  lazy?: boolean
}
export type ForwardAvatarRenderer = (item: ForwardAvatarDescriptor) => React.ReactNode
export const ForwardAvatarContext = createContext<ForwardAvatarRenderer | undefined>(undefined)

export function ForwardAvatar({ item, lazy }: { item: ForwardModalViewItem; lazy?: boolean }) {
  const render = useContext(ForwardAvatarContext)
  return <>{render?.({ ...item, lazy })}</>
}
