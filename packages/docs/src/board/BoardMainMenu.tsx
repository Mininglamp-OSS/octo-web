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
 * File import lives in the document homepage's New dropdown, so the native LoadScene entry is
 * deliberately omitted along with the upstream "Excalidraw links" group. This keeps one product
 * entrance for importing boards while preserving the rest of Excalidraw's useful local actions.
 */
export function BoardMainMenu({ MainMenu }: { MainMenu: ExcalidrawMainMenu }): ReactElement {
  const items = MainMenu.DefaultItems
  return (
    <MainMenu>
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
