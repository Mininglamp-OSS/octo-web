import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { DocGuide, type DocGuideKind } from './DocGuide.tsx'
import zhLocale from '../i18n/zh-CN.json'
import enLocale from '../i18n/en-US.json'

// The usage guide is the in-editor counterpart to the list-level "?" onboarding help: it explains
// how to drive THIS surface from octo-cli and — the point of the feature — where the version-accurate
// bundled skill docs live. It is mounted in all four editor headers, so the per-kind content routing
// is what these tests lock down. The i18n stub returns the key verbatim, so content assertions run
// against the shipped locale JSON rather than the rendered mock string.
beforeEach(() => {
  setWKApp(createMockWKApp())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const KINDS: DocGuideKind[] = ['doc', 'sheet', 'board', 'html']

describe('DocGuide — book-icon usage guide in the document header', () => {
  it('renders a labelled icon button for every editor surface', () => {
    for (const kind of KINDS) {
      const { unmount } = render(<DocGuide kind={kind} />)
      const btn = screen.getByTestId('doc-guide-btn')
      // Labelled control (owner decision 2026-07-28): the trigger reads like its siblings
      // (评论 / 转发到聊天 / 成员) — a real SVG icon PLUS a visible text label. An unlabelled glyph
      // read as decoration and users did not realise it was an entry point.
      expect(btn.getAttribute('aria-label')).toBe('docs.guide.open')
      expect(btn.querySelector('svg')).toBeTruthy()
      expect(btn.textContent).toBe('docs.guide.open')
      unmount()
    }
  })

  it('opens a drawer dialog and closes it on backdrop click', () => {
    render(<DocGuide kind="doc" />)
    fireEvent.click(screen.getByTestId('doc-guide-btn'))
    const panel = screen.getByRole('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    // A centred modal (matching the "?" onboarding dialog), not a side drawer.
    expect(panel.className).toContain('octo-doc-guide-dialog')
    expect(screen.getByTestId('doc-guide-body')).toBeTruthy()
    fireEvent.click(screen.getByTestId('doc-guide-overlay'))
    expect(screen.queryByTestId('doc-guide-body')).toBeNull()
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    render(<DocGuide kind="sheet" />)
    const trigger = screen.getByTestId('doc-guide-btn')
    await act(async () => {
      fireEvent.click(trigger)
    })
    // Focus moves into the drawer on open (role="dialog" + aria-modal contract).
    expect(document.activeElement).toBe(screen.getByLabelText('docs.guide.close'))
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByTestId('doc-guide-body')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('routes the command block and the skill-file callout by kind', () => {
    for (const kind of KINDS) {
      const { unmount } = render(<DocGuide kind={kind} />)
      fireEvent.click(screen.getByTestId('doc-guide-btn'))
      // Both are per-kind i18n lookups, so the key itself proves the routing.
      expect(screen.getByTestId('doc-guide-commands').textContent).toBe(`docs.guide.cmd.${kind}`)
      expect(screen.getByTestId('doc-guide-skill-file').textContent).toBe(
        `docs.guide.skillFile.${kind}`,
      )
      unmount()
    }
  })
})

describe('DocGuide content contract (shipped locales)', () => {
  for (const [name, locale] of [
    ['zh-CN', zhLocale],
    ['en-US', enLocale],
  ] as const) {
    it(`${name}: teaches prerequisites, per-surface commands, practice, pitfalls and skill discovery`, () => {
      const g = (locale as { guide: Record<string, unknown> }).guide
      expect(g).toBeTruthy()

      // Prerequisite: the CLI must be installed (unpinned) and auth verified before anything else.
      const prereq = g.prereqCode as string
      expect(prereq).toContain('npm install -g @mininglamp-oss/octo-cli@latest')
      expect(prereq).toContain('octo-cli auth status')
      expect(prereq).toContain('octo-cli config show')

      // Per-surface commands, grounded in octo-cli's real command families.
      const cmd = g.cmd as Record<DocGuideKind, string>
      expect(Object.keys(cmd).sort()).toEqual(['board', 'doc', 'html', 'sheet'])
      expect(cmd.doc).toContain('octo-cli docs content get')
      expect(cmd.doc).toContain('octo-cli docs content edit')
      expect(cmd.sheet).toContain('octo-cli docs sheet get')
      expect(cmd.sheet).toContain('octo-cli docs sheet edit')
      expect(cmd.board).toContain('octo-cli docs scene get')
      expect(cmd.board).toContain('octo-cli docs scene edit')
      // HTML docs are a separate backend: the prefix must be `html`, never `docs`.
      expect(cmd.html).toContain('octo-cli html publish')
      expect(cmd.html).not.toMatch(/octo-cli docs (content|sheet|scene)/)
      // Every mutating surface teaches the optimistic-concurrency token.
      for (const k of ['doc', 'sheet', 'board'] as const) {
        expect(cmd[k]).toContain('--base-version')
      }

      // Read-modify-write is stated as the practice, not just implied by the flag.
      expect(g.practiceBody as string).toContain('base-version')

      // The pitfalls are the ones that actually bite, each naming its fix.
      expect(g.pitfallAnchor as string).toContain('--anchorText')
      expect(g.pitfallAnchor as string).toContain('--parentId')
      expect(g.pitfallProfile as string).toContain('OCTO_BOT_ID')
      expect(g.pitfallBaseUrl as string).toContain('http://127.0.0.1:8080')

      // THE headline requirement: where the skills are and how to fetch them.
      const skillCode = g.skillCode as string
      expect(skillCode).toContain('octo-cli skills')
      expect(skillCode).toContain('octo-cli skills octo-docs')
      expect(skillCode).toContain('octo-cli skills octo-html')
      expect(skillCode).toContain('octo-cli skills --install')
      // docs/sheets/boards all live inside the octo-docs skill's reference files.
      for (const f of ['doc.md', 'sheet.md', 'board.md', 'common.md']) {
        expect(skillCode).toContain(f)
      }

      // ...and the per-surface callout names the file to read for the surface you are on.
      const sf = g.skillFile as Record<DocGuideKind, string>
      expect(Object.keys(sf).sort()).toEqual(['board', 'doc', 'html', 'sheet'])
      expect(sf.doc).toContain('doc.md')
      expect(sf.sheet).toContain('sheet.md')
      expect(sf.board).toContain('board.md')
      expect(sf.html).toContain('octo-html')

      // No secret is ever requested or assigned anywhere in the guide.
      const all = JSON.stringify(g)
      expect(all).not.toMatch(/OCTO_BOT_TOKEN\s*=/)
      expect(all).not.toMatch(/--(token|with-token)[= ]+\\?["']?(app_|bf_|uk_)/)
    })
  }

  it('keeps the section copy button mounted and focused across the copied-state flip', async () => {
    // Regression lock for SectionHead living at MODULE scope. When it was declared inside DocGuide's
    // render body it was a new function identity every render, so React unmounted and remounted the
    // whole heading subtree on each state change — and `copiedSection` changes the instant you click
    // copy. A keyboard user therefore lost focus at exactly the moment they pressed the button.
    // Asserting the identical DOM node survives is what catches a move back into the render body:
    // a pure "checkmark appears" assertion passes either way.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<DocGuide kind="doc" docId="d_1" />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-btn'))
    })

    const before = screen.getByTestId('doc-guide-copy-prereq')
    before.focus()
    expect(document.activeElement).toBe(before)

    await act(async () => {
      fireEvent.click(before)
    })

    const after = screen.getByTestId('doc-guide-copy-prereq')
    // Same node object, not merely an equivalent one — proves no remount happened.
    expect(after).toBe(before)
    expect(document.activeElement).toBe(after)
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('keeps the two locales structurally aligned', () => {
    const zh = (zhLocale as { guide: Record<string, unknown> }).guide
    const en = (enLocale as { guide: Record<string, unknown> }).guide
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(zh.cmd as object).sort()).toEqual(Object.keys(en.cmd as object).sort())
    expect(Object.keys(zh.skillFile as object).sort()).toEqual(
      Object.keys(en.skillFile as object).sort(),
    )
  })
})
