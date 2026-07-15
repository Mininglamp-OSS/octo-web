// The ribbon icon for the merged formula entry — a π glyph plus a small dropdown chevron (the ribbon
// runs icon-only, so the chevron must live IN the icon to be visible). Registered with Univer's
// ComponentManager and referenced by the menu item's `icon` key.
export const OCTO_FORMULA_PI_ICON_KEY = 'octo-formula-pi-icon'

/** DOM id on the icon root so the picker can measure the button and align its left edge to π. */
export const OCTO_FORMULA_PI_ANCHOR_ID = 'octo-formula-pi-anchor'

export function PiIcon(): JSX.Element {
  return (
    <span id={OCTO_FORMULA_PI_ANCHOR_ID} style={{ display: 'inline-flex', alignItems: 'center', gap: 0, lineHeight: 1 }}>
      <span
        style={{
          fontSize: 16,
          fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        π
      </span>
      {/* Exact same chevron Univer uses for ribbon dropdowns (@univerjs/icons MoreDownIcon), so the
          π entry's caret matches the neighbouring image/link buttons pixel-for-pixel. */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M11.3536 6.14645C11.5488 6.34171 11.5488 6.65829 11.3536 6.85355L8.35355 9.85355C8.15829 10.0488 7.84171 10.0488 7.64645 9.85355L4.64645 6.85355C4.45118 6.65829 4.45118 6.34171 4.64645 6.14645C4.84171 5.95118 5.15829 5.95118 5.35355 6.14645L8 8.79289L10.6464 6.14645C10.8417 5.95118 11.1583 5.95118 11.3536 6.14645Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}
