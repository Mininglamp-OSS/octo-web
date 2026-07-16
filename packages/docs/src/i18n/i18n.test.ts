import { describe, it, expect, vi, beforeEach } from 'vitest'
import { i18n } from '@octo/base'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { DocsModule } from '../module.tsx'
import zhCN from './zh-CN.json'
import enUS from './en-US.json'

/** Recursively flatten a nested message tree into dotted leaf keys (mirrors I18nService). */
function flattenKeys(tree: unknown, prefix = ''): string[] {
  if (tree === null || typeof tree !== 'object') return []
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') return flattenKeys(value, next)
    return [next]
  })
}

describe('docs i18n', () => {
  it('zh-CN and en-US have an identical key shape (parity guard)', () => {
    const zhKeys = flattenKeys(zhCN).sort()
    const enKeys = flattenKeys(enUS).sort()
    // Surface the exact divergence if it ever drifts, not just a boolean.
    const onlyInZh = zhKeys.filter((k) => !enKeys.includes(k))
    const onlyInEn = enKeys.filter((k) => !zhKeys.includes(k))
    expect(onlyInZh, 'keys only in zh-CN').toEqual([])
    expect(onlyInEn, 'keys only in en-US').toEqual([])
    expect(zhKeys).toEqual(enKeys)
  })

  it('exposes the documented top-level key groups', () => {
    const groups = ['toolbar', 'slash', 'version', 'comment', 'invite', 'role', 'state', 'error']
    for (const g of groups) {
      expect(Object.prototype.hasOwnProperty.call(enUS, g), `en-US missing group ${g}`).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(zhCN, g), `zh-CN missing group ${g}`).toBe(true)
    }
  })

  // XIN-1048 #7a: the font-family default option read a bare "默认"/"Default" — the same string as
  // the font-SIZE default — so users could not tell which "默认" belonged to which control. The
  // font-family default is now explicitly labelled, and the font-size default is left untouched.
  it('labels the font-family default distinctly from the font-size default', () => {
    expect(zhCN.toolbar.fontFamilyDefault).toBe('默认字体')
    expect(enUS.toolbar.fontFamilyDefault).toBe('Default font')
    // The size default must NOT have been swept up in the change.
    expect(zhCN.toolbar.fontSizeDefault).toBe('默认')
    expect(enUS.toolbar.fontSizeDefault).toBe('Default')
    expect(zhCN.toolbar.fontFamilyDefault).not.toBe(zhCN.toolbar.fontSizeDefault)
    expect(enUS.toolbar.fontFamilyDefault).not.toBe(enUS.toolbar.fontSizeDefault)
  })

  // The member row shows the join source ("direct" / "invite") after a non-owner's name. Those
  // values were rendered as the raw enum key, so a zh-CN user saw the English word " · direct".
  // They are now localized through docs.member.source.*.
  it('localizes the member source label in both locales', () => {
    expect(zhCN.member.source.direct).toBe('直接添加')
    expect(zhCN.member.source.invite).toBe('邀请加入')
    expect(enUS.member.source.direct).toBe('Direct')
    expect(enUS.member.source.invite).toBe('Invite')
  })
})

describe('DocsModule i18n registration', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
  })

  it('registers the "docs" namespace with both locales on init()', () => {
    const spy = vi.spyOn(i18n, 'registerNamespace')
    new DocsModule().init()
    expect(spy).toHaveBeenCalledWith(
      'docs',
      expect.objectContaining({ 'zh-CN': expect.any(Object), 'en-US': expect.any(Object) }),
    )
    spy.mockRestore()
  })
})
