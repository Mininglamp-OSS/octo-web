// documentName addressing contract (frontend-design §7.2 / §9.1, backend §8.1).
//
//   document key (4 segments):   octo:{space}:{folder}:{doc}
//   whiteboard key (5 segments): octo:{space}:{folder}:wb:{board}
//   HTML key (5 segments):       octo:{space}:{folder}:html:{doc}
//   PPT key (5 segments):        octo:{space}:{folder}:ppt:{doc}
//
// v2.1: segment 3 is the docs-native {folder} (organization/routing dimension).
// It is NOT an octo group_no and the frontend NEVER derives permissions from it.
//
// Single source of truth for build + parse. Inline `octo:${...}` concatenation is
// forbidden elsewhere in the codebase — always go through buildDocumentName so segment
// validation/escaping happens in exactly one place (prevents injection of a forged
// documentName via a `:` inside a segment).

export type ParsedDocumentName =
  | { kind: 'document'; space: string; folder: string; doc: string }
  | { kind: 'whiteboard'; space: string; folder: string; board: string }
  | { kind: 'html'; space: string; folder: string; doc: string }
  | { kind: 'ppt'; space: string; folder: string; doc: string }

// Each segment is a restricted charset: no ':' separators, no empty segments.
const SEGMENT = /^[A-Za-z0-9_-]+$/

function assertSegment(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`documentName ${label} segment must be a non-empty string`)
  }
  if (!SEGMENT.test(value)) {
    throw new Error(
      `documentName ${label} segment "${value}" contains illegal characters (allowed: A-Z a-z 0-9 _ -)`,
    )
  }
}

/**
 * Build the canonical 4-segment document key `octo:{space}:{folder}:{doc}`.
 * Segment 3 is the docs-native folder (see module header).
 */
export function buildDocumentName(space: string, folder: string, doc: string): string {
  assertSegment(space, 'space')
  assertSegment(folder, 'folder')
  assertSegment(doc, 'doc')
  // The doc segment must not collide with the whiteboard literal — otherwise a
  // 4-segment doc key could be ambiguous with the `:wb:` prefix on parse.
  if (doc === 'wb') {
    throw new Error('documentName doc segment must not be the literal "wb"')
  }
  return `octo:${space}:${folder}:${doc}`
}

/**
 * Parse a canonical documentName. Typed 5-segment keys use `wb`, `html`, or
 * `ppt`; the shared collaborative document namespace uses exactly 4 segments.
 */
export function parseDocumentName(name: string): ParsedDocumentName {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('documentName must be a non-empty string')
  }
  const parts = name.split(':')
  if (parts[0] !== 'octo') {
    throw new Error('documentName must start with the "octo" namespace')
  }

  // Typed five-segment keys are positional. `html` and `ppt` are standalone, non-Yjs surfaces;
  // they must not be collapsed into the ordinary collaborative-document kind.
  if (parts.length === 5 && ['wb', 'html', 'ppt'].includes(parts[3])) {
    const [, space, folder, type, resourceId] = parts
    assertSegment(space, 'space')
    assertSegment(folder, 'folder')
    assertSegment(resourceId, type === 'wb' ? 'board' : 'doc')
    if (type === 'wb') return { kind: 'whiteboard', space, folder, board: resourceId }
    return { kind: type as 'html' | 'ppt', space, folder, doc: resourceId }
  }

  // Document key must be exactly 4 segments.
  if (parts.length === 4) {
    const [, space, folder, doc] = parts
    assertSegment(space, 'space')
    assertSegment(folder, 'folder')
    assertSegment(doc, 'doc')
    if (doc === 'wb') {
      throw new Error('documentName doc segment must not be the literal "wb"')
    }
    return { kind: 'document', space, folder, doc }
  }

  throw new Error(`documentName has an invalid segment count: ${parts.length}`)
}
