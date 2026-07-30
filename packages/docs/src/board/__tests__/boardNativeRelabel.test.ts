/**
 * boardNativeRelabel — the locale relabel pass for the native Excalidraw labels whose bundled zh-CN
 * locale is incomplete ("Arrow type" / "More options"). These render in English under a Chinese app
 * locale; the pass swaps them for the product's own translation via `t()`, and is a no-op under en-US.
 *
 * The `../octoweb/index.ts` module is mocked so `t()` resolves against the REAL i18n JSON keyed by a
 * mutable locale — so this suite also fails if the `docs.board.nativeExcalidraw.*` keys are missing
 * or misspelled in either locale file, not just if the DOM pass regresses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ locale: 'zh-CN' as 'zh-CN' | 'en-US' }))

vi.mock('../../octoweb/index.ts', async () => {
  const enUS = (await import('../../i18n/en-US.json')).default as Record<string, unknown>
  const zhCN = (await import('../../i18n/zh-CN.json')).default as Record<string, unknown>
  const resolve = (dict: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict)
  return {
    // The docs namespace prefix ('docs.') maps onto the file root; strip it before walking the JSON.
    t: (key: string) => resolve(h.locale === 'zh-CN' ? zhCN : enUS, key.replace(/^docs\./, '')) ?? key,
  }
})

import { installBoardNativeRelabel } from '../boardNativeRelabel.ts'

/** Build the fragment Excalidraw renders for the arrow-type heading + a more-options control. */
function buildPanel(): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'panelColumn'
  panel.innerHTML = `
    <fieldset><legend>Arrow type</legend></fieldset>
    <button title="More options" aria-label="More options"><span>More options</span></button>
    <button title="Frame" aria-label="Frame"><span>Frame</span></button>
    <button title="Find on canvas" aria-label="Find on canvas"><span>Find on canvas</span></button>
    <div>Generate</div>
    <input placeholder="Find text on canvas..." />
    <input data-testid="frame-name-input" value="Frame" />
  `
  return panel
}

/** The arrow-type option picker: three icon-only <label>s whose visible label lives ONLY in the
 *  `title` attribute (Excalidraw ButtonIconSelect, exact string, no shortcut suffix), plus the three
 *  crow's-foot arrowheads from the IconPicker — `aria-label` is the exact string, but `title` carries
 *  a ``label — <shortcut>`` suffix. Mirrors dist/dev/index.js render sites (ButtonIconSelect / Picker). */
function buildArrowSubmenu(): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'panelColumn'
  panel.innerHTML = `
    <fieldset>
      <legend>Arrow type</legend>
      <label title="Sharp arrow"><input type="radio" data-testid="sharp-arrow" /></label>
      <label title="Curved arrow"><input type="radio" data-testid="round-arrow" /></label>
      <label title="Elbow arrow"><input type="radio" data-testid="elbow-arrow" /></label>
    </fieldset>
    <div class="picker">
      <button title="Crow's foot (one) — Q" aria-label="Crow's foot (one)"></button>
      <button title="Crow's foot (many) — X" aria-label="Crow's foot (many)"></button>
      <button title="Crow's foot (one or many) — C" aria-label="Crow's foot (one or many)"></button>
    </div>
  `
  return panel
}

describe('installBoardNativeRelabel', () => {
  let dispose: () => void = () => {}
  beforeEach(() => {
    h.locale = 'zh-CN'
    document.body.innerHTML = ''
  })
  afterEach(() => {
    dispose()
    document.body.innerHTML = ''
  })

  it('relabels the native English labels to the product zh-CN strings', () => {
    const panel = buildPanel()
    document.body.append(panel)
    dispose = installBoardNativeRelabel(panel)

    expect(panel.querySelector('legend')?.textContent?.trim()).toBe('箭头类型')
    const button = panel.querySelector('button')!
    expect(button.getAttribute('title')).toBe('更多选项')
    expect(button.getAttribute('aria-label')).toBe('更多选项')
    expect(button.querySelector('span')?.textContent?.trim()).toBe('更多选项')
    expect(panel.textContent).toContain('画框')
    expect(panel.textContent).toContain('查找')
    expect(panel.textContent).toContain('生成')
    expect(panel.querySelector('input')?.getAttribute('placeholder')).toBe('查找')
    // Generic input values are application state, not labels; the relabel pass must never rewrite them.
    expect((panel.querySelector('[data-testid="frame-name-input"]') as HTMLInputElement).value).toBe('Frame')
  })

  it('relabels nodes mounted after the observer starts (panel re-render)', () => {
    const root = document.createElement('div')
    document.body.append(root)
    dispose = installBoardNativeRelabel(root)
    const panel = buildPanel()
    root.append(panel)
    // Let the MutationObserver microtask flush.
    return Promise.resolve().then(() => {
      expect(panel.querySelector('legend')?.textContent?.trim()).toBe('箭头类型')
      expect(panel.querySelector('button')?.getAttribute('aria-label')).toBe('更多选项')
    })
  })

  it('leaves the English labels untouched under an English locale', () => {
    h.locale = 'en-US'
    const panel = buildPanel()
    document.body.append(panel)
    dispose = installBoardNativeRelabel(panel)

    expect(panel.querySelector('legend')?.textContent?.trim()).toBe('Arrow type')
    expect(panel.querySelector('button')?.getAttribute('aria-label')).toBe('More options')
  })

  it('is idempotent — a second pass does not compound the replacement', () => {
    const panel = buildPanel()
    document.body.append(panel)
    dispose = installBoardNativeRelabel(panel)
    // A second install over already-translated DOM must be a no-op (source no longer present).
    const second = installBoardNativeRelabel(panel)
    expect(panel.querySelector('legend')?.textContent?.trim()).toBe('箭头类型')
    expect(panel.querySelector('button')?.getAttribute('aria-label')).toBe('更多选项')
    second()
  })

  it('relabels the arrow-type options and crow-foot arrowheads to zh-CN', () => {
    const panel = buildArrowSubmenu()
    document.body.append(panel)
    dispose = installBoardNativeRelabel(panel)

    const titleOf = (tid: string) =>
      panel.querySelector(`[data-testid="${tid}"]`)?.closest('label')?.getAttribute('title')
    expect(titleOf('sharp-arrow')).toBe('直线箭头')
    expect(titleOf('round-arrow')).toBe('曲线箭头')
    expect(titleOf('elbow-arrow')).toBe('折线箭头')

    const buttons = panel.querySelectorAll('.picker button')
    // aria-label is the exact string → fully swapped.
    expect(buttons[0].getAttribute('aria-label')).toBe('鸦爪（一）')
    expect(buttons[1].getAttribute('aria-label')).toBe('鸦爪（多）')
    expect(buttons[2].getAttribute('aria-label')).toBe('鸦爪（一或多）')
    // title carries a ` — <shortcut>` suffix → only the label prefix is swapped, suffix kept.
    expect(buttons[0].getAttribute('title')).toBe('鸦爪（一） — Q')
    expect(buttons[1].getAttribute('title')).toBe('鸦爪（多） — X')
    expect(buttons[2].getAttribute('title')).toBe('鸦爪（一或多） — C')
  })

  it('leaves the arrow-type/crow-foot labels untouched under an English locale', () => {
    h.locale = 'en-US'
    const panel = buildArrowSubmenu()
    document.body.append(panel)
    dispose = installBoardNativeRelabel(panel)

    expect(panel.querySelector('[data-testid="sharp-arrow"]')?.closest('label')?.getAttribute('title')).toBe('Sharp arrow')
    const first = panel.querySelector('.picker button')!
    expect(first.getAttribute('aria-label')).toBe("Crow's foot (one)")
    expect(first.getAttribute('title')).toBe("Crow's foot (one) — Q")
  })
})
