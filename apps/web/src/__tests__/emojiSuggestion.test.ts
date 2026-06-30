import { describe, it, expect } from 'vitest'
import {
  getCustomEmojiItems,
  buildEmojiSuggestItems,
  matchEmojiPrefix,
  MIN_QUERY_LEN,
} from '../../../../packages/dmworkbase/src/Utils/emojiSuggestion'

/**
 * 表情前缀联想核心逻辑测试。依赖真实 DefaultEmojiService 单例中的 4 个
 * 中文 key 自定义表情：[使命必达] [崇尚行动] [有品位] [尚方宝剑]。
 */

describe('getCustomEmojiItems', () => {
  it('only returns custom (bracketed Chinese) emojis, not Unicode emojis', () => {
    const items = getCustomEmojiItems()
    expect(items.length).toBe(4)
    const keys = items.map((e) => e.key)
    // 仅断言集合相等，不约束顺序（getAllEmoji 的返回顺序不是契约）
    expect(new Set(keys)).toEqual(
      new Set(['[使命必达]', '[崇尚行动]', '[有品位]', '[尚方宝剑]']),
    )
  })

  it('strips brackets into label and carries an image path', () => {
    const mission = getCustomEmojiItems().find((e) => e.key === '[使命必达]')
    expect(mission).toBeDefined()
    expect(mission!.label).toBe('使命必达')
    expect(mission!.image).toContain('custom_mission')
  })
})

describe('matchEmojiPrefix — prefix matching (v1)', () => {
  it('matches a prefix: 「使命」→ [使命必达]', () => {
    const r = matchEmojiPrefix('使命')
    expect(r).not.toBeNull()
    expect(r!.query).toBe('使命')
    expect(r!.items.map((e) => e.key)).toContain('[使命必达]')
  })

  it('does NOT match a mid-string substring: 「必达」→ null', () => {
    expect(matchEmojiPrefix('必达')).toBeNull()
  })

  it('does NOT trigger on a single character: 「使」→ null', () => {
    expect(matchEmojiPrefix('使')).toBeNull()
  })

  it('does NOT trigger when the name is embedded in a phrase: 「我要完成使命」→ null', () => {
    // 词边界规则：光标前最长连续中文整段须是表情名前缀。「我要完成使命」整段
    // 不是任何表情名前缀 → 不触发，与「公司的使命是」「使命是xxx」一致，避免句中误弹。
    expect(matchEmojiPrefix('我要完成使命')).toBeNull()
  })

  it('does NOT co-fire inside an @ mention / slash context: 「@使命」「/使命」→ null', () => {
    // 中文串紧邻的前一字符是其它 suggestion 触发符时不触发，避免与 mention /
    // slash 候选同时弹出抢键盘。
    expect(matchEmojiPrefix('@使命')).toBeNull()
    expect(matchEmojiPrefix('/使命')).toBeNull()
    // 句中的 @：前一字符仍是 @ → 不触发
    expect(matchEmojiPrefix('hi @使命')).toBeNull()
  })

  it('does NOT trigger right after a bracket: 「[使命」→ null', () => {
    // [ 是表情 key 起始符，替换 query 后会残留前导 [，故守卫掉。
    expect(matchEmojiPrefix('[使命')).toBeNull()
  })

  it('still triggers after a non-reserved boundary char: 「[尚方宝剑]崇尚」→ 崇尚', () => {
    // ] 不是保留前导符，紧随其后的连续中文应正常联想。
    const r = matchEmojiPrefix('[尚方宝剑]崇尚')
    expect(r).not.toBeNull()
    expect(r!.query).toBe('崇尚')
    expect(r!.items.map((e) => e.key)).toContain('[崇尚行动]')
  })

  it('prefers the longest matching prefix: 「使命必」→ 使命必', () => {
    const r = matchEmojiPrefix('使命必')
    expect(r).not.toBeNull()
    expect(r!.query).toBe('使命必')
    expect(r!.items.map((e) => e.key)).toEqual(['[使命必达]'])
  })

  it('matches other custom emojis: 「尚方」→ [尚方宝剑], 「崇尚」→ [崇尚行动]', () => {
    expect(matchEmojiPrefix('尚方')!.items.map((e) => e.key)).toContain(
      '[尚方宝剑]',
    )
    expect(matchEmojiPrefix('崇尚')!.items.map((e) => e.key)).toContain(
      '[崇尚行动]',
    )
  })

  it('returns null for non-matching latin / unicode input', () => {
    expect(matchEmojiPrefix('hello')).toBeNull()
    expect(matchEmojiPrefix('😀😀')).toBeNull()
  })

  it('returns null for empty / too-short input', () => {
    expect(matchEmojiPrefix('')).toBeNull()
    expect('使'.length).toBeLessThan(MIN_QUERY_LEN)
  })
})

describe('buildEmojiSuggestItems', () => {
  it('prefix-filters custom emojis by query', () => {
    expect(buildEmojiSuggestItems('使命').map((e) => e.key)).toEqual([
      '[使命必达]',
    ])
  })

  it('returns empty for query shorter than min length', () => {
    expect(buildEmojiSuggestItems('使')).toEqual([])
    expect(buildEmojiSuggestItems('')).toEqual([])
  })

  it('returns empty for a non-prefix substring', () => {
    expect(buildEmojiSuggestItems('必达')).toEqual([])
  })
})
