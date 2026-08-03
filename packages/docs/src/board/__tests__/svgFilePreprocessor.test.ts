import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inlineSvgPresentationStyles,
  installSvgFileInputPreprocessor,
  preprocessSvgFile,
} from '../svgFilePreprocessor.ts'

const ANNOTATION_HELP = readFileSync(resolve('src/board/__tests__/fixtures/annotation-help.svg'), 'utf8')

class TestDataTransfer {
  private readonly added: File[] = []
  readonly items = { add: (file: File) => this.added.push(file) }
  get files(): File[] { return this.added }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('native SVG file input preprocessor', () => {
  it('materializes annotation-help presentation attributes and preserves yellow', async () => {
    const file = new File([ANNOTATION_HELP], 'annotation-help.svg', { type: 'image/svg+xml' })
    const result = await preprocessSvgFile(file)
    const xml = await result.text()
    const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml')
    const rect = parsed.querySelector('rect')!

    expect(result.name).toBe('annotation-help.svg')
    expect(result.type).toBe('image/svg+xml')
    expect(xml.trimStart()).toMatch(/^<svg/)
    expect(rect.getAttribute('fill')).toBe('#ffff00')
    expect(rect.getAttribute('stroke')).toBe('#000000')
    expect(rect.getAttribute('stroke-width')).toBe('1.30826771')
    expect(rect.hasAttribute('style')).toBe(false)
  })

  it('does not promote active URL values to presentation attributes', () => {
    const result = inlineSvgPresentationStyles(
      `<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://bad.test/x);stroke:url(#safe)"/></svg>`,
    )
    const parsed = new DOMParser().parseFromString(result, 'image/svg+xml')
    const path = parsed.querySelector('path')!
    expect(path.hasAttribute('fill')).toBe(false)
    expect(path.getAttribute('stroke')).toBe('url(#safe)')
    expect(path.getAttribute('style')).toContain('fill')
  })

  it('replays one native SVG File to the consumer', async () => {
    vi.stubGlobal('DataTransfer', TestDataTransfer)
    const input = document.createElement('input')
    input.type = 'file'
    const original = new File([ANNOTATION_HELP], 'annotation-help.svg', { type: 'image/svg+xml' })
    Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [original] })
    document.body.appendChild(input)

    const consumed: File[] = []
    input.addEventListener('change', () => consumed.push(input.files![0]))
    const dispose = installSvgFileInputPreprocessor(document)
    input.dispatchEvent(new Event('change', { bubbles: true }))

    await vi.waitFor(() => expect(consumed).toHaveLength(1))
    expect(consumed[0].name).toBe('annotation-help.svg')
    expect(consumed[0].type).toBe('image/svg+xml')
    expect(await consumed[0].text()).toContain('fill="#ffff00"')

    dispose()
    input.remove()
  })
})
