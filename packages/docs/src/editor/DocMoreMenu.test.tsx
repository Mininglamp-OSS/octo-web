import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DocMoreMenu, formatCreatedDate, type DocMoreMenuItem } from './DocMoreMenu.tsx'

afterEach(cleanup)

describe('formatCreatedDate', () => {
  it('slices an ISO-8601 timestamp lexically (no timezone drift)', () => {
    expect(formatCreatedDate('2026-07-02T23:59:00Z')).toBe('2026-07-02')
    expect(formatCreatedDate('2026-01-05')).toBe('2026-01-05')
  })
  it('returns null for missing / unparseable input', () => {
    expect(formatCreatedDate(undefined)).toBeNull()
    expect(formatCreatedDate('')).toBeNull()
    expect(formatCreatedDate('not-a-date')).toBeNull()
  })
})

describe('DocMoreMenu', () => {
  const items: DocMoreMenuItem[] = [
    { key: 'a', label: 'Open in new page', icon: null, onClick: vi.fn() },
    { key: 'b', label: 'Version history', icon: null, onClick: vi.fn() },
  ]

  it('is closed by default and toggles open on the ≡ trigger', () => {
    render(<DocMoreMenu creatorName="Alice" createdAt="2026-07-02T10:00:00Z" items={items} />)
    expect(screen.queryByText('Version history')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'docs.toolbar.more' }))
    expect(screen.getByText('Version history')).toBeTruthy()
    // Head shows creator + created-on line.
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText(/2026-07-02/)).toBeTruthy()
  })

  it('renders the danger item with the is-danger class and fires its handler', () => {
    const onDelete = vi.fn()
    const danger: DocMoreMenuItem = {
      key: 'del',
      label: 'Delete document',
      icon: null,
      danger: true,
      onClick: onDelete,
    }
    render(<DocMoreMenu creatorName="Bob" items={items} dangerItem={danger} />)
    fireEvent.click(screen.getByRole('button', { name: 'docs.toolbar.more' }))
    const row = screen.getByText('Delete document').closest('button')!
    expect(row.className).toContain('is-danger')
    fireEvent.click(row)
    expect(onDelete).toHaveBeenCalledTimes(1)
    // Selecting an item closes the menu.
    expect(screen.queryByText('Delete document')).toBeNull()
  })

  it('renders neutral rows top-to-bottom in the given order (first item is the first row)', () => {
    // Locks the ordering the standalone page relies on: a lead row (e.g. Copy link) prepended by
    // the host lands as the FIRST menu row (AC-2).
    render(
      <DocMoreMenu
        creatorName="Alice"
        items={[
          { key: 'copy-link', label: 'Copy link', icon: null, onClick: vi.fn() },
          ...items,
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'docs.toolbar.more' }))
    const labels = Array.from(document.querySelectorAll('.octo-doc-more-label')).map(
      (n) => n.textContent,
    )
    expect(labels).toEqual(['Copy link', 'Open in new page', 'Version history'])
  })

  it('closes on an outside pointer-down', () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <DocMoreMenu creatorName="Bob" items={items} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'docs.toolbar.more' }))
    expect(screen.getByText('Version history')).toBeTruthy()
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByText('Version history')).toBeNull()
  })

  it('drops the created-on row when the timestamp is absent', () => {
    render(<DocMoreMenu creatorName="Bob" items={items} />)
    fireEvent.click(screen.getByRole('button', { name: 'docs.toolbar.more' }))
    expect(screen.queryByText(/docs\.moreMenu\.createdPrefix/)).toBeNull()
  })
})
describe('DocMoreMenu — creator avatar (OCT-194)', () => {
  it('renders an <img> when creatorAvatarUrl is present', () => {
    render(
      <DocMoreMenu creatorName="Alice" creatorAvatarUrl="/api/v1/users/u1/avatar" items={[]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'docs.toolbar.more' }))
    const img = document.querySelector('img.octo-doc-more-avatar') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('/api/v1/users/u1/avatar')
    // Fallback initial chip is NOT rendered when the image is showing (avoid double head).
    expect(document.querySelector('span.octo-doc-more-avatar')).toBeNull()
  })

  it('falls back to the initial-letter chip when the avatar image fails to load', () => {
    render(
      <DocMoreMenu creatorName="Alice" creatorAvatarUrl="/api/v1/users/u1/avatar" items={[]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'docs.toolbar.more' }))
    const img = document.querySelector('img.octo-doc-more-avatar') as HTMLImageElement
    fireEvent.error(img)
    expect(document.querySelector('img.octo-doc-more-avatar')).toBeNull()
    expect(document.querySelector('span.octo-doc-more-avatar')?.textContent).toBe('A')
  })

  it('renders the initial-letter chip when creatorAvatarUrl is absent (existing behaviour)', () => {
    render(<DocMoreMenu creatorName="Bob" items={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'docs.toolbar.more' }))
    expect(document.querySelector('img.octo-doc-more-avatar')).toBeNull()
    expect(document.querySelector('span.octo-doc-more-avatar')?.textContent).toBe('B')
  })
})

