// documentName addressing contract (frontend-design §7.2 / §9.1, backend §8.1).
//
//   document key (4 segments):  octo:{space}:{folder}:{doc}
//   whiteboard key (5 segments): octo:{space}:{folder}:wb:{board}   (NOT built this round)
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
 * Parse a documentName using the non-symmetric rule: a 5-segment key whose 4th
 * segment is the literal `wb` is a whiteboard key; otherwise it must be exactly a
 * 4-segment document key. The whiteboard branch is parsed correctly but no
 * whiteboard UI is built this round (deferred).
 */
export function parseDocumentName(name: string): ParsedDocumentName {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('documentName must be a non-empty string')
  }
  const parts = name.split(':')
  if (parts[0] !== 'octo') {
    throw new Error('documentName must start with the "octo" namespace')
  }

  // Whiteboard key (positional, length===5 && parts[3]==='wb') — checked first.
  if (parts.length === 5 && parts[3] === 'wb') {
    const [, space, folder, , board] = parts
    assertSegment(space, 'space')
    assertSegment(folder, 'folder')
    assertSegment(board, 'board')
    return { kind: 'whiteboard', space, folder, board }
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
