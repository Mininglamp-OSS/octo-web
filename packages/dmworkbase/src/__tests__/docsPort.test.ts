import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EndpointManager } from '../Service/Module'
import { EndpointID } from '../Service/Const'

// App.tsx 的 import 图很重（lottie / canvas / semi 等），而本用例只需要 remoteConfig.docsOn
// 和 endpointManager 两个字段，所以把 App 替成轻量替身（与 remoteConfig.test.ts 同策略）。
// endpointManager 直接用真实的 EndpointManager 单例，保证测的是真的注册/查找语义。
const { fakeApp } = vi.hoisted(() => ({
  fakeApp: {
    remoteConfig: { docsOn: false },
    // 真实的 EndpointManager 单例在工厂里拿不到（hoist 到文件顶部），
    // 先占位，导入后在下方回填。
    endpointManager: null as unknown as typeof EndpointManager.shared,
  },
}))
vi.mock('../../App', () => ({ default: fakeApp }))
vi.mock('../App', () => ({ default: fakeApp }))
fakeApp.endpointManager = EndpointManager.shared

import {
  convertMarkdownToDoc,
  isDocsConvertAvailable,
  DocsCapabilityUnavailableError,
} from '../bridge/docs/docsPort'

/**
 * docs 能力端口的契约测试。
 *
 * 这个端口是 OSS host 与已闭源 docs 模块之间的唯一接触面（#1363 把 packages/docs
 * 拆走之后，OSS 侧不得再直连 docs-backend REST）。它必须保证：
 *  - 没人注册实现时不假装可用，也不静默返回 undefined，而是显式抛错；
 *  - docsOn 关闭时即便实现已注册也报告不可用（后端可能压根没部署）；
 *  - 实现方抛出的错误原样透传，不被端口吞掉或改写。
 */
describe('bridge/docs/docsPort', () => {
  beforeEach(() => {
    EndpointManager.shared.removeMethod(EndpointID.docsConvertMarkdown)
    fakeApp.remoteConfig.docsOn = false
  })

  describe('isDocsConvertAvailable', () => {
    it('docsOn 关闭 + 未注册 → 不可用', () => {
      expect(isDocsConvertAvailable()).toBe(false)
    })

    it('已注册但 docsOn 关闭 → 不可用（后端可能未部署，入口应隐藏）', () => {
      EndpointManager.shared.setMethod(EndpointID.docsConvertMarkdown, async () => ({
        docId: 'd1',
        url: '/d/d1',
      }))
      expect(isDocsConvertAvailable()).toBe(false)
    })

    it('docsOn 打开但无人注册 → 不可用（纯 OSS bundle 里没有 docs 模块）', () => {
      fakeApp.remoteConfig.docsOn = true
      expect(isDocsConvertAvailable()).toBe(false)
    })

    it('docsOn 打开 + 已注册 → 可用', () => {
      fakeApp.remoteConfig.docsOn = true
      EndpointManager.shared.setMethod(EndpointID.docsConvertMarkdown, async () => ({
        docId: 'd1',
        url: '/d/d1',
      }))
      expect(isDocsConvertAvailable()).toBe(true)
    })
  })

  describe('convertMarkdownToDoc', () => {
    it('端口未注册 → 抛 DocsCapabilityUnavailableError（而不是返回 undefined）', async () => {
      fakeApp.remoteConfig.docsOn = true
      await expect(convertMarkdownToDoc({ title: 't', markdown: '# hi' })).rejects.toBeInstanceOf(
        DocsCapabilityUnavailableError,
      )
    })

    it('把 title / markdown 原样透传给实现方，并回传 docId + url', async () => {
      const handler = vi.fn(async () => ({ docId: 'doc-42', url: '/d/doc-42' }))
      fakeApp.remoteConfig.docsOn = true
      EndpointManager.shared.setMethod(EndpointID.docsConvertMarkdown, handler)

      const result = await convertMarkdownToDoc({ title: '周报', markdown: '# 本周进展' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ title: '周报', markdown: '# 本周进展' })
      expect(result).toEqual({ docId: 'doc-42', url: '/d/doc-42' })
    })

    it('实现方内部失败时错误原样透传，端口不吞不改写', async () => {
      const boom = Object.assign(new Error('payload too large'), {
        response: { status: 413, data: { msg: '文档内容超出上限' } },
      })
      fakeApp.remoteConfig.docsOn = true
      EndpointManager.shared.setMethod(EndpointID.docsConvertMarkdown, async () => {
        throw boom
      })

      await expect(convertMarkdownToDoc({ title: 't', markdown: 'x' })).rejects.toBe(boom)
    })

    it('回滚是实现方职责：端口不因失败做任何补偿调用', async () => {
      const handler = vi.fn(async () => {
        throw new Error('import failed')
      })
      fakeApp.remoteConfig.docsOn = true
      EndpointManager.shared.setMethod(EndpointID.docsConvertMarkdown, handler)

      await expect(convertMarkdownToDoc({ title: 't', markdown: 'x' })).rejects.toThrow(
        'import failed',
      )
      // 端口只调一次实现方，不会自作主张再发删除/重试请求。
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })
})
