import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BoardMainMenu, type ExcalidrawMainMenu } from '../BoardMainMenu.tsx'

// A stand-in for Excalidraw's `MainMenu` compound component. Each default item renders a marker so
// we can assert exactly which items the board menu composes — and, crucially, that the upstream
// "Excalidraw links" group (Socials) is absent. The real MainMenu needs Excalidraw's runtime
// context; this mock isolates the composition, which is the part we own.
function makeMockMainMenu(): ExcalidrawMainMenu {
  const item = (name: string) => {
    const C = () => <span data-item={name} />
    C.displayName = name
    return C
  }
  const MainMenu = ({ children }: { children?: ReactNode }) => <div data-menu="root">{children}</div>
  return Object.assign(MainMenu, {
    DefaultItems: {
      LoadScene: item('LoadScene'),
      SaveToActiveFile: item('SaveToActiveFile'),
      Export: item('Export'),
      SaveAsImage: item('SaveAsImage'),
      SearchMenu: item('SearchMenu'),
      Help: item('Help'),
      ClearCanvas: item('ClearCanvas'),
      ToggleTheme: item('ToggleTheme'),
      ChangeCanvasBackground: item('ChangeCanvasBackground'),
    },
    Separator: () => <hr data-item="Separator" />,
  }) as unknown as ExcalidrawMainMenu
}

describe('BoardMainMenu', () => {
  it('renders Excalidraw default menu items minus the "Excalidraw links" group', () => {
    const { container } = render(<BoardMainMenu MainMenu={makeMockMainMenu()} />)

    const rendered = Array.from(container.querySelectorAll('[data-item]')).map((el) =>
      el.getAttribute('data-item'),
    )

    expect(rendered).toEqual([
      'LoadScene',
      'SaveToActiveFile',
      'Export',
      'SaveAsImage',
      'SearchMenu',
      'Help',
      'ClearCanvas',
      'Separator',
      'ToggleTheme',
      'ChangeCanvasBackground',
    ])
    // The de-brand: no Socials / "Excalidraw links" item is composed.
    expect(rendered).not.toContain('Socials')
  })
})
