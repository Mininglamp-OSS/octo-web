import { describe, it, expect } from 'vitest'
import { buildSpaceAdminUrl } from '../Pages/Main/spaceAdminUrl'

describe('buildSpaceAdminUrl', () => {
  it('有当前空间时,带上 ?spaceId=', () => {
    expect(buildSpaceAdminUrl('abc123')).toBe('/admin/space?spaceId=abc123')
  })

  it('空串 / undefined / null 时,回退到不带参数的 /admin/space,由后台走默认逻辑', () => {
    expect(buildSpaceAdminUrl('')).toBe('/admin/space')
    expect(buildSpaceAdminUrl(undefined)).toBe('/admin/space')
    expect(buildSpaceAdminUrl(null)).toBe('/admin/space')
  })

  it('包含需要编码字符的 id 会被 encodeURIComponent 处理,避免破坏 URL', () => {
    expect(buildSpaceAdminUrl('a b&c=d')).toBe('/admin/space?spaceId=a%20b%26c%3Dd')
  })

  it('目标是管理后台的 SPA 实际路径 /admin/space,不走 /space 短链 301 以避免 query 丢失', () => {
    expect(buildSpaceAdminUrl('x')).toMatch(/^\/admin\/space(\?|$)/)
    expect(buildSpaceAdminUrl(null)).toMatch(/^\/admin\/space(\?|$)/)
  })
})
