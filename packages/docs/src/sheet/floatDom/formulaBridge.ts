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

/**
 * Resize a formula's drawing box to fit its rendered content (auto-fit). Called by MathFormula after
 * the field renders / whenever the content size changes. Wired by CollabSheet to patch the drawing's
 * transform width/height.
 */
let resizeHandler: ((id: string, w: number, h: number) => void) | null = null
export function setFormulaResizeHandler(fn: ((id: string, w: number, h: number) => void) | null): void {
  resizeHandler = fn
}
export function requestFormulaResize(id: string, w: number, h: number): void {
  if (id) resizeHandler?.(id, w, h)
}

/** Merge a style patch (bold/italic/color/…) into a formula's drawing `data`. Wired by CollabSheet. */
let styleHandler: ((id: string, patch: Record<string, unknown>) => void) | null = null
export function setFormulaStyleHandler(fn: ((id: string, patch: Record<string, unknown>) => void) | null): void {
  styleHandler = fn
}
export function requestFormulaStyle(id: string, patch: Record<string, unknown>): void {
  if (id) styleHandler?.(id, patch)
}

/** Delete a formula drawing from the sheet. Wired by CollabSheet. */
let deleteHandler: ((id: string) => void) | null = null
export function setFormulaDeleteHandler(fn: ((id: string) => void) | null): void {
  deleteHandler = fn
}
export function requestFormulaDelete(id: string): void {
  if (id) deleteHandler?.(id)
}
