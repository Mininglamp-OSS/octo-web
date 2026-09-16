import React from "react"
import { createRoot } from "react-dom/client"
import { I18nProvider } from "@octo/base/src/i18n"
import "@octo/base/src/theme/tokens.css"
import { ForwardSurfaceApp } from "./ForwardSurfaceApp"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider><ForwardSurfaceApp host={window.octoBuddyForwardSurface} /></I18nProvider>
  </React.StrictMode>,
)
