import type { ForwardItem, ForwardModalProps } from "../../Components/ForwardModal/ForwardModal"
import type {
  ForwardSurfaceCommand,
  ForwardSurfaceItem,
  ForwardSurfaceModel,
  ForwardSurfacePort,
  ForwardSurfaceUpdate,
} from "./surfaceContract"

export type ForwardAppearance = Pick<ForwardSurfaceModel, "locale" | "theme">

function serializeItem(item: ForwardItem, avatar: (item: ForwardItem) => string | undefined): ForwardSurfaceItem {
  return {
    channelID: item.channelID,
    channelType: item.channelType,
    displayName: item.displayName,
    avatarURL: avatar(item),
    isAI: item.isAI,
    hasThreads: item.hasThreads,
    isThread: item.isThread,
    isPinned: item.isPinned,
    parentChannelID: item.parentChannelID,
    isExternal: item.isExternal,
  }
}

export function toForwardSurfaceModel(
  props: ForwardModalProps,
  appearance: ForwardAppearance,
  avatar: (item: ForwardItem) => string | undefined = (item) => item.avatarURL,
): ForwardSurfaceModel {
  const source = props.allItems ?? props.items
  const grant = props.grant
  const bots = grant?.bots
  return {
    ...appearance,
    title: props.title,
    items: props.items.map((item) => serializeItem(item, avatar)),
    allItems: source.map((item) => serializeItem(item, avatar)),
    selectedIDs: [...props.selectedIDs],
    inputValue: props.inputValue,
    activeTab: props.activeTab,
    loading: !!props.loading,
    loadError: !!props.loadError,
    botPreview: props.botPreview && source
      .filter((item) => item.channelType === 1 && !item.isThread)
      .map((item) => ({
        uid: item.channelID,
        bots: props.botPreview!.botsFor(item.channelID).map(({ uid, name }) => ({ uid, name })),
      })),
    grant: grant && {
      canGrant: grant.canGrant,
      disabledReason: grant.disabledReason,
      enabled: grant.enabled,
      role: grant.role,
      targetMemberCount: grant.targetMemberCount,
      bots: bots && {
        ready: bots.ready,
        error: bots.error,
        peopleCount: bots.peopleCount,
        botCount: bots.botCount,
        groups: bots.groups.map(({ uid, name, bots: members }) => ({
          uid, name, bots: members.map(({ uid: botUid, name: botName, selected }) => ({
            uid: botUid, name: botName, selected,
          })),
        })),
      },
    },
  }
}

/** UI commands refer to current candidates, never to renderer-supplied message or grant payloads. */
export class ForwardSurfaceSession {
  private props?: ForwardModalProps
  private revision = 0
  private encoded = ""
  private closed = false
  private awaitingRender = false
  private readonly unsubscribe: () => void
  private publication = Promise.resolve()

  constructor(
    private readonly port: ForwardSurfacePort,
    private readonly id: string,
    private readonly avatar?: (item: ForwardItem) => string | undefined,
  ) {
    this.unsubscribe = port.subscribe((command) => this.dispatch(command))
  }

  update(props: ForwardModalProps, appearance: ForwardAppearance): void {
    if (this.closed) return
    this.props = props
    const model = toForwardSurfaceModel(props, appearance, this.avatar)
    const encoded = JSON.stringify(model)
    if (encoded === this.encoded && !this.awaitingRender) return
    this.encoded = encoded
    this.awaitingRender = false
    this.publish(model)
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    this.publish(null)
  }

  private publish(model: ForwardSurfaceModel | null): void {
    const update: ForwardSurfaceUpdate = { version: 1, id: this.id, revision: ++this.revision, model }
    this.publication = this.publication.then(() => {
      if (model !== null && this.closed) return
      return this.port.publish(update)
    }).catch(() => {
      if (!this.closed) {
        this.dispose()
        this.props?.onCancel?.()
      }
    })
  }

  private dispatch(command: ForwardSurfaceCommand): void {
    const props = this.props
    if (this.closed || !props || command.id !== this.id ||
        !Number.isSafeInteger(command.revision) || command.revision < 1 ||
        command.revision > this.revision) return
    const action = command.action
    if (action.type === "cancel") {
      this.dispose()
      props.onCancel?.()
      return
    }
    if (action.type === "confirm") {
      if (command.revision !== this.revision || this.awaitingRender ||
          !props.selectedIDs.length || (props.grant?.enabled && props.grant.bots && !props.grant.bots.ready)) return
      this.dispose()
      props.onConfirm()
      return
    }
    if (action.type === "visible" || action.type === "toggle") {
      const item = (props.allItems ?? props.items).find((candidate) =>
        candidate.channelID === action.channelID && candidate.channelType === action.channelType)
      if (!item) return
      if (action.type === "visible") props.onItemVisible?.(item)
      else {
        this.awaitingRender = true
        props.onToggleSelect(item)
      }
      return
    }
    if (action.type === "input" && typeof action.value === "string" && action.value.length <= 4096) {
      if (action.value === props.inputValue && !this.awaitingRender) return
      this.awaitingRender = true
      props.onInputChange(action.value)
    } else if (action.type === "tab" && ["followed", "recent", "group", "direct"].includes(action.value)) {
      if (action.value === props.activeTab && !this.awaitingRender) return
      this.awaitingRender = true
      props.onTabChange(action.value)
    } else if (action.type === "retry") {
      props.onRetry?.()
    } else if (action.type === "grantEnabled" && props.grant?.canGrant && typeof action.value === "boolean") {
      if (action.value === props.grant.enabled && !this.awaitingRender) return
      this.awaitingRender = true
      props.grant.onEnabledChange(action.value)
    } else if (action.type === "grantRole" && props.grant?.canGrant &&
        ["reader", "commenter", "writer"].includes(action.value)) {
      if (action.value === props.grant.role && !this.awaitingRender) return
      this.awaitingRender = true
      props.grant.onRoleChange(action.value)
    } else if (action.type === "retryBots" && props.grant?.enabled) {
      props.grant.bots?.retry?.()
    } else if (action.type === "toggleBot" && props.grant?.canGrant && props.grant.enabled &&
        props.grant.bots?.ready && props.grant.bots.groups.some((group) =>
          group.bots.some((bot) => bot.uid === action.uid))) {
      this.awaitingRender = true
      props.grant.bots.toggleBot(action.uid)
    }
  }
}
