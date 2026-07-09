// Shared helpers for the whiteboard binding tests.
import * as Y from 'yjs'
import type { BinaryFileData, ExcalidrawBindingAPI, ExcalidrawElement } from '../types.ts'

let nonceSeq = 1000

/** Build an Excalidraw-ish element with sane CAS defaults; override any field. */
export function makeEl(id: string, overrides: Partial<ExcalidrawElement> = {}): ExcalidrawElement {
  return {
    id,
    type: 'rectangle',
    version: 1,
    versionNonce: nonceSeq++,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    isDeleted: false,
    ...overrides,
  } as ExcalidrawElement
}

/** Bump an element to a new version (simulates an Excalidraw edit). */
export function bump(el: ExcalidrawElement, overrides: Partial<ExcalidrawElement> = {}): ExcalidrawElement {
  return {
    ...el,
    version: (typeof el.version === 'number' ? el.version : 0) + 1,
    versionNonce: nonceSeq++,
    ...overrides,
  } as ExcalidrawElement
}

/** Records updateScene calls so tests can assert what reached the canvas. */
export class FakeExcalidrawApi implements ExcalidrawBindingAPI {
  scene: ExcalidrawElement[] = []
  updateSceneCalls = 0
  /** File binaries handed to the canvas via addFiles (image rehydrate path). */
  addedFiles: BinaryFileData[] = []
  addFilesCalls = 0
  /** Optional reentrancy hook: invoked inside updateScene to simulate Excalidraw's onChange. */
  onUpdate?: (elements: readonly ExcalidrawElement[]) => void

  updateScene(scene: { elements?: readonly ExcalidrawElement[]; captureUpdate?: unknown }): void {
    this.updateSceneCalls++
    this.scene = [...(scene.elements ?? [])]
    this.onUpdate?.(this.scene)
  }

  addFiles(files: readonly BinaryFileData[]): void {
    this.addFilesCalls++
    this.addedFiles.push(...files)
  }

  getSceneElementsIncludingDeleted(): readonly ExcalidrawElement[] {
    return this.scene
  }
}

/** Push the full state of `from` into `to` with a given origin (simulates a remote/peer write). */
export function syncDocs(from: Y.Doc, to: Y.Doc, origin: unknown): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from), origin)
}
