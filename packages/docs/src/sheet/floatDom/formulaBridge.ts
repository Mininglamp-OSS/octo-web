// Bridge between the Univer layer (float-DOM formula components + the ribbon insert commands) and
// React (SheetView / CollabSheet). Univer instantiates components and runs commands outside React,
// so these module-level hooks are how they reach back in.
//
// Two channels:
//   • requestFormulaEditor — opens the raw-LaTeX modal (the "LaTeX 公式" ribbon item only).
//   • requestFormulaSave   — an INLINE edit of a formula on the sheet (latex + font size) is persisted
//                            back through the drawing model. The formula is edited in place like text;
//                            there is no modal for it.

export type FormulaEditorRequest = {
  mode: 'insert'
  /** 'builder' = structure palette + LaTeX box + preview; 'latex' = raw LaTeX box + preview only. */
  ui: 'builder' | 'latex'
}

let opener: ((req: FormulaEditorRequest) => void) | null = null
export function setFormulaEditorOpener(fn: ((req: FormulaEditorRequest) => void) | null): void {
  opener = fn
}
export function requestFormulaEditor(req: FormulaEditorRequest): void {
  opener?.(req)
}

/** Opens the formula picker (the π-button dropdown: preset previews + the two builders). */
let pickerOpener: (() => void) | null = null
export function setFormulaPickerOpener(fn: (() => void) | null): void {
  pickerOpener = fn
}
export function requestFormulaPicker(): void {
  pickerOpener?.()
}

/** Persist an inline formula edit (latex + font size) back to its drawing. Wired by CollabSheet. */
let saveHandler: ((id: string, latex: string, fontSize: number) => void) | null = null
export function setFormulaSaveHandler(fn: ((id: string, latex: string, fontSize: number) => void) | null): void {
  saveHandler = fn
}
export function requestFormulaSave(id: string, latex: string, fontSize: number): void {
  if (id) saveHandler?.(id, latex, fontSize)
}

/**
 * Clear Univer's drawing selection/focus. Called when a formula field gains focus so Univer no longer
 * has a "selected drawing" to move (arrow keys) or delete (Backspace/Delete) — those keys then act
 * inside the formula. Wired by CollabSheet to IDrawingManagerService.focusDrawing([]).
 */
let blurHandler: (() => void) | null = null
export function setDrawingBlurHandler(fn: (() => void) | null): void {
  blurHandler = fn
}
export function requestDrawingBlur(): void {
  blurHandler?.()
}
