import { describe, it, expect, afterEach, vi } from 'vitest'
import { installLibraryImportButton, IMPORT_BUTTON_CLASS } from '../libraryImportButton.ts'

// The library panel's control-buttons row as @excalidraw/excalidraw@0.18.1 renders it:
// `LibraryMenuControlButtons` → `.library-menu-control-buttons` holding the local "..." dropdown
// (and, before the de-brand pass strips it, the online browse anchor). We inject an explicit
// "import from local" button into this row so the local-import entry is no longer buried in the
// dropdown. If the vendored DOM shape changes on an upgrade, this fixture is the tripwire.
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

const OPTS = { label: 'Import from local', onImport: () => {} }

afterEach(() => {
  document.body.innerHTML = ''
})

describe('installLibraryImportButton', () => {
  it('injects the import button into a row present when installed', () => {
    const row = controlButtonsRow()
    document.body.append(row)

    const dispose = installLibraryImportButton(document, OPTS)

    const btn = row.querySelector<HTMLButtonElement>(`.${IMPORT_BUTTON_CLASS}`)
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toBe('Import from local')
    expect(btn!.type).toBe('button')
    // Leads the row so it reads as a first-class action ahead of the "..." dropdown.
    expect(row.firstElementChild).toBe(btn)
    // The local dropdown is left untouched.
    expect(row.querySelector('.library-menu-dropdown-container')).not.toBeNull()
    dispose()
  })

  it('injects into a row mounted AFTER install (panel opened later)', async () => {
    const dispose = installLibraryImportButton(document, OPTS)

    document.body.append(controlButtonsRow())
    // MutationObserver callbacks are microtask-async; let them flush.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector(`.${IMPORT_BUTTON_CLASS}`)).not.toBeNull()
    dispose()
  })

  it('is idempotent — never injects a second button into the same row', async () => {
    const row = controlButtonsRow()
    document.body.append(row)
    const dispose = installLibraryImportButton(document, OPTS)

    // Mutate the row again; the observer re-fires but must not add a duplicate.
    row.appendChild(document.createElement('span'))
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(row.querySelectorAll(`.${IMPORT_BUTTON_CLASS}`)).toHaveLength(1)
    dispose()
  })

  it('invokes onImport when the button is clicked', () => {
    const onImport = vi.fn()
    const row = controlButtonsRow()
    document.body.append(row)
    const dispose = installLibraryImportButton(document, { label: 'Import from local', onImport })

    row.querySelector<HTMLButtonElement>(`.${IMPORT_BUTTON_CLASS}`)!.click()

    expect(onImport).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('stops injecting after dispose', async () => {
    const dispose = installLibraryImportButton(document, OPTS)
    dispose()

    document.body.append(controlButtonsRow())
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector(`.${IMPORT_BUTTON_CLASS}`)).toBeNull()
  })
})
