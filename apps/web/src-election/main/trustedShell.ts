export function createTrustedShellDocumentTracker(
  isTrustedDocument: (url: string) => boolean,
) {
  let trusted = false

  return {
    update(url: string, isMainFrame: boolean): void {
      if (!isMainFrame) return
      trusted = isTrustedDocument(url)
    },
    isTrusted(): boolean {
      return trusted
    },
  }
}
