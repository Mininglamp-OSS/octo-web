import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  installLibraryControlButtons,
  IMPORT_BUTTON_CLASS,
  SAVE_BUTTON_CLASS,
  RESET_BUTTON_CLASS,
} from '../libraryControlButtons.ts'

// The library panel's control-buttons row as @excalidraw/excalidraw@0.18.1 renders it:
// `LibraryMenuControlButtons` → `.library-menu-control-buttons` holding the local "..." dropdown
// (`.library-menu-dropdown-container`) and, before the de-brand pass strips it, the online browse
// anchor. XIN-621 ① surfaces the dropdown's actions (import / save-to-file / reset) as explicit
// buttons in this row, then removes the "..." overflow entirely. If the vendored DOM shape changes
// on an upgrade, this fixture is the tripwire.
function controlButtonsRow(): HTMLElement {
  const container = document.createElement('div')
  container.className = 'library-menu-control-buttons'
  const dropdown = document.createElement('div')
  dropdown.className = 'library-menu-dropdown-container'
  const trigger = document.createElement('button')
  trigger.className = 'dropdown-menu-button'
  trigger.setAttribute('data-testid', 'lib-dropdown--trigger')
  dropdown.appendChild(trigger)
  container.appendChild(dropdown)
  return container
}

function opts(overrides: Partial<Record<'onImport' | 'onSave' | 'onReset', () => void>> = {}) {
  return {
    import: { label: 'Import from local', onClick: overrides.onImport ?? (() => {}) },
    save: { label: 'Save to file', onClick: overrides.onSave ?? (() => {}) },
    reset: { label: 'Reset library', onClick: overrides.onReset ?? (() => {}) },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('installLibraryControlButtons', () => {
  it('injects import / save / reset buttons into a row present when installed', () => {
    const row = controlButtonsRow()
    document.body.append(row)

    const dispose = installLibraryControlButtons(document, opts())

    const importBtn = row.querySelector<HTMLButtonElement>(`.${IMPORT_BUTTON_CLASS}`)
    const saveBtn = row.querySelector<HTMLButtonElement>(`.${SAVE_BUTTON_CLASS}`)
    const resetBtn = row.querySelector<HTMLButtonElement>(`.${RESET_BUTTON_CLASS}`)
    expect(importBtn).not.toBeNull()
    expect(saveBtn).not.toBeNull()
    expect(resetBtn).not.toBeNull()
    expect(importBtn!.textContent).toBe('Import from local')
    expect(saveBtn!.textContent).toBe('Save to file')
    expect(resetBtn!.textContent).toBe('Reset library')
    expect(importBtn!.type).toBe('button')
    dispose()
  })

  it('orders the row import → save → reset, ahead of anything else', () => {
    const row = controlButtonsRow()
    document.body.append(row)

    const dispose = installLibraryControlButtons(document, opts())

    const explicit = [...row.children].filter((el) =>
      el.matches(`.${IMPORT_BUTTON_CLASS}, .${SAVE_BUTTON_CLASS}, .${RESET_BUTTON_CLASS}`),
    )
    expect(explicit.map((el) => el.className)).toEqual([
      IMPORT_BUTTON_CLASS,
      SAVE_BUTTON_CLASS,
      RESET_BUTTON_CLASS,
    ])
    // The explicit buttons lead the row.
    expect(row.firstElementChild!.className).toBe(IMPORT_BUTTON_CLASS)
    dispose()
  })

  it('removes the "..." overflow dropdown once the explicit buttons are in place', () => {
    const row = controlButtonsRow()
    document.body.append(row)

    const dispose = installLibraryControlButtons(document, opts())

    expect(row.querySelector('.library-menu-dropdown-container')).toBeNull()
    dispose()
  })

  it('injects into a row mounted AFTER install (panel opened later)', async () => {
    const dispose = installLibraryControlButtons(document, opts())

    document.body.append(controlButtonsRow())
    // MutationObserver callbacks are microtask-async; let them flush.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector(`.${IMPORT_BUTTON_CLASS}`)).not.toBeNull()
    expect(document.querySelector('.library-menu-dropdown-container')).toBeNull()
    dispose()
  })

  it('is idempotent — never injects a second set of buttons into the same row', async () => {
    const row = controlButtonsRow()
    document.body.append(row)
    const dispose = installLibraryControlButtons(document, opts())

    // Mutate the row again; the observer re-fires but must not add duplicates.
    row.appendChild(document.createElement('span'))
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(row.querySelectorAll(`.${IMPORT_BUTTON_CLASS}`)).toHaveLength(1)
    expect(row.querySelectorAll(`.${SAVE_BUTTON_CLASS}`)).toHaveLength(1)
    expect(row.querySelectorAll(`.${RESET_BUTTON_CLASS}`)).toHaveLength(1)
    dispose()
  })

  it('re-strips a "..." overflow that React re-adds after injection', async () => {
    const row = controlButtonsRow()
    document.body.append(row)
    const dispose = installLibraryControlButtons(document, opts())
    expect(row.querySelector('.library-menu-dropdown-container')).toBeNull()

    // Simulate React re-rendering the overflow back into the row.
    const dropdown = document.createElement('div')
    dropdown.className = 'library-menu-dropdown-container'
    row.appendChild(dropdown)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(row.querySelector('.library-menu-dropdown-container')).toBeNull()
    dispose()
  })

  it('invokes the matching handler when each button is clicked', () => {
    const onImport = vi.fn()
    const onSave = vi.fn()
    const onReset = vi.fn()
    const row = controlButtonsRow()
    document.body.append(row)
    const dispose = installLibraryControlButtons(document, opts({ onImport, onSave, onReset }))

    row.querySelector<HTMLButtonElement>(`.${IMPORT_BUTTON_CLASS}`)!.click()
    row.querySelector<HTMLButtonElement>(`.${SAVE_BUTTON_CLASS}`)!.click()
    row.querySelector<HTMLButtonElement>(`.${RESET_BUTTON_CLASS}`)!.click()

    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onReset).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('stops injecting after dispose', async () => {
    const dispose = installLibraryControlButtons(document, opts())
    dispose()

    document.body.append(controlButtonsRow())
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector(`.${IMPORT_BUTTON_CLASS}`)).toBeNull()
  })
})
