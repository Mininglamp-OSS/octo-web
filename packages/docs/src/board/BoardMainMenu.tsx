import type { ComponentType, ReactElement, ReactNode } from 'react'

/**
 * Minimal structural view of Excalidraw's `MainMenu` compound component — just the pieces the
 * board composes. Mirrors the deliberate choice in BoardShell to avoid importing Excalidraw's own
 * types at module scope: the library is a client-only dynamic import, and pulling its `.d.ts`
 * graph into the isolated docs typecheck buys nothing here.
 *
 * Every default item is rendered without props (matching Excalidraw's own default menu), so a
 * permissive `Record<string, unknown>` prop shape is enough to keep the composition below typed.
 */
type MenuComponent = ComponentType<Record<string, unknown>>

export type ExcalidrawMainMenu = ComponentType<{ children?: ReactNode }> & {
  DefaultItems: {
    LoadScene: MenuComponent
    SaveToActiveFile: MenuComponent
    Export: MenuComponent
    SaveAsImage: MenuComponent
    SearchMenu: MenuComponent
    Help: MenuComponent
    ClearCanvas: MenuComponent
    ToggleTheme: MenuComponent
    ChangeCanvasBackground: MenuComponent
    // `Socials` is intentionally absent: the "Excalidraw links" group it renders (GitHub / Follow
    // us / Discord) is exactly the upstream branding we drop for the product board (XIN-531 item 1).
  }
  Separator: MenuComponent
}

/**
 * The board's hamburger menu: Excalidraw's default main menu MINUS the upstream "Excalidraw links"
 * group. Supplying any `<MainMenu>` child makes Excalidraw render it in place of the built-in
 * fallback menu, so composing the default items without `Socials` is the supported way to remove
 * the brand links without patching the vendored library.
 *
 * The item set and order deliberately mirror Excalidraw 0.18.1's own `DefaultMainMenu` (load /
 * save / export / save-as-image / search / help / clear — separator — theme / background); only
 * the "Excalidraw links" group and its now-redundant leading separator are dropped, so nothing
 * else about the menu changes.
 */
export function BoardMainMenu({ MainMenu }: { MainMenu: ExcalidrawMainMenu }): ReactElement {
  const items = MainMenu.DefaultItems
  return (
    <MainMenu>
      <items.LoadScene />
      <items.SaveToActiveFile />
      <items.Export />
      <items.SaveAsImage />
      <items.SearchMenu />
      <items.Help />
      <items.ClearCanvas />
      <MainMenu.Separator />
      <items.ToggleTheme />
      <items.ChangeCanvasBackground />
    </MainMenu>
  )
}
