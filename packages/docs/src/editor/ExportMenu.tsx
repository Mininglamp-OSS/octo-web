import { useState, useRef, useCallback, useEffect, type ReactElement } from 'react'
import { t } from '../octoweb/index.ts'

interface ExportMenuProps {
  disabled: boolean
  onExportMarkdown: () => void
  onExportDocx: () => void
  onExportPdf: () => void
}

/**
 * Dropdown menu that groups export actions (Markdown, Word) under a single "导出" button.
 * Closes on outside-click or Escape.
 */
export function ExportMenu({ disabled, onExportMarkdown, onExportDocx, onExportPdf }: ExportMenuProps): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const toggle = useCallback(() => {
    if (!disabled) setOpen((v) => !v)
  }, [disabled])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div className="octo-export-menu" ref={ref}>
      <button
        type="button"
        className={open ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
        disabled={disabled}
        onClick={toggle}
        title={t('docs.toolbar.export')}
      >
        ⬇ {t('docs.toolbar.export')}
      </button>
      {open && (
        <div className="octo-export-dropdown">
          <button
            type="button"
            className="octo-export-item"
            onClick={() => { setOpen(false); onExportMarkdown() }}
          >
            {t('docs.toolbar.exportMarkdown')}
          </button>
          <button
            type="button"
            className="octo-export-item"
            onClick={() => { setOpen(false); onExportDocx() }}
          >
            {t('docs.toolbar.exportDocx')}
          </button>
          <button
            type="button"
            className="octo-export-item"
            onClick={() => { setOpen(false); onExportPdf() }}
          >
            {t('docs.toolbar.exportPdf')}
          </button>
        </div>
      )}
    </div>
  )
}
