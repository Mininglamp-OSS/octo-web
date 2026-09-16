import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { i18n, useI18n } from "@octo/base/src/i18n"
import { ForwardModalView } from "@octo/base/src/Components/ForwardModal/ForwardModalView"
import type { ForwardAvatarDescriptor } from "@octo/base/src/Components/ForwardModal/ui/avatar"
import type { ForwardSurfaceAction, ForwardSurfaceCommand, ForwardSurfaceUpdate } from "@octo/base/src/features/forwarding/surfaceContract"

export interface ForwardSurfaceHost {
  getState(): Promise<ForwardSurfaceUpdate | null>
  onState(listener: (update: ForwardSurfaceUpdate) => void): () => void
  dispatch(command: ForwardSurfaceCommand): Promise<void>
}
declare global {
  interface Window { octoBuddyForwardSurface?: ForwardSurfaceHost }
}

export function safeAvatarUrl(raw?: string): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(raw)) return raw
  } catch { /* Malformed image URLs use initials. */ }
  return undefined
}

function SurfaceAvatar({ displayName, avatarURL, channelType, isAI, lazy }: ForwardAvatarDescriptor) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [avatarURL])
  const src = failed ? undefined : safeAvatarUrl(avatarURL)
  const className = `wk-fs-avatar${channelType !== 1 ? " wk-fs-avatar--group" : isAI ? " wk-fs-avatar--ai" : ""}`
  return src
    ? <img className={className} src={src} alt="" loading={lazy ? "lazy" : "eager"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={className} aria-hidden="true">{Array.from(displayName.trim())[0]?.toUpperCase() || "?"}</span>
}
const renderAvatar = (item: ForwardAvatarDescriptor) => <SurfaceAvatar {...item} />

export function ForwardSurfaceApp({ host }: { host?: ForwardSurfaceHost }) {
  const { t } = useI18n()
  const [update, setUpdate] = useState<ForwardSurfaceUpdate | null>(null)
  const [failed, setFailed] = useState(!host)
  const [pendingInput, setPendingInput] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const model = update?.model

  useEffect(() => {
    if (!host) return
    let active = true
    let pushed = false
    let latest: ForwardSurfaceUpdate | null = null
    const accept = (next: ForwardSurfaceUpdate | null) => {
      if (!active || !next || (latest && (latest.id !== next.id || next.revision <= latest.revision))) return
      latest = next
      setUpdate(next)
      setPendingInput(value => value === next.model?.inputValue ? null : value)
    }
    const off = host.onState(next => { pushed = true; accept(next) })
    void host.getState().then(next => { if (!pushed) accept(next) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; off() }
  }, [host])

  useLayoutEffect(() => {
    if (!model) return
    document.documentElement.dataset.theme = model.theme
    document.documentElement.lang = model.locale
    document.body.setAttribute("theme-mode", model.theme)
    document.body.setAttribute("theme", model.theme)
    if (i18n.getLocale() !== model.locale) i18n.setLocale(model.locale)
  }, [update, model])

  const dispatch = useCallback((action: ForwardSurfaceAction) => {
    const snapshot = update
    if (!host || !snapshot?.model) return
    void host.dispatch({ id: snapshot.id, revision: snapshot.revision, action }).catch(() => {
      setPendingInput(null)
      setFailed(true)
    })
  }, [host, update])

  useEffect(() => {
    if (!update?.id) return
    const root = dialog.current
    root?.querySelector<HTMLInputElement>("input")?.focus()
  }, [update?.id])

  useEffect(() => {
    const root = dialog.current
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault()
        dispatch({ type: "cancel" })
      }
      if (event.key !== "Tab" || !root) return
      const focusable = [...root.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      )].filter(node => node.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first) { event.preventDefault(); root.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dispatch])

  return (
    <div className="wk-forward-surface-host" onMouseDown={event => {
      if (event.target === event.currentTarget) dispatch({ type: "cancel" })
    }}>
      <div ref={dialog} className="wk-forward-surface-container" role="dialog" aria-modal="true"
        aria-label={model?.title || t("base.forwardModal.title")} tabIndex={-1}>
        {failed && <div className="wk-fs-error" role="alert">{t("base.forwardModal.loadError")}</div>}
        {model ? <ForwardModalView
          title={model.title}
          items={model.items}
          allItems={model.allItems}
          selectedIDs={model.selectedIDs}
          inputValue={pendingInput ?? model.inputValue}
          loading={model.loading}
          loadError={model.loadError}
          activeTab={model.activeTab}
          renderAvatar={renderAvatar}
          onInputChange={value => { setPendingInput(value); dispatch({ type: "input", value }) }}
          onTabChange={value => dispatch({ type: "tab", value })}
          onToggleSelect={item => dispatch({ type: "toggle", channelID: item.channelID, channelType: item.channelType })}
          onItemVisible={item => dispatch({ type: "visible", channelID: item.channelID, channelType: item.channelType })}
          onRetry={() => dispatch({ type: "retry" })}
          onCancel={() => dispatch({ type: "cancel" })}
          onConfirm={() => dispatch({ type: "confirm" })}
          botPreview={model.botPreview && { botsFor: uid => model.botPreview!.find(group => group.uid === uid)?.bots ?? [] }}
          grant={model.grant && {
            ...model.grant,
            onEnabledChange: value => dispatch({ type: "grantEnabled", value }),
            onRoleChange: value => dispatch({ type: "grantRole", value }),
            bots: model.grant.bots && {
              ...model.grant.bots,
              retry: () => dispatch({ type: "retryBots" }),
              toggleBot: uid => dispatch({ type: "toggleBot", uid }),
            },
          }}
        /> : !failed && <div className="wk-fs-loading" role="status">{t("base.forwardModal.loading")}</div>}
      </div>
    </div>
  )
}
