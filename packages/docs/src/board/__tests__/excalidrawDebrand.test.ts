import { describe, it, expect, afterEach } from 'vitest'
import {
  BOARD_BRAND,
  debrandMermaidText,
  installExcalidrawDebrand,
} from '../excalidrawDebrand.ts'

// These fixtures mirror the exact markup @excalidraw/excalidraw@0.18.1 renders for the two mermaid
// surfaces we localize (see excalidrawDebrand.ts for the source references). If the vendored DOM
// shape changes on an upgrade, these tests are the tripwire.

/** The "更多工具 → Mermaid 至 Excalidraw" dropdown item (item 3). */
function mermaidMenuItem(label: string): HTMLElement {
  const item = document.createElement('div')
  item.className = 'dropdown-menu-item dropdown-menu-item-base'
  item.setAttribute('data-testid', 'toolbar-embeddable')
  const text = document.createElement('div')
  text.className = 'dropdown-menu-item__text'
  text.textContent = label
  item.appendChild(text)
  return item
}

/** The Mermaid dialog title + description (item 4), description with its highlight links. */
function mermaidDialog(): HTMLElement {
  const dialog = document.createElement('div')
  dialog.className = 'excalidraw excalidraw-modal-container'

  const title = document.createElement('p')
  title.className = 'dialog-mermaid-title'
  title.textContent = 'Mermaid 至 Excalidraw'
  dialog.appendChild(title)

  const desc = document.createElement('div')
  desc.className = 'ttd-dialog-desc'
  desc.append('目前仅支持')
  const a1 = document.createElement('a')
  a1.textContent = '流程图'
  desc.append(a1, '、')
  const a2 = document.createElement('a')
  a2.textContent = '序列图'
  desc.append(a2, '和')
  const a3 = document.createElement('a')
  a3.textContent = '类图'
  desc.append(a3, '。其他类型在 Excalidraw 中将以图像呈现。')
  dialog.appendChild(desc)

  return dialog
}

/**
 * The Help dialog (item 2) as @excalidraw/excalidraw@0.18.1 renders it: a body-portal container
 * carrying both `excalidraw` and `excalidraw-modal-container`, a `.HelpDialog__header` holding the
 * four brand `.HelpDialog__btn` link anchors, and a sibling `.HelpDialog__islands-container` with
 * the tool/editor shortcut islands. If the vendored DOM shape changes on an upgrade, the header
 * test below is the tripwire.
 */
function helpDialog(): HTMLElement {
  const dialog = document.createElement('div')
  dialog.className = 'excalidraw excalidraw-modal-container'

  const header = document.createElement('div')
  header.className = 'HelpDialog__header'
  for (const [href, label] of [
    ['https://docs.excalidraw.com', 'Documentation'],
    ['https://plus.excalidraw.com/blog', 'Blog'],
    ['https://github.com/excalidraw/excalidraw/issues', 'GitHub'],
    ['https://youtube.com/@excalidraw', 'YouTube'],
  ]) {
    const btn = document.createElement('a')
    btn.className = 'HelpDialog__btn'
    btn.href = href
    const icon = document.createElement('div')
    icon.className = 'HelpDialog__link-icon'
    btn.append(icon, label)
    header.appendChild(btn)
  }
  dialog.appendChild(header)

  const islands = document.createElement('div')
  islands.className = 'HelpDialog__islands-container'
  for (const caption of ['工具', '编辑器']) {
    const island = document.createElement('div')
    island.className = 'HelpDialog__island HelpDialog__island--tools'
    const h4 = document.createElement('h4')
    h4.className = 'HelpDialog__island-title'
    h4.textContent = caption
    island.appendChild(h4)
    islands.appendChild(island)
  }
  dialog.appendChild(islands)

  return dialog
}

// The library panel's control buttons. In 0.18.1 `LibraryMenuControlButtons` unconditionally
// renders `LibraryMenuBrowseButton` — an <a class="library-menu-browse-button"> pointing at the
// hosted online library — followed by its `children` (the local "..." dropdown). This mirrors that
// exact markup so removing the online entry while keeping local controls is a real 0.18.1 tripwire.
function libraryControlButtons(): HTMLElement {
  const container = document.createElement('div')
  container.className = 'library-menu-control-buttons'

  // The online "浏览素材库 / Browse libraries" anchor (must be removed).
  const browse = document.createElement('a')
  browse.className = 'library-menu-browse-button'
  browse.setAttribute(
    'href',
    'https://libraries.excalidraw.com?target=_blank&referrer=http%3A%2F%2Flocalhost&useHash=true&token=id&theme=light&version=1',
  )
  browse.setAttribute('target', '_excalidraw_libraries')
  browse.textContent = '浏览素材库'
  container.appendChild(browse)

  // The local library dropdown (load/import .excalidrawlib, save/export, reset) — must be preserved.
  const dropdown = document.createElement('div')
  dropdown.className = 'library-menu-dropdown-container'
  const trigger = document.createElement('button')
  trigger.className = 'dropdown-menu-button'
  trigger.setAttribute('data-testid', 'lib-dropdown--trigger')
  dropdown.appendChild(trigger)
  container.appendChild(dropdown)

  return container
}

afterEach(() => {
  document.body.innerHTML = ''
})

// Excalidraw 0.18.1 renders the collaborator avatar stack in the canvas top-right zone as a
// `.UserList__wrapper` > `.UserList` holding one `.UserList__collaborator` avatar per remote peer.
// This mirrors that markup so the XIN-680 hide (avatar stack redundant with the header PresenceBar)
// is a real 0.18.1 tripwire. The wrapper lives inside `.layer-ui__wrapper__top-right`, next to the
// 素材库 library controls.
function collaboratorUserList(): HTMLElement {
  const topRight = document.createElement('div')
  topRight.className = 'layer-ui__wrapper__top-right'

  const wrapper = document.createElement('div')
  wrapper.className = 'UserList__wrapper'
  const list = document.createElement('div')
  list.className = 'UserList'
  for (const name of ['Ada Lovelace', 'Grace Hopper']) {
    const avatar = document.createElement('div')
    avatar.className = 'UserList__collaborator UserList__collaborator--avatar-only'
    avatar.title = name
    list.appendChild(avatar)
  }
  wrapper.appendChild(list)
  topRight.appendChild(wrapper)

  return topRight
}

describe('debrandMermaidText', () => {
  it('swaps the localized brand token', () => {
    expect(debrandMermaidText('Mermaid 至 Excalidraw')).toBe(`Mermaid 至 ${BOARD_BRAND}`)
    expect(debrandMermaidText('。其他类型在 Excalidraw 中将以图像呈现。')).toBe(
      `。其他类型在 ${BOARD_BRAND} 中将以图像呈现。`,
    )
  })

  it('swaps the English brand token too', () => {
    expect(debrandMermaidText('Mermaid to Excalidraw')).toBe(`Mermaid to ${BOARD_BRAND}`)
  })

  it('is a no-op for text without the token, and is idempotent', () => {
    expect(debrandMermaidText('Mermaid 至 画布')).toBe('Mermaid 至 画布')
    expect(debrandMermaidText(debrandMermaidText('Mermaid 至 Excalidraw'))).toBe(
      `Mermaid 至 ${BOARD_BRAND}`,
    )
  })
})

describe('installExcalidrawDebrand', () => {
  it('rewrites surfaces already present when installed', () => {
    const menu = mermaidMenuItem('Mermaid 至 Excalidraw')
    const dialog = mermaidDialog()
    document.body.append(menu, dialog)

    const dispose = installExcalidrawDebrand(document)

    expect(menu.querySelector('.dropdown-menu-item__text')?.textContent).toBe(`Mermaid 至 ${BOARD_BRAND}`)
    expect(dialog.querySelector('.dialog-mermaid-title')?.textContent).toBe(`Mermaid 至 ${BOARD_BRAND}`)
    expect(dialog.querySelector('.ttd-dialog-desc')?.textContent).toContain(`在 ${BOARD_BRAND} 中`)
    dispose()
  })

  it('flattens the description highlight links to plain text, keeping the words (XIN-698)', () => {
    const dialog = mermaidDialog()
    document.body.append(dialog)

    const dispose = installExcalidrawDebrand(document)

    // The three external anchors are gone…
    const links = dialog.querySelectorAll('.ttd-dialog-desc a')
    expect(links).toHaveLength(0)
    // …but the words survive as plain text and the sentence stays intact.
    const desc = dialog.querySelector('.ttd-dialog-desc')
    expect(desc?.textContent).toBe(`目前仅支持流程图、序列图和类图。其他类型在 ${BOARD_BRAND} 中将以图像呈现。`)
    expect(desc?.textContent).not.toContain('Excalidraw')
    dispose()
  })

  it('rewrites surfaces mounted AFTER install (dialog/menu opened later)', async () => {
    const dispose = installExcalidrawDebrand(document)

    document.body.append(mermaidDialog())
    // MutationObserver callbacks are microtask-async; let them flush.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector('.dialog-mermaid-title')?.textContent).toBe(`Mermaid 至 ${BOARD_BRAND}`)
    expect(document.querySelector('.ttd-dialog-desc')?.textContent).not.toContain('Excalidraw')
    dispose()
  })

  it('hides the four help-dialog brand buttons but keeps the shortcut lists (item 2)', () => {
    const dialog = helpDialog()
    document.body.append(dialog)

    const dispose = installExcalidrawDebrand(document)

    const header = dialog.querySelector<HTMLElement>('.HelpDialog__header')
    expect(header).not.toBeNull()
    // The four brand buttons are hidden via inline style (beats the vendor stylesheet regardless
    // of load order), and the node is preserved so Excalidraw can still unmount the dialog.
    expect(header!.style.display).toBe('none')
    expect(dialog.querySelectorAll('.HelpDialog__btn')).toHaveLength(4)
    // The shortcut reference below the header must NOT be touched.
    const islands = dialog.querySelector<HTMLElement>('.HelpDialog__islands-container')
    expect(islands).not.toBeNull()
    expect(islands!.style.display).toBe('')
    expect(dialog.querySelectorAll('.HelpDialog__island')).toHaveLength(2)
    dispose()
  })

  it('hides the help-dialog header when the dialog opens AFTER install', async () => {
    const dispose = installExcalidrawDebrand(document)

    document.body.append(helpDialog())
    // MutationObserver callbacks are microtask-async; let them flush.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector<HTMLElement>('.HelpDialog__header')?.style.display).toBe('none')
    expect(document.querySelector<HTMLElement>('.HelpDialog__islands-container')?.style.display).toBe('')
    dispose()
  })

  it('leaves non-mermaid menu items and other brand mentions alone', () => {
    // A different menu item that happens to mention the brand must NOT be touched (only "Mermaid").
    const other = mermaidMenuItem('Excalidraw 素材库')
    // strip the "Mermaid" marker so it is treated as an unrelated item
    other.querySelector('.dropdown-menu-item__text')!.textContent = 'Excalidraw 素材库'
    document.body.append(other)

    const dispose = installExcalidrawDebrand(document)

    expect(other.querySelector('.dropdown-menu-item__text')?.textContent).toBe('Excalidraw 素材库')
    dispose()
  })

  it('stops rewriting after dispose', async () => {
    const dispose = installExcalidrawDebrand(document)
    dispose()

    document.body.append(mermaidDialog())
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector('.dialog-mermaid-title')?.textContent).toBe('Mermaid 至 Excalidraw')
  })

  it('removes the online browse-library entry present when installed, keeping local controls', () => {
    const controls = libraryControlButtons()
    document.body.append(controls)

    const dispose = installExcalidrawDebrand(document)

    // Online entry gone…
    expect(document.querySelector('.library-menu-browse-button')).toBeNull()
    // …local controls untouched.
    expect(controls.querySelector('.library-menu-dropdown-container')).not.toBeNull()
    expect(controls.querySelector('[data-testid="lib-dropdown--trigger"]')).not.toBeNull()
    dispose()
  })

  it('removes the online browse-library entry mounted AFTER install (panel opened later)', async () => {
    const dispose = installExcalidrawDebrand(document)

    document.body.append(libraryControlButtons())
    // MutationObserver callbacks are microtask-async; let them flush.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector('.library-menu-browse-button')).toBeNull()
    expect(document.querySelector('.library-menu-dropdown-container')).not.toBeNull()
    dispose()
  })

  it('removes a bare browse anchor that is itself the inserted node (empty-state variant)', async () => {
    const dispose = installExcalidrawDebrand(document)

    // The empty-library "--at-bottom" variant can surface the anchor as a top-level insertion.
    const browse = document.createElement('a')
    browse.className = 'library-menu-browse-button'
    browse.setAttribute('target', '_excalidraw_libraries')
    browse.textContent = 'Browse libraries'
    document.body.append(browse)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector('.library-menu-browse-button')).toBeNull()
    dispose()
  })

  it('stops removing the browse entry after dispose', async () => {
    const dispose = installExcalidrawDebrand(document)
    dispose()

    document.body.append(libraryControlButtons())
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector('.library-menu-browse-button')).not.toBeNull()
  })

  it('hides the built-in collaborator avatar stack present when installed (XIN-680)', () => {
    const topRight = collaboratorUserList()
    document.body.append(topRight)

    const dispose = installExcalidrawDebrand(document)

    // The avatar wrapper is hidden via inline style (beats the vendor stylesheet regardless of load
    // order), and the node is preserved so Excalidraw's React tree can still reconcile it.
    const wrapper = topRight.querySelector<HTMLElement>('.UserList__wrapper')
    expect(wrapper).not.toBeNull()
    expect(wrapper!.style.display).toBe('none')
    // The avatars themselves are left in the (hidden) tree, not torn out.
    expect(topRight.querySelectorAll('.UserList__collaborator')).toHaveLength(2)
    dispose()
  })

  it('hides the collaborator avatar stack mounted AFTER install (peer joins later)', async () => {
    const dispose = installExcalidrawDebrand(document)

    document.body.append(collaboratorUserList())
    // MutationObserver callbacks are microtask-async; let them flush.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector<HTMLElement>('.UserList__wrapper')?.style.display).toBe('none')
    dispose()
  })
})
