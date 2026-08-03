import {
  clearBoardScene,
  loadBoardScene,
  persistBoardScene,
  type BoardScene,
} from './boardStore.ts'
import { normalizeElement, WB_ELEMENT_TYPES } from './collab/schema.ts'
import type { ExcalidrawElement } from './collab/types.ts'

const MAX_ELEMENTS = 50_000
const MAX_FILES = 2_000
const MAX_STRING = 1_000_000
const MAX_ELEMENT_VERSION = 1_000_000_000
const MAX_TIMESTAMP = 8_640_000_000_000_000 // ECMAScript Date maximum, in epoch milliseconds.
const APP_STATE_TYPES: Record<string, 'string' | 'number' | 'boolean' | 'object'> = {
  viewBackgroundColor: 'string',
  gridSize: 'number',
  gridModeEnabled: 'boolean',
  zoom: 'object',
  scrollX: 'number',
  scrollY: 'number',
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9
}

function boundedString(value: unknown, max = MAX_STRING): value is string {
  return typeof value === 'string' && value.length <= max
}

function importableElement(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false
  if (!boundedString(value.id, 256) || value.id.length === 0) return false
  if (typeof value.type !== 'string') return false
  // External formats evolve faster than the shared collaboration schema. Unsupported element types
  // are skipped rather than making every otherwise-valid element in a long-lived file unusable.
  if (!WB_ELEMENT_TYPES.has(value.type)) return false
  for (const key of ['x', 'y', 'width', 'height', 'angle'] as const) {
    if (!finite(value[key])) return false
  }
  if (value.isDeleted !== undefined && typeof value.isDeleted !== 'boolean') return false
  if (value.version !== undefined &&
    (!Number.isInteger(value.version) || (value.version as number) < 1 || (value.version as number) > MAX_ELEMENT_VERSION)) return false
  if (value.versionNonce !== undefined &&
    (!Number.isInteger(value.versionNonce) || Math.abs(value.versionNonce as number) > Number.MAX_SAFE_INTEGER)) return false
  if (value.points !== undefined) {
    if (!Array.isArray(value.points) || value.points.length > 100_000) return false
    if (!value.points.every((point) => Array.isArray(point) && point.length === 2 && finite(point[0]) && finite(point[1]))) return false
  }
  return true
}

function normalizeAppState(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  if (!record(value) || Object.keys(value).length > 200) throw new BoardImportSchemaError('invalid board appState')
  const normalized = { ...value }
  for (const [key, expected] of Object.entries(APP_STATE_TYPES)) {
    const field = normalized[key]
    // Legacy Excalidraw exports use null for optional appState fields such as gridSize/zoom.
    // The vendor restore path treats these as absent and supplies its defaults; mirror that here.
    if (field === undefined || field === null) {
      delete normalized[key]
      continue
    }
    if (expected === 'number' && !finite(field)) throw new BoardImportSchemaError(`invalid board appState.${key}`)
    if (expected === 'string' && !boundedString(field, 256)) throw new BoardImportSchemaError(`invalid board appState.${key}`)
    if (expected === 'boolean' && typeof field !== 'boolean') throw new BoardImportSchemaError(`invalid board appState.${key}`)
    if (expected === 'object' && (!record(field) || !finite(field.value))) {
      throw new BoardImportSchemaError(`invalid board appState.${key}`)
    }
  }
  return normalized
}

function validFiles(value: unknown): value is Record<string, unknown> | undefined {
  if (value === undefined) return true
  if (!record(value)) return false
  const entries = Object.entries(value)
  if (entries.length > MAX_FILES) return false
  return entries.every(([key, file]) => {
    if (!key || key.length > 256 || !record(file)) return false
    if (file.id !== undefined && file.id !== key) return false
    if (!boundedString(file.mimeType, 128) || !boundedString(file.dataURL)) return false
    if (!file.dataURL.startsWith('data:')) return false
    if (file.created !== undefined && (!Number.isInteger(file.created) || Math.abs(file.created as number) > MAX_TIMESTAMP)) return false
    if (file.lastRetrieved !== undefined && (!Number.isInteger(file.lastRetrieved) || Math.abs(file.lastRetrieved as number) > MAX_TIMESTAMP)) return false
    return true
  })
}

export class BoardImportSchemaError extends Error {}
export class BoardImportStorageError extends Error {}

export interface StagedBoardImport {
  tempDocId: string
  scene: BoardScene
}

/** Validate and physically stage an import before a server document can be created. */
export function preflightBoardImport(raw: unknown, uid?: string): StagedBoardImport {
  if (!record(raw) || raw.type !== 'excalidraw') throw new BoardImportSchemaError('invalid board type')
  if (!Array.isArray(raw.elements) || raw.elements.length > MAX_ELEMENTS) {
    throw new BoardImportSchemaError('invalid board elements')
  }
  if (!validFiles(raw.files)) throw new BoardImportSchemaError('invalid board files')
  const appState = normalizeAppState(raw.appState)
  const candidates: Record<string, unknown>[] = []
  for (const element of raw.elements) {
    if (!record(element) || !boundedString(element.id, 256) || element.id.length === 0 ||
      typeof element.type !== 'string') {
      throw new BoardImportSchemaError('invalid board element')
    }
    if (!WB_ELEMENT_TYPES.has(element.type)) continue
    if (!importableElement(element)) throw new BoardImportSchemaError('invalid board element')
    candidates.push(element)
  }

  // Apply the same canonical schema used by collaboration before anything is persisted. Two
  // passes make dangling bindings deterministic, and supplying fileIds rejects image elements
  // whose binary is absent instead of letting the importer and peers render different scenes.
  const fileIds = new Set(Object.keys((raw.files as Record<string, unknown> | undefined) ?? {}))
  const first = candidates
    .map((element) => normalizeElement(element, { fileIds }))
    .filter((element): element is NonNullable<typeof element> => element !== null)
  const elementIds = new Set(first.map((element) => element.id))
  const normalized = first
    .map((element) => normalizeElement(element, { fileIds, elementIds }))
    .filter((element): element is NonNullable<typeof element> => element !== null)

  const scene: BoardScene = {
    elements: normalized as unknown as ExcalidrawElement[],
    appState,
    files: raw.files,
  }
  // JSON serialization is deliberately exercised before touching the server (cycles, BigInt, etc.).
  JSON.stringify(scene)
  const tempDocId = `__import_${Date.now()}_${Math.random().toString(36).slice(2)}`
  if (!persistBoardScene(tempDocId, scene, uid)) throw new BoardImportStorageError('board scene storage failed')
  const staged = loadBoardScene(tempDocId, uid)
  if (!staged) {
    clearBoardScene(tempDocId, uid)
    throw new BoardImportStorageError('board scene staging failed')
  }
  return { tempDocId, scene: staged }
}

/** Copy the verified staged bytes to the real id; caller rolls back the server doc on failure. */
export function commitBoardImport(stage: StagedBoardImport, docId: string, uid?: string): boolean {
  try {
    return persistBoardScene(docId, stage.scene, uid)
  } finally {
    clearBoardScene(stage.tempDocId, uid)
  }
}

export function discardBoardImport(stage: StagedBoardImport, uid?: string): void {
  clearBoardScene(stage.tempDocId, uid)
}

/** Transaction boundary used by the UI: no create callback before preflight succeeds. */
export async function importBoardScene<T extends { docId: string }>(
  raw: unknown,
  create: () => Promise<T>,
  rollback: (docId: string) => Promise<unknown>,
  uid?: string,
): Promise<T> {
  const stage = preflightBoardImport(raw, uid)
  let created: T | null = null
  try {
    created = await create()
    if (!commitBoardImport(stage, created.docId, uid)) {
      await rollback(created.docId).catch(() => undefined)
      throw new BoardImportStorageError('board scene storage failed')
    }
    return created
  } finally {
    discardBoardImport(stage, uid)
  }
}
