// Shared error boundary for the whiteboard's Excalidraw subtrees (mirrors DocsErrorBoundary).
//
// The live canvas (BoardShell) and the read-only version preview (BoardScenePreview, mounted in the
// version-history modal) are two independent real Excalidraw instances. A render-time throw in either
// — a malformed `initialData`, a bad restore, an Excalidraw mount failure — would otherwise propagate
// up and unmount the whole BoardShell. Wrapping each mount point in this boundary degrades a failure
// to a recoverable inline message instead of tearing down the host tree. It lives in its own module
// so both mount points share the SAME boundary rather than each carrying a private copy.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../octoweb/index.ts'

export class BoardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[board] canvas failed', error, info.componentStack)
  }
  render(): ReactNode {
    if (this.state.error) return <div className="octo-board-state octo-error">{t('docs.state.error')}</div>
    return this.props.children
  }
}
