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

afterEach(() => {
  document.body.innerHTML = ''
})

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

  it('preserves the description highlight links (structure untouched)', () => {
    const dialog = mermaidDialog()
    document.body.append(dialog)

    const dispose = installExcalidrawDebrand(document)

    const links = dialog.querySelectorAll('.ttd-dialog-desc a')
    expect(links).toHaveLength(3)
    expect(Array.from(links).map((a) => a.textContent)).toEqual(['流程图', '序列图', '类图'])
    expect(dialog.querySelector('.ttd-dialog-desc')?.textContent).not.toContain('Excalidraw')
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
})
