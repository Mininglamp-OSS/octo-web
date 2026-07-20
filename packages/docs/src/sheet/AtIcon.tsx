// Ribbon icon for the sheet cell @-mention button. Registered with Univer's ComponentManager and
// referenced by the menu item's `icon` key. A plain `@` glyph (a BUTTON, not a dropdown, so no
// chevron — unlike the neighbouring π formula entry).
export const OCTO_MENTION_AT_ICON_KEY = 'octo-mention-at-icon'

export function AtIcon(): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}>
      <span style={{ fontSize: 16, fontFamily: 'system-ui, sans-serif' }}>@</span>
    </span>
  )
}
