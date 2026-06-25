import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { StatusBar, type SyncProvider } from './StatusBar.tsx'

// The autosave indicator is display-only and driven purely by local signals: editor
// `update` events and the collab provider's sync state. These tests drive a minimal
// event-emitter provider stub and assert the indicator reflects pending/saved. The `t`
// stub returns i18n keys unchanged, so we assert on the stable keys.

class FakeProvider implements SyncProvider {
  hasUnsyncedChanges = false
  private cbs: Record<string, Array<(...args: unknown[]) => void>> = {}
  on(event: string, fn: (...args: unknown[]) => void) {
    ;(this.cbs[event] ||= []).push(fn)
  }
  off(event: string, fn: (...args: unknown[]) => void) {
    this.cbs[event] = (this.cbs[event] || []).filter((f) => f !== fn)
  }
  emit(event: string, ...args: unknown[]) {
    ;(this.cbs[event] || []).forEach((f) => f(...args))
  }
}

let editor: Editor | null = null

beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit], content: '<p>hello</p>' })
})

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = null
})

function autosaveText(): string {
  return (document.querySelector('.octo-editor-autosave')?.textContent || '').trim()
}

describe('StatusBar autosave indicator', () => {
  it('starts blank (idle, nothing saved yet) and keeps the word/char counts', () => {
    const provider = new FakeProvider()
    render(<StatusBar editor={editor!} provider={provider} />)
    expect(autosaveText()).toBe('')
    // Counts still render.
    expect(document.querySelector('.octo-editor-status')?.textContent).toContain('docs.status.words')
  })

  it('shows pending on an editor update', () => {
    const provider = new FakeProvider()
    render(<StatusBar editor={editor!} provider={provider} />)
    act(() => {
      editor!.chain().insertContent(' world').run()
    })
    expect(autosaveText()).toBe('docs.status.editing')
  })

  it('shows pending when the provider reports unsynced changes (> 0)', () => {
    const provider = new FakeProvider()
    render(<StatusBar editor={editor!} provider={provider} />)
    act(() => {
      provider.emit('unsyncedChanges', 2)
    })
    expect(autosaveText()).toBe('docs.status.editing')
  })

  it('shows saved with a timestamp when the provider flushes (unsyncedChanges → 0)', () => {
    const provider = new FakeProvider()
    render(<StatusBar editor={editor!} provider={provider} />)
    act(() => {
      provider.emit('unsyncedChanges', 1)
    })
    expect(autosaveText()).toBe('docs.status.editing')
    act(() => {
      provider.emit('unsyncedChanges', 0)
    })
    expect(autosaveText()).toBe('docs.status.savedAt')
  })

  it('treats the initial synced handshake (no unsynced changes) as saved', () => {
    const provider = new FakeProvider()
    provider.hasUnsyncedChanges = false
    render(<StatusBar editor={editor!} provider={provider} />)
    act(() => {
      provider.emit('synced')
    })
    expect(autosaveText()).toBe('docs.status.savedAt')
  })

  it('renders without a provider (no autosave signal, no crash)', () => {
    render(<StatusBar editor={editor!} />)
    expect(autosaveText()).toBe('')
  })
})
