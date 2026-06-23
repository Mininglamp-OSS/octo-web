// Bookmark (link-preview) node (SCHEMA-SPEC §15 / SCHEMA_VERSION 15; frontend-design §3.5).
//
// A self-built BLOCK ATOM node rendered as a rich link-preview card (title + description +
// thumbnail + site name); clicking the card opens the URL. BYTE-ALIGNED to the backend
// `bookmark` node — the attr set is EXACTLY { url, title, description, image, siteName,
// fetchedAt } (the PM-frozen contract), each riding on a `data-*` attribute so it round-trips
// through the Y.Doc and re-parses in the read-only preview:
//
//   url         ↔ data-url          (sanitized http/https at parse AND render — §3.7)
//   title       ↔ data-title
//   description ↔ data-description
//   image       ↔ data-image        (sanitized http/https — external og:image allowed)
//   siteName    ↔ data-site-name
//   fetchedAt   ↔ data-fetched-at
//
// Each attribute is emitted ONLY when non-null. `url`/`image` pass through sanitizeBookmarkUrl
// at BOTH boundaries so a javascript:/data: URL can never enter the Y.Doc or serialize back out.

import { Node, mergeAttributes } from '@tiptap/core'
import { BookmarkNodeView } from './BookmarkNodeView.ts'
import { sanitizeBookmarkUrl } from './sanitize.ts'

export interface BookmarkAttrs {
  url: string | null
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  fetchedAt: string | null
}

export interface BookmarkOptions {
  /** Doc id used for the link-card REST path (threaded via buildExtensions). */
  docId: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      /** Insert a bookmark card from already-fetched link-card metadata. */
      setBookmark: (attrs: Partial<BookmarkAttrs>) => ReturnType
    }
  }
}

export const Bookmark = Node.create<BookmarkOptions>({
  name: 'bookmark',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { docId: '' }
  },

  addAttributes() {
    return {
      url: {
        // The whitelist MUST run at parse AND render (sanitize.ts: a miss in either is
        // bypassable). An unsafe url reduces to null → the node renders no data-url and the
        // card becomes inert rather than carrying a javascript:/data: link.
        default: null,
        parseHTML: (el) => sanitizeBookmarkUrl(el.getAttribute('data-url')),
        renderHTML: (attrs) => {
          const safe = sanitizeBookmarkUrl(attrs.url as string | null)
          return safe == null ? {} : { 'data-url': safe }
        },
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-title'),
        renderHTML: (attrs) => (attrs.title == null ? {} : { 'data-title': attrs.title }),
      },
      description: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-description'),
        renderHTML: (attrs) =>
          attrs.description == null ? {} : { 'data-description': attrs.description },
      },
      image: {
        default: null,
        parseHTML: (el) => sanitizeBookmarkUrl(el.getAttribute('data-image')),
        renderHTML: (attrs) => {
          const safe = sanitizeBookmarkUrl(attrs.image as string | null)
          return safe == null ? {} : { 'data-image': safe }
        },
      },
      siteName: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-site-name'),
        renderHTML: (attrs) =>
          attrs.siteName == null ? {} : { 'data-site-name': attrs.siteName },
      },
      fetchedAt: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-fetched-at'),
        renderHTML: (attrs) =>
          attrs.fetchedAt == null ? {} : { 'data-fetched-at': attrs.fetchedAt },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-bookmark]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-bookmark': '', class: 'octo-bookmark' }),
    ]
  },

  addNodeView() {
    const editor = this.editor
    return ({ node, getPos }) => new BookmarkNodeView(node, editor, getPos)
  },

  addCommands() {
    return {
      setBookmark:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
