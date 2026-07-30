export type BoardCommentAnchor =
  | {
      version: 1
      kind: 'element'
      elementId: string
      /** All selected/group member ids; elementId remains the stable primary id. */
      elementIds?: string[]
      x: number
      y: number
    }
  | { version: 1; kind: 'point'; x: number; y: number }

const MAX_COORDINATE = 1_000_000
const MAX_ELEMENT_ID_LENGTH = 256
const MAX_ELEMENT_IDS = 100

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE
}

function validElementId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ELEMENT_ID_LENGTH &&
    !/[\s\u0000-\u001f\u007f-\u009f]/.test(value)
}

export function encodeBoardCommentAnchor(anchor: BoardCommentAnchor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(anchor))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeBoardCommentAnchor(encoded?: string | null): BoardCommentAnchor | null {
  if (!encoded) return null
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>
    if (value.version !== 1 || !finiteCoordinate(value.x) || !finiteCoordinate(value.y)) return null
    const keys = Object.keys(value).sort().join(',')
    if (value.kind === 'point' && keys === 'kind,version,x,y') {
      return { version: 1, kind: 'point', x: value.x, y: value.y }
    }
    if (value.kind === 'element' && validElementId(value.elementId)) {
      let elementIds: string[] | undefined
      if (value.elementIds !== undefined) {
        if (!Array.isArray(value.elementIds) || value.elementIds.length === 0 || value.elementIds.length > MAX_ELEMENT_IDS) return null
        if (value.elementIds.some((id) => !validElementId(id))) return null
        elementIds = [...new Set(value.elementIds)]
        if (elementIds.length !== value.elementIds.length || !elementIds.includes(value.elementId)) return null
      }
      const expectedKeys = elementIds
        ? 'elementId,elementIds,kind,version,x,y'
        : 'elementId,kind,version,x,y'
      if (keys !== expectedKeys) return null
      return { version: 1, kind: 'element', elementId: value.elementId, ...(elementIds ? { elementIds } : {}), x: value.x, y: value.y }
    }
  } catch {
    // A document/sheet/legacy anchor is not a board anchor.
  }
  return null
}


const LOCALIZED_ELEMENT_TYPES = new Set([
  'text', 'frame', 'rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'freedraw', 'image', 'embeddable',
])

/** Keep unknown/vendor-added element kinds from leaking raw English or unresolved i18n keys. */
export function boardElementTypeLabelKey(elementType?: string): string {
  const normalized = elementType?.toLowerCase() ?? ''
  return `docs.board.comment.elementTypes.${LOCALIZED_ELEMENT_TYPES.has(normalized) ? normalized : 'element'}`
}

export function boardAnchorLabel(anchor: BoardCommentAnchor, elementType?: string): string {
  if (anchor.kind === 'element') return elementType || 'element'
  return `${Math.round(anchor.x)}, ${Math.round(anchor.y)}`
}
