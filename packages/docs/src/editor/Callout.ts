// Callout block node (SCHEMA-SPEC §12, SCHEMA_VERSION 12).
//
// No official Tiptap extension exists, so this is a self-built node modelled on blockquote:
// a `block+` container with a `variant` attr (info/warn/tip/success). The variant rides on a
// `data-variant` attribute so it round-trips through the Y.Doc and re-parses faithfully in the
// read-only preview. The leading icon + background colour are purely presentational (CSS
// ::before keyed on data-variant in styles.css), so the node's content hole stays a clean
// editable block sequence.

import { Node, mergeAttributes } from '@tiptap/core'

export type CalloutVariant = 'info' | 'warn' | 'tip' | 'success'
export const CALLOUT_VARIANTS: CalloutVariant[] = ['info', 'warn', 'tip', 'success']

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the current block(s) in a callout of the given variant. */
      setCallout: (attrs?: { variant?: CalloutVariant }) => ReturnType
      /** Toggle a callout wrapper on/off around the current block(s). */
      toggleCallout: (attrs?: { variant?: CalloutVariant }) => ReturnType
      /** Lift the current block out of its callout wrapper. */
      unsetCallout: () => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-variant') || 'info',
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant || 'info' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const variant = (HTMLAttributes['data-variant'] as string) || 'info'
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        class: `octo-callout octo-callout-${variant}`,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attrs),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    }
  },
})
