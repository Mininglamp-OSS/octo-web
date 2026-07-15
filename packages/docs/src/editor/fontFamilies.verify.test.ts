import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { buildPreviewExtensions } from './extensions.ts'
import { FONT_FAMILIES } from './fontFamilies.ts'
import zhCN from '../i18n/zh-CN.json'
import enUS from '../i18n/en-US.json'

// VERIFY (XIN-936): after moving the font display names onto i18n keys, prove that (a) the CSS
// font-family *values* are byte-unchanged and still reach the DOM as `font-family:…`, and (b)
// every labelKey resolves in both locales. This is the red→green check behind the i18n refactor.

function resolve(bundle: Record<string, unknown>, key: string): string | undefined {
  // Keys are `docs.toolbar.font.x`; the JSON is registered under the `docs` namespace, so the
  // stored path drops the leading `docs.`.
  const path = key.replace(/^docs\./, '').split('.')
  let cur: unknown = bundle
  for (const seg of path) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg]
    else return undefined
  }
  return typeof cur === 'string' ? cur : undefined
}

describe('FONT_FAMILIES i18n refactor (XIN-936)', () => {
  it('keeps the CSS font-family values byte-identical to the SCHEMA_VERSION 16 spec', () => {
    const byKey = Object.fromEntries(FONT_FAMILIES.map((f) => [f.labelKey, f.value]))
    // NOTE: "微软雅黑" (yahei) was removed from the picker — Chromium reserves that family name so it
    // can't be @font-face-aliased on non-Windows; the sheet drops it for the same reason.
    expect(byKey['docs.toolbar.font.yahei']).toBeUndefined()
    expect(byKey['docs.toolbar.font.simsun']).toBe('SimSun, "宋体", serif')
    expect(byKey['docs.toolbar.font.simhei']).toBe('SimHei, "黑体", sans-serif')
    expect(byKey['docs.toolbar.font.kaiti']).toBe('KaiTi, "楷体", serif')
  })

  it('resolves every labelKey in both zh-CN and en-US', () => {
    for (const { labelKey } of FONT_FAMILIES) {
      expect(resolve(zhCN, labelKey), `${labelKey} zh-CN`).toBeTruthy()
      expect(resolve(enUS, labelKey), `${labelKey} en-US`).toBeTruthy()
    }
    // Sanity: the CJK faces localize (zh shows the Chinese name, en the romanized family name).
    expect(resolve(zhCN, 'docs.toolbar.font.simhei')).toBe('黑体')
    expect(resolve(enUS, 'docs.toolbar.font.simhei')).toBe('SimHei')
  })

  it('applies a selected value to the textStyle fontFamily attr and serializes it to the DOM', () => {
    const schema = getSchema(buildPreviewExtensions('doc-test'))
    const simhei = FONT_FAMILIES.find((f) => f.labelKey === 'docs.toolbar.font.simhei')!.value
    const textStyle = schema.marks.textStyle.create({ fontFamily: simhei })
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('黑体样张', [textStyle])]),
    ])
    const out = DOMSerializer.fromSchema(schema).serializeFragment(doc.content, {
      document: window.document,
    })
    const holder = window.document.createElement('div')
    holder.appendChild(out)
    expect(holder.innerHTML).toContain('font-family')
    expect(holder.innerHTML).toContain('SimHei')
    expect(holder.innerHTML).toContain('黑体')
  })
})
