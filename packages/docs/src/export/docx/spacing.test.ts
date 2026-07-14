import { describe, it, expect } from 'vitest'
import { LineRuleType } from 'docx'
import { mapSpacing } from './styles.ts'

// v17 line spacing → docx <w:spacing>. line-height is a unitless multiplier mapped to Word's
// 240ths-of-a-line with lineRule AUTO; spaceBefore/spaceAfter (px|em) map to twips
// (15 twips/px, 16px/em). Hostile/absent values are dropped so no invalid OOXML is emitted.
describe('mapSpacing (docx line spacing, SCHEMA_VERSION 17)', () => {
  it('maps a unitless line-height to line + AUTO lineRule', () => {
    expect(mapSpacing({ lineHeight: '1.5' })).toEqual({ line: 360, lineRule: LineRuleType.AUTO })
    expect(mapSpacing({ lineHeight: '1' })).toEqual({ line: 240, lineRule: LineRuleType.AUTO })
    expect(mapSpacing({ lineHeight: '1.15' })).toEqual({ line: 276, lineRule: LineRuleType.AUTO })
  })

  it('maps px/em spacing to twips (before/after)', () => {
    expect(mapSpacing({ spaceBefore: '12px' })).toEqual({ before: 180 })
    expect(mapSpacing({ spaceAfter: '8px' })).toEqual({ after: 120 })
    // 1em = 16px = 240 twips.
    expect(mapSpacing({ spaceBefore: '1em' })).toEqual({ before: 240 })
  })

  it('combines all three into one spacing object', () => {
    expect(mapSpacing({ lineHeight: '2', spaceBefore: '12px', spaceAfter: '8px' })).toEqual({
      line: 480,
      lineRule: LineRuleType.AUTO,
      before: 180,
      after: 120,
    })
  })

  it('returns undefined when nothing applies or values are invalid', () => {
    expect(mapSpacing(undefined)).toBeUndefined()
    expect(mapSpacing({})).toBeUndefined()
    expect(mapSpacing({ lineHeight: '0' })).toBeUndefined()
    expect(mapSpacing({ lineHeight: '1.5px' })).toBeUndefined()
    expect(mapSpacing({ spaceBefore: '12pt', spaceAfter: '2rem' })).toBeUndefined()
    expect(mapSpacing({ textAlign: 'center' })).toBeUndefined()
  })
})
