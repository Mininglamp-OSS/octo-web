/** Wire-only contract. Keep in sync with Client shared/forward-surface-contract.ts. */
export interface ForwardSurfaceItem {
  channelID: string
  channelType: number
  displayName: string
  avatarURL?: string
  isAI?: boolean
  hasThreads?: boolean
  isThread?: boolean
  isPinned?: boolean
  parentChannelID?: string
  isExternal?: boolean
}

export type ForwardSurfaceTab = "followed" | "recent" | "group" | "direct"
export type ForwardSurfaceRole = "reader" | "commenter" | "writer"

export interface ForwardSurfaceModel {
  title?: string
  items: ForwardSurfaceItem[]
  allItems: ForwardSurfaceItem[]
  selectedIDs: string[]
  inputValue: string
  loading: boolean
  loadError: boolean
  activeTab: ForwardSurfaceTab
  locale: "zh-CN" | "en-US"
  theme: "light" | "dark"
  botPreview?: Array<{ uid: string; bots: Array<{ uid: string; name: string }> }>
  grant?: {
    canGrant: boolean
    disabledReason?: string
    enabled: boolean
    role: ForwardSurfaceRole
    targetMemberCount?: number
    bots?: {
      ready: boolean
      error?: boolean
      peopleCount: number
      botCount: number
      groups: Array<{ uid: string; name: string; bots: Array<{ uid: string; name: string; selected: boolean }> }>
    }
  }
}

export interface ForwardSurfaceUpdate {
  version: 1
  id: string
  revision: number
  model: ForwardSurfaceModel | null
}

export type ForwardSurfaceAction =
  | { type: "input"; value: string }
  | { type: "tab"; value: ForwardSurfaceTab }
  | { type: "toggle" | "visible"; channelID: string; channelType: number }
  | { type: "grantEnabled"; value: boolean }
  | { type: "grantRole"; value: ForwardSurfaceRole }
  | { type: "toggleBot"; uid: string }
  | { type: "retry" | "retryBots" | "confirm" | "cancel" }

export interface ForwardSurfaceCommand {
  id: string
  revision: number
  action: ForwardSurfaceAction
}

export interface ForwardSurfacePort {
  publish(update: ForwardSurfaceUpdate): Promise<void>
  subscribe(listener: (command: ForwardSurfaceCommand) => void): () => void
}
