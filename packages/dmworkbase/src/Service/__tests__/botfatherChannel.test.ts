import { describe, it, expect } from 'vitest'
import { isBotfatherChannelID, BOTFATHER_UID } from '../botfatherChannel'

/**
 * botfatherChannel —— DAP「BotFather 命令使用分布」图分母(botfather_opened)与分子(botfather
 * 命令事件)共用的 channel-id 判定的运行时钉子。核心断言:Space 部署的真实 channelID
 * `sminglue_default_botfather`(spaceId=minglue_default,**非 32-hex**)必须命中——这是硬等
 * `=== "botfather"` 会漏、且 stripSpacePrefix(仅认 32-hex spaceId)也脱不掉的那一类,PR #1510 P1-1。
 * 后端对照:pkg/space/channel_test.go:12 钉 BuildChannelID("minglue_default","botfather")
 * = "sminglue_default_botfather";modules/botfather/api.go:168 用 HasSuffix("_botfather")。
 */
describe('isBotfatherChannelID', () => {
    it('裸 botfather(无 Space 部署)命中', () => {
        expect(isBotfatherChannelID('botfather')).toBe(true)
        expect(isBotfatherChannelID(BOTFATHER_UID)).toBe(true)
    })

    it('真实 Space 部署 sminglue_default_botfather 命中(spaceId 非 32-hex,stripSpacePrefix 脱不掉)', () => {
        expect(isBotfatherChannelID('sminglue_default_botfather')).toBe(true)
    })

    it('任意字符串 spaceId 前缀均命中', () => {
        expect(isBotfatherChannelID('ssp1_botfather')).toBe(true)
        expect(isBotfatherChannelID('s42_botfather')).toBe(true)
        // 32-hex 形式(stripSpacePrefix 唯一能脱的一类)同样命中
        expect(isBotfatherChannelID('s0123456789abcdef0123456789abcdef_botfather')).toBe(true)
    })

    it('非 botfather 频道不命中', () => {
        expect(isBotfatherChannelID('someuser')).toBe(false)
        expect(isBotfatherChannelID('sminglue_default_someuser')).toBe(false)
        expect(isBotfatherChannelID('')).toBe(false)
    })

    it('无下划线分隔的相似串不误命中(仅裸相等或 _botfather 后缀)', () => {
        expect(isBotfatherChannelID('xbotfather')).toBe(false)
        expect(isBotfatherChannelID('botfather_helper')).toBe(false)
    })
})
