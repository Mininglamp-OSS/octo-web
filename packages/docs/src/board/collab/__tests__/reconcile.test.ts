// CAS arbitration (T7) — version / versionNonce / tombstone rules (XIN-16 §1.1).
import { describe, it, expect } from 'vitest'
import { shouldOverwrite, reconcileElement } from '../reconcile.ts'
import { makeEl } from './helpers.ts'

describe('CAS arbitration (T7)', () => {
  it('writes when there is no current value', () => {
    expect(shouldOverwrite(null, { version: 1, versionNonce: 1 })).toBe(true)
    expect(shouldOverwrite(undefined, { version: 1, versionNonce: 1 })).toBe(true)
  })

  it('higher version wins', () => {
    expect(shouldOverwrite({ version: 1, versionNonce: 5 }, { version: 2, versionNonce: 9 })).toBe(true)
    expect(shouldOverwrite({ version: 3, versionNonce: 5 }, { version: 2, versionNonce: 1 })).toBe(false)
  })

  it('on a version tie, the lower versionNonce wins (deterministic)', () => {
    expect(shouldOverwrite({ version: 2, versionNonce: 9 }, { version: 2, versionNonce: 4 })).toBe(true)
    expect(shouldOverwrite({ version: 2, versionNonce: 4 }, { version: 2, versionNonce: 9 })).toBe(false)
  })

  it('an identical stamp is a no-op (no write → no empty transaction)', () => {
    expect(shouldOverwrite({ version: 2, versionNonce: 7 }, { version: 2, versionNonce: 7 })).toBe(false)
  })

  it('reconcileElement returns the winner, honouring tombstones by version', () => {
    const live = makeEl('a', { version: 3, isDeleted: false })
    const tomb = makeEl('a', { version: 4, isDeleted: true })
    expect(reconcileElement(live, tomb).isDeleted).toBe(true)
    // an older delete loses to a newer live edit
    const oldTomb = makeEl('a', { version: 2, isDeleted: true })
    expect(reconcileElement(live, oldTomb)).toBe(live)
  })
})
