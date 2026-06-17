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
