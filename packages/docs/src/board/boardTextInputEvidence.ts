export interface BoardTextInputEvidence {
  phase: 'beforeinput' | 'input'
  inputType: string
  data: string | null
  selectionStart: number | null
  selectionEnd: number | null
  isComposing: boolean
  valueLength: number
  trailingCodePoints: number[]
}

function isBoardTextEditor(target: EventTarget | null): target is HTMLTextAreaElement {
  return target instanceof HTMLTextAreaElement && target.classList.contains('excalidraw-wysiwyg')
}

export function readBoardTextInputEvidence(event: InputEvent): BoardTextInputEvidence | null {
  if (!isBoardTextEditor(event.target)) return null
  const value = event.target.value
  return {
    phase: event.type === 'beforeinput' ? 'beforeinput' : 'input',
    inputType: event.inputType,
    data: event.data,
    selectionStart: event.target.selectionStart,
    selectionEnd: event.target.selectionEnd,
    isComposing: event.isComposing,
    valueLength: value.length,
    trailingCodePoints: Array.from(value.slice(-8), (character) => character.codePointAt(0) ?? 0),
  }
}

/** Development-only evidence for the reported trailing-space issue. This is deliberately read-only:
 * it records the browser input boundary without trimming, moving the caret, or disrupting IME. */
export function installBoardTextInputEvidence(
  root: HTMLElement,
  report: (evidence: BoardTextInputEvidence) => void = (evidence) => console.debug('[board:text-input]', evidence),
): () => void {
  const inspect = (event: Event) => {
    const evidence = readBoardTextInputEvidence(event as InputEvent)
    if (evidence) report(evidence)
  }
  root.addEventListener('beforeinput', inspect, true)
  root.addEventListener('input', inspect, true)
  return () => {
    root.removeEventListener('beforeinput', inspect, true)
    root.removeEventListener('input', inspect, true)
  }
}
