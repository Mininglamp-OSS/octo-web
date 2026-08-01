import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CollabSheet.ts is the Univer ASSEMBLY layer: it resolves models out of a `redi` injector inside
 * one big try/catch and hands them to the binding. It has no unit tests, and behavioural ones would
 * need a mounted Univer — so two defects here were found only by review, both of them silent:
 *
 *   1. `this.worksheetProtectionModel = …` was relocated into the point-model `if` block by a
 *      scripted text edit that appended a brace without reading the rest of the block. Perfectly
 *      valid TypeScript, so `tsc` said nothing, and a Univer build lacking the point model left the
 *      field null — the worksheet half of refreshUniverProtectionPermissions() then returned early
 *      and live revocation silently stopped working.
 *   2. The refresh loop passed only the worksheet RULE permissionId. Univer's `refreshPermission`
 *      dispatches on which model owns the id, so the operation-matrix half never ran.
 *
 * Both are STRUCTURAL properties of a file with no behavioural harness, which is exactly what this
 * repo's `*.contract.test.ts` files (board/, editor/) exist for. Asserting on source text is a
 * weaker guard than a behavioural test and is not a substitute for one — but the alternative here
 * was a comment, and a comment does not go red.
 */
const src = readFileSync(resolve('src/sheet/CollabSheet.ts'), 'utf8')

/** Body of the `if (<varName> && …) { … }` block that guards a model resolve, brace-matched. */
function guardedBlock(varName: string): string {
  const start = src.indexOf(`if (${varName} && typeof ${varName}.getRule === 'function'`)
  expect(start, `no resolve guard found for '${varName}'`).toBeGreaterThan(-1)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced braces after the '${varName}' guard`)
}

describe('CollabSheet protection wiring contract', () => {
  it('retains the worksheet RULE model inside the block that resolved it', () => {
    // Must be in the `wp` block: reparented into `pm`'s, a Univer without the point model leaves it
    // null and the worksheet half of the refresh silently no-ops.
    expect(guardedBlock('wp')).toContain('this.worksheetProtectionModel = worksheetProtectionModel')
    expect(guardedBlock('pm')).not.toContain('this.worksheetProtectionModel =')
  })

  it('retains the POINT model inside the block that resolved it', () => {
    // The operation matrix has its own permissionId, invisible to the rule model, so the refresh
    // path needs this reference — a local-only `let` cannot be read after the constructor returns.
    expect(guardedBlock('pm')).toContain('this.worksheetPointModel = worksheetPointModel')
    expect(guardedBlock('wp')).not.toContain('this.worksheetPointModel =')
  })

  it('refreshes both permissionIds, because refreshPermission dispatches on the owning model', () => {
    const fn = src.slice(src.indexOf('private refreshUniverProtectionPermissions()'))
    const body = fn.slice(0, fn.indexOf('\n  }\n'))

    // Univer looks the id up in `_worksheetProtectionRuleModel` for the baseProtectionActions half
    // and in `_worksheetProtectionPointRuleModel` for the point-panel half. A worksheet rule's id is
    // never a point rule's id, so passing one covers one half only.
    //
    // Assert on the ITERATED SET, not on whether the field names appear somewhere in the body: both
    // names also occur in the early-return above, so a `toContain('this.worksheetPointModel')` here
    // stays green after the point model is dropped from the loop. (Verified by mutation — that
    // weaker form of this assertion did not go red.)
    const iterated = body.match(/for \(const model of \[([^\]]*)\]\)/)?.[1] ?? ''
    expect(iterated, 'refresh must iterate a model list').not.toBe('')
    expect(iterated).toContain('this.worksheetProtectionModel')
    expect(iterated).toContain('this.worksheetPointModel')
    expect(body).toMatch(/init\.refreshPermission\(unitId,\s*rule\.permissionId\)/)

    // And it must not bail out when only the point model resolved — a sheet carrying a point rule
    // and no worksheet rule still needs its matrix refreshed.
    expect(body).not.toMatch(/if\s*\([^)]*!this\.worksheetProtectionModel\s*\)\s*return/)
  })

  it('resolves the point model tolerantly, as its own comment promises', () => {
    // `injector.get()` THROWS (redi QuantityCheckError) on a missing provider — `?.` is no guard.
    // Unprotected, it shares the one broad try/catch and would skip SheetPermissionInitController,
    // the initial applyProtectionAdminGate() call, and the ribbon registration below it.
    const at = src.indexOf('injector?.get(WorksheetProtectionPointModel)')
    expect(at).toBeGreaterThan(-1)
    const before = src.slice(src.lastIndexOf('\n', src.lastIndexOf('\n', at - 1) - 1), at)
    expect(before).toContain('try {')
  })
})
