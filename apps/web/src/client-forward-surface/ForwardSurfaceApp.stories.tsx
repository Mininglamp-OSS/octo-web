import React, { useMemo } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { I18nProvider } from "@octo/base/src/i18n"
import type { ForwardSurfaceUpdate } from "@octo/base/src/features/forwarding/surfaceContract"
import { ForwardSurfaceApp, type ForwardSurfaceHost } from "./ForwardSurfaceApp"
import "@octo/base/src/theme/tokens.css"
import "./index.css"

const person = { channelID: "person", channelType: 1, displayName: "Alex Morgan" }
const team = { channelID: "team", channelType: 2, displayName: "Product Design and Engineering" }
const initial: ForwardSurfaceUpdate = { version: 1, id: "story", revision: 1, model: {
  items: [person, team], allItems: [person, team], selectedIDs: [], inputValue: "",
  activeTab: "recent", loading: false, loadError: false, locale: "zh-CN", theme: "light",
} }

function SurfaceStory({ snapshot }: { snapshot: ForwardSurfaceUpdate }) {
  const host = useMemo<ForwardSurfaceHost>(() => {
    let current = snapshot
    const listeners = new Set<(update: ForwardSurfaceUpdate) => void>()
    return {
      async getState() { return current },
      onState(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      async dispatch({ action }) {
        const model = current.model
        if (!model) return
        if (action.type === "input") model.inputValue = action.value
        if (action.type === "tab") model.activeTab = action.value
        if (action.type === "toggle") model.selectedIDs = model.selectedIDs.includes(action.channelID)
          ? model.selectedIDs.filter(id => id !== action.channelID) : [...model.selectedIDs, action.channelID]
        current = { ...current, revision: current.revision + 1, model: { ...model } }
        listeners.forEach(listener => listener(current))
      },
    }
  }, [snapshot])
  return <I18nProvider><ForwardSurfaceApp host={host} /></I18nProvider>
}

const meta: Meta<typeof SurfaceStory> = {
  title: "Desktop/ForwardSurface",
  component: SurfaceStory,
  parameters: { layout: "fullscreen" },
  args: { snapshot: initial },
}
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const DarkEnglish: Story = { args: { snapshot: { ...initial, model: { ...initial.model!, locale: "en-US", theme: "dark" } } } }
export const Empty: Story = { args: { snapshot: { ...initial, model: { ...initial.model!, items: [], allItems: [] } } } }
export const Loading: Story = { args: { snapshot: { ...initial, model: { ...initial.model!, loading: true } } } }
export const PartialError: Story = { args: { snapshot: { ...initial, model: { ...initial.model!, loadError: true } } } }
export const LongText: Story = { args: { snapshot: { ...initial, model: { ...initial.model!, title: "Forward the cross-functional workspace quarterly planning document to a conversation" } } } }
