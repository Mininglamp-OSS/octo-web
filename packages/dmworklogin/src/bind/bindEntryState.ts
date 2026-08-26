let bindInitialSearch = ''
let bindEntryActive = false

export function isBindEntry(): boolean {
  return bindEntryActive
}

export function getBindInitialSearch(): string {
  return bindInitialSearch
}

export function markBindEntry(search: string): void {
  bindEntryActive = true
  bindInitialSearch = search
}

/** Clear the one-shot marker after leaving the bind flow. */
export function clearBindEntry(): void {
  bindEntryActive = false
  bindInitialSearch = ''
}
