import React from "react"
import type { ForwardModalProps } from "../../Components/ForwardModal/ForwardModal"
import { useI18n } from "../../i18n"
import type { ForwardSurfaceAdapter } from "./surfaceRegistry"
import { ForwardSurfaceSession } from "./surfaceSession"

function theme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ||
    document.body.getAttribute("theme-mode") === "dark" ? "dark" : "light"
}

export function RemoteForwardSurface({ port, ...props }: ForwardModalProps & { port: ForwardSurfaceAdapter }) {
  const { locale } = useI18n()
  const [currentTheme, setTheme] = React.useState(theme)
  const session = React.useRef<ForwardSurfaceSession>()

  React.useLayoutEffect(() => {
    const active = new ForwardSurfaceSession(port, crypto.randomUUID(), port.resolveAvatar)
    session.current = active
    return () => {
      active.dispose()
      session.current = undefined
    }
  }, [port])
  React.useLayoutEffect(() => {
    session.current?.update(props, { locale: locale === "en-US" ? "en-US" : "zh-CN", theme: currentTheme })
  })
  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(theme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    observer.observe(document.body, { attributes: true, attributeFilter: ["theme-mode"] })
    return () => observer.disconnect()
  }, [])
  return null
}
