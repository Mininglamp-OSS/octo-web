// Slash command (frontend-design §3.4) — built on @tiptap/suggestion with a self-rendered menu.
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { Editor, Range } from '@tiptap/core'
import { pickAndUploadImage } from './imageUpload.ts'
import { pickAndUploadFile } from './fileUpload.ts'
import { promptAndInsertBookmark } from './bookmarkInsert.ts'
import { promptAndInsertMath } from './mathInsert.ts'
import { t } from '../octoweb/index.ts'

export interface SlashItem {
  title: string
  group: string
  /** Keywords for fuzzy matching. */
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    title: 'Heading 1',
    group: 'Basic',
    keywords: ['h1', 'title', 'heading'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    group: 'Basic',
    keywords: ['h2', 'subtitle', 'heading'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    group: 'Basic',
    keywords: ['h3', 'heading'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Heading 4',
    group: 'Basic',
    keywords: ['h4', 'heading'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run(),
  },
  {
    title: 'Heading 5',
    group: 'Basic',
    keywords: ['h5', 'heading'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 5 }).run(),
  },
  {
    title: 'Heading 6',
    group: 'Basic',
    keywords: ['h6', 'heading'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 6 }).run(),
  },
  {
    title: 'Bullet List',
    group: 'Lists',
    keywords: ['ul', 'unordered', 'bullet'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Ordered List',
    group: 'Lists',
    keywords: ['ol', 'ordered', 'number'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Task List',
    group: 'Lists',
    keywords: ['todo', 'task', 'checkbox'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Quote',
    group: 'Basic',
    keywords: ['blockquote', 'quote'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code Block',
    group: 'Basic',
    keywords: ['code', 'pre', 'snippet'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    group: 'Basic',
    keywords: ['hr', 'rule', 'divider', 'separator'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Table',
    group: 'Basic',
    keywords: ['table', 'grid', 'rows', 'columns'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: 'Image',
    group: 'Basic',
    keywords: ['image', 'img', 'picture', 'photo', 'upload'],
    // Drop the slash range first (like the other items), then pick + upload; the
    // node is inserted only after the upload succeeds (no broken node on failure).
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run()
      void pickAndUploadImage(editor)
    },
  },
  // SCHEMA_VERSION 11 — collapsible details block. Title via t() (resolved lazily at paint).
  {
    get title() {
      return t('docs.slash.collapsible')
    },
    group: 'Basic',
    keywords: ['collapsible', 'details', 'toggle', 'accordion', 'fold'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setDetails().run(),
  },
  // SCHEMA_VERSION 12 — callout (info variant by default; change via the toolbar control).
  {
    get title() {
      return t('docs.slash.callout')
    },
    group: 'Basic',
    keywords: ['callout', 'admonition', 'note', 'info', 'warning', 'tip'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCallout({ variant: 'info' }).run(),
  },
  // SCHEMA_VERSION 13 — block math (KaTeX). Prompts for the LaTeX instead of a hardcoded formula (C5).
  {
    get title() {
      return t('docs.slash.mathBlock')
    },
    group: 'Basic',
    keywords: ['math', 'formula', 'equation', 'latex', 'katex'],
    run: (editor, range) => promptAndInsertMath(editor, 'block', range),
  },
  // SCHEMA_VERSION 14 — file attachment. Drop the slash range first (like Image), then pick +
  // upload; the node is inserted only after the upload succeeds (no broken node on failure).
  {
    get title() {
      return t('docs.slash.file')
    },
    group: 'Basic',
    keywords: ['file', 'attachment', 'attach', 'upload', 'document'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run()
      void pickAndUploadFile(editor)
    },
  },
  // SCHEMA_VERSION 15 — bookmark (link preview). Drop the slash range first, then prompt for a
  // URL and insert the card once the metadata resolves (or a url-only card on fetch failure).
  {
    get title() {
      return t('docs.slash.bookmark')
    },
    group: 'Basic',
    keywords: ['bookmark', 'link', 'url', 'embed', 'preview', 'web'],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run()
      void promptAndInsertBookmark(editor)
    },
  },
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter(
    (i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q)),
  )
}

// Minimal keyboard-navigable popup. Kept dependency-free (no tippy) so it runs headless-friendly.
function createSlashMenuRenderer() {
  let el: HTMLDivElement | null = null
  let items: SlashItem[] = []
  let selected = 0
  let cmd: ((item: SlashItem) => void) | null = null

  function paint() {
    if (!el) return
    el.innerHTML = ''
    items.forEach((item, idx) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'octo-slash-item' + (idx === selected ? ' is-selected' : '')
      row.textContent = item.title
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        cmd?.(item)
      })
      el!.appendChild(row)
    })
  }

  function position(rect: DOMRect | null | undefined) {
    if (!el || !rect) return
    el.style.position = 'absolute'
    el.style.left = `${rect.left}px`
    el.style.top = `${rect.bottom + 4}px`
  }

  return {
    onStart: (props: {
      items: SlashItem[]
      command: (item: SlashItem) => void
      clientRect?: (() => DOMRect | null) | null
    }) => {
      items = props.items
      selected = 0
      cmd = props.command
      el = document.createElement('div')
      el.className = 'octo-slash-menu'
      document.body.appendChild(el)
      paint()
      position(props.clientRect?.())
    },
    onUpdate: (props: {
      items: SlashItem[]
      command: (item: SlashItem) => void
      clientRect?: (() => DOMRect | null) | null
    }) => {
      items = props.items
      cmd = props.command
      selected = 0
      paint()
      position(props.clientRect?.())
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (!items.length) return false
      const { key } = props.event
      if (key === 'ArrowDown') {
        selected = (selected + 1) % items.length
        paint()
        return true
      }
      if (key === 'ArrowUp') {
        selected = (selected - 1 + items.length) % items.length
        paint()
        return true
      }
      if (key === 'Enter') {
        cmd?.(items[selected])
        return true
      }
      if (key === 'Escape') {
        return true
      }
      return false
    },
    onExit: () => {
      el?.remove()
      el = null
    },
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: true,
        command: ({ editor, range, props }) => props.run(editor, range),
        items: ({ query }) => filterSlashItems(query),
        render: () => {
          const renderer = createSlashMenuRenderer()
          return {
            onStart: (props) =>
              renderer.onStart({
                items: props.items,
                command: (item) => props.command(item),
                clientRect: props.clientRect,
              }),
            onUpdate: (props) =>
              renderer.onUpdate({
                items: props.items,
                command: (item) => props.command(item),
                clientRect: props.clientRect,
              }),
            onKeyDown: (props) => renderer.onKeyDown(props),
            onExit: () => renderer.onExit(),
          }
        },
      }),
    ]
  },
})
