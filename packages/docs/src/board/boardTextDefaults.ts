import { bumpElementStamp } from './boardElementBump.ts'

export type PendingTextMark = 'bold' | 'italic' | 'underline'
export type PendingTextMarks = Partial<Record<PendingTextMark, true>>
export type BoardTextDefaultsKey = string | symbol

interface TextElementLike {
  id: string
  type: string
  isDeleted?: boolean
  customData?: Record<string, unknown> | null
  version: number
  versionNonce: number
}

interface DefaultsState {
  pendingMarks: PendingTextMarks
  knownTextIds: Set<string>
}

const defaultsByBoard = new Map<BoardTextDefaultsKey, DefaultsState>()

function stateFor(boardKey: BoardTextDefaultsKey): DefaultsState {
  let state = defaultsByBoard.get(boardKey)
  if (!state) {
    state = { pendingMarks: {}, knownTextIds: new Set() }
    defaultsByBoard.set(boardKey, state)
  }
  return state
}

export function readPendingTextMarks(boardKey: BoardTextDefaultsKey): PendingTextMarks {
  return { ...stateFor(boardKey).pendingMarks }
}

export function resetPendingTextDefaults(boardKey: BoardTextDefaultsKey): void {
  defaultsByBoard.delete(boardKey)
}

export function setPendingTextMark(
  boardKey: BoardTextDefaultsKey,
  key: PendingTextMark,
  enabled: boolean,
  currentElements: readonly Pick<TextElementLike, 'id' | 'type'>[],
): void {
  const state = stateFor(boardKey)
  state.pendingMarks = { ...state.pendingMarks }
  if (enabled) state.pendingMarks[key] = true
  else delete state.pendingMarks[key]
  // Capture the scene at the moment the tool default changes. Only text created afterwards should
  // inherit the pending marks; existing text must never be rewritten by a tool-default click.
  state.knownTextIds = new Set(
    currentElements.filter((el) => el.type === 'text').map((el) => el.id),
  )
}

/** Apply this board's tool-default marks to locally-created text first observed after the default. */
export function applyPendingTextMarksToNewElements<T extends TextElementLike>(
  boardKey: BoardTextDefaultsKey,
  elements: readonly T[],
  locallyActiveTextIds: ReadonlySet<string>,
): readonly T[] {
  const state = stateFor(boardKey)
  let changed = false
  const hasMarks = Object.keys(state.pendingMarks).length > 0
  const next = elements.map((el) => {
    // A remote collaborator's newly observed text must never inherit this client's defaults.
    if (
      el.type !== 'text' ||
      el.isDeleted ||
      state.knownTextIds.has(el.id) ||
      !locallyActiveTextIds.has(el.id)
    ) return el
    state.knownTextIds.add(el.id)
    if (!hasMarks) return el
    const customData = { ...(el.customData ?? {}), ...state.pendingMarks }
    changed = true
    return bumpElementStamp({ ...el, customData } as T & Record<string, unknown>) as T
  })
  return changed ? next : elements
}
