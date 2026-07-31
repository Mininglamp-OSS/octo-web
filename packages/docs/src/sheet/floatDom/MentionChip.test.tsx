import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MentionChip } from './MentionChip.tsx'

describe('MentionChip semantic theme', () => {
  it('uses host mention tokens instead of the retired structural blue', () => {
    render(<MentionChip data={{ id: 'u1', label: 'Alice', type: 'user' }} />)

    const chip = screen.getByTitle('Alice')
    expect(chip.style.color).toBe('var(--wk-text-mention-entity, #6B3DD8)')
    expect(chip.style.background).toBe('var(--wk-accent-tint-08, rgba(107, 61, 216, 0.08))')
    expect(chip.style.borderRadius).toBe('var(--wk-r-mention-entity, 4px)')
    expect(chip.getAttribute('style')).not.toMatch(/#1664ff|22,\s*100,\s*255/i)
  })
})
