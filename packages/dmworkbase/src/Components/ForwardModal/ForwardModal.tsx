import React from "react"
import { ForwardModalView, type ForwardModalViewProps } from "./ForwardModalView"
import { wkAvatarRenderer } from "./ui/wkAvatarAdapter"

export type { ForwardModalViewItem as ForwardItem } from "./ForwardModalView"
export type ForwardModalProps = Omit<ForwardModalViewProps, "renderAvatar">

/** Existing Web entry keeps its runtime-aware avatars and original picker behavior. */
export function ForwardModal(props: ForwardModalProps) {
  return <ForwardModalView {...props} renderAvatar={wkAvatarRenderer} />
}

export default ForwardModal
