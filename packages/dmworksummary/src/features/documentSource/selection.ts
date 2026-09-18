/**
 * Empty confirmation only clears an existing selection of this source type.
 * Opening an unused picker and confirming nothing must not erase other scope.
 * Shared by the legacy create page and Workbench without coupling their state.
 */
export function shouldApplySourceSelection(
  current: readonly unknown[],
  next: readonly unknown[]
): boolean {
  return current.length > 0 || next.length > 0;
}
