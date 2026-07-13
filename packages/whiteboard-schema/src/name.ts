/**
 * @octo/whiteboard-schema — whiteboard documentName build/parse (XIN-16 §3).
 *
 * Whiteboard key: `octo:{space}:{folder}:wb:{board}` (5 segments, parts[3]==='wb').
 * This is the front-end/back-end shared constructor + parser so both sides build
 * and recognise the key identically. The back-end's unified router parser
 * (`src/permission/documentName.ts`) uses the SAME 5-segment `:wb:` discriminator
 * to route document vs whiteboard connections; this helper is the canonical
 * whiteboard-only form the binding and Agent path use.
 */

const SEG = /^[A-Za-z0-9_-]+$/

export interface ParsedWhiteboardName {
  space: string
  folder: string
  board: string
}

export class WhiteboardNameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhiteboardNameError'
  }
}

/** Build `octo:{space}:{folder}:wb:{board}`; validates each segment. */
export function buildWhiteboardName(space: string, folder: string, board: string): string {
  for (const [label, seg] of [
    ['space', space],
    ['folder', folder],
    ['board', board],
  ] as const) {
    if (!SEG.test(seg)) throw new WhiteboardNameError(`invalid ${label} segment: ${seg}`)
  }
  return `octo:${space}:${folder}:wb:${board}`
}

/**
 * Parse a whiteboard key. Throws WhiteboardNameError unless the input is exactly
 * `octo:{space}:{folder}:wb:{board}` with valid segments.
 */
export function parseWhiteboardName(name: string): ParsedWhiteboardName {
  const parts = name.split(':')
  if (parts.length !== 5 || parts[0] !== 'octo' || parts[3] !== 'wb') {
    throw new WhiteboardNameError('not a whiteboard key')
  }
  const [, space, folder, , board] = parts
  if (![space, folder, board].every((s) => s !== undefined && SEG.test(s))) {
    throw new WhiteboardNameError('bad seg')
  }
  return { space: space!, folder: folder!, board: board! }
}
