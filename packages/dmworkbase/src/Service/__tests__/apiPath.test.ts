import { describe, it, expect, beforeEach } from 'vitest'
import axios from 'axios'
import APIClient from '../APIClient'
import { apiPath, registerRequestTemplate, templateForPathname, __resetApiPathRegistry } from '../apiPath'

/**
 * apiPath 单测:携带路由模板的路径构造器(埋点 http_request path 治本方案)。
 * 验证三件事:① 具体串照旧可用;② 插值段一律占位 :id、静态段原样保留;
 * ③ registerRequestTemplate 按 baseURL 拼出的 pathname 精确登记,templateForPathname 命中。
 */
describe('apiPath — route-template carrier', () => {
    beforeEach(() => __resetApiPathRegistry())

    it('returns the concrete interpolated path (drop-in for axios path arg)', () => {
        const spaceId = '8f3a'
        const categoryId = '12'
        const p = apiPath`/spaces/${spaceId}/categories/${categoryId}`
        expect(p).toBe('/spaces/8f3a/categories/12')
    })

    it('registers a template: literal segments verbatim, interpolated segments → :id, with baseURL prefix', () => {
        const p = apiPath`/spaces/${'8f3a'}/categories/${'12'}`
        registerRequestTemplate(p, '/api/v1/')
        // Dap 看到的最终 pathname(baseURL 前缀 + 具体路径)
        expect(templateForPathname('/api/v1/spaces/8f3a/categories/12')).toBe(
            '/api/v1/spaces/:id/categories/:id',
        )
    })

    it('same endpoint → one stable template regardless of id shape (numeric / uuid / short hex)', () => {
        for (const id of ['12', '550e8400-e29b-41d4-a716-446655440000', '8f3a']) {
            __resetApiPathRegistry()
            const p = apiPath`/groups/${id}/setting`
            registerRequestTemplate(p, '/api/v1/')
            expect(templateForPathname(`/api/v1/groups/${id}/setting`)).toBe('/api/v1/groups/:id/setting')
        }
    })

    it('handles both leading-slash and no-leading-slash call sites (axios combineURLs semantics)', () => {
        const a = apiPath`groups/${'99'}/members`
        registerRequestTemplate(a, '/api/v1/')
        expect(templateForPathname('/api/v1/groups/99/members')).toBe('/api/v1/groups/:id/members')
    })

    it('purely static paths are not registered (concrete === template, nothing to carry)', () => {
        const p = apiPath`/common/appconfig`
        expect(p).toBe('/common/appconfig')
        registerRequestTemplate(p, '/api/v1/')
        expect(templateForPathname('/api/v1/common/appconfig')).toBeUndefined()
    })

    it('absolute backend baseURL (desktop): pathname still aligns, template carries', () => {
        const p = apiPath`/spaces/${'abcd'}/docs/${'x1'}`
        // axios: 相对 url + 绝对 baseURL → 绝对 URL;pathname 一致
        registerRequestTemplate(p, 'https://host.example.com/v1/')
        expect(templateForPathname('/v1/spaces/abcd/docs/x1')).toBe('/v1/spaces/:id/docs/:id')
    })

    it('non-apiPath urls are inert: registerRequestTemplate no-ops, lookup misses', () => {
        registerRequestTemplate('/spaces/raw/12', '/api/v1/')
        expect(templateForPathname('/api/v1/spaces/raw/12')).toBeUndefined()
    })

    it('lookup does not consume: concurrent same-endpoint requests both hit', () => {
        const p = apiPath`/groups/${'7'}/exit`
        registerRequestTemplate(p, '/api/v1/')
        expect(templateForPathname('/api/v1/groups/7/exit')).toBe('/api/v1/groups/:id/exit')
        // 第二次读仍命中(读不消费)
        expect(templateForPathname('/api/v1/groups/7/exit')).toBe('/api/v1/groups/:id/exit')
    })
})

/**
 * 端到端接线:走真实 APIClient.shared → 全局 axios 的 request interceptor → registry。
 * 用 adapter stub 短路网络。证明"apiPath 具体串 + 真实 baseURL 组合出的 pathname"与
 * Dap 侧按 pathname 命中的 key 完全对齐(整套机制的关键假设)。
 */
describe('apiPath — end-to-end through APIClient interceptor', () => {
    const client = APIClient.shared
    beforeEach(() => {
        __resetApiPathRegistry()
        client.config.apiURL = '/api/v1/' // 同时把 axios.defaults.baseURL 设为 /api/v1/
        axios.defaults.adapter = async (config) => ({
            data: {}, status: 200, statusText: 'OK', headers: {}, config, request: {},
        }) as never
    })

    it('a real APIClient.get(apiPath`...`) registers a template Dap will find at the final pathname', async () => {
        await client.get(apiPath`/spaces/${'8f3a'}/categories/${'12'}`)
        // Dap 看到的 XHR pathname = baseURL 组合后的 /api/v1/spaces/8f3a/categories/12
        expect(templateForPathname('/api/v1/spaces/8f3a/categories/12')).toBe(
            '/api/v1/spaces/:id/categories/:id',
        )
    })

    it('a plain (non-apiPath) path registers nothing', async () => {
        await client.get('/spaces/8f3a/categories/12')
        expect(templateForPathname('/api/v1/spaces/8f3a/categories/12')).toBeUndefined()
    })
})
