import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { HtmlVersionPanel } from './HtmlVersionPanel.tsx'
import type { HtmlDocVersion } from './htmlDocVersions.ts'

afterEach(() => cleanup())

const versions: HtmlDocVersion[] = [
  { n: 3, created_at: '2026-07-16T04:00:00Z' },
  { n: 2, created_at: '2026-07-15T04:00:00Z' },
  { n: 1, created_at: '2026-07-14T04:00:00Z' },
]

function renderPanel(overrides: Partial<React.ComponentProps<typeof HtmlVersionPanel>> = {}) {
  const onView = vi.fn()
  const onCompare = vi.fn()
  render(
    <HtmlVersionPanel versions={versions} currentVersion={3} onView={onView} onCompare={onCompare} {...overrides} />,
  )
  return { onView, onCompare }
}

describe('HtmlVersionPanel', () => {
  it('renders one row per version with 查看 / 与上一版比较 / 与当前版比较 actions', () => {
    renderPanel()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    // v2 (middle) has a previous (v1) and is not current → all three actions present.
    const v2 = rows[1]
    expect(within(v2).getByText('docs.version.view')).toBeTruthy()
    expect(within(v2).getByText('docs.version.comparePrev')).toBeTruthy()
    expect(within(v2).getByText('docs.version.compareCurrent')).toBeTruthy()
  })

  it('查看 fires onView with the numeric version and is disabled on the current row', () => {
    const { onView } = renderPanel()
    const rows = screen.getAllByRole('listitem')
    // Current version (v3, first row) → view button disabled.
    const v3View = within(rows[0]).getByText('docs.version.view').closest('button')!
    expect(v3View.disabled).toBe(true)
    // v2 view enabled.
    fireEvent.click(within(rows[1]).getByText('docs.version.view'))
    expect(onView).toHaveBeenCalledWith(2)
  })

  it('与上一版比较 compares against the numerically previous version (older row)', () => {
    const { onCompare } = renderPanel()
    const rows = screen.getAllByRole('listitem')
    // v3 row: prev is v2 → compare(2, 3).
    fireEvent.click(within(rows[0]).getByText('docs.version.comparePrev'))
    expect(onCompare).toHaveBeenCalledWith(2, 3)
  })

  it('oldest row has no 与上一版比较 (no previous version)', () => {
    renderPanel()
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[2]).queryByText('docs.version.comparePrev')).toBeNull()
  })

  it('与当前版比较 compares against current with from<to ordering', () => {
    const { onCompare } = renderPanel()
    const rows = screen.getAllByRole('listitem')
    // v1 (last) vs current v3 → compare(1, 3).
    fireEvent.click(within(rows[2]).getByText('docs.version.compareCurrent'))
    expect(onCompare).toHaveBeenCalledWith(1, 3)
  })

  it('shows loading / error / empty states', () => {
    cleanup()
    const noop = vi.fn()
    render(<HtmlVersionPanel versions={[]} loading onView={noop} onCompare={noop} />)
    expect(screen.getByText('docs.version.loadingList')).toBeTruthy()
    cleanup()
    render(<HtmlVersionPanel versions={[]} error="boom" onView={noop} onCompare={noop} />)
    expect(screen.getByText('boom')).toBeTruthy()
    cleanup()
    render(<HtmlVersionPanel versions={[]} onView={noop} onCompare={noop} />)
    expect(screen.getByText('docs.version.empty')).toBeTruthy()
  })
})
