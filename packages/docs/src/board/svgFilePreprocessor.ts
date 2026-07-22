const PRESENTATION_PROPERTIES = new Set([
  'alignment-baseline', 'baseline-shift', 'clip-rule', 'color', 'color-interpolation',
  'color-rendering', 'dominant-baseline', 'fill', 'fill-opacity', 'fill-rule', 'flood-color',
  'flood-opacity', 'font-family', 'font-size', 'font-stretch', 'font-style', 'font-variant',
  'font-weight', 'letter-spacing', 'lighting-color', 'marker-end', 'marker-mid', 'marker-start',
  'opacity', 'paint-order', 'shape-rendering', 'stop-color', 'stop-opacity', 'stroke',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-opacity', 'stroke-width', 'text-anchor', 'text-decoration', 'text-rendering',
  'vector-effect', 'visibility', 'word-spacing',
])

/** Do not turn CSS capable of fetching/executing content into durable SVG attributes. */
function isSafePresentationValue(value: string): boolean {
  const normalized = value.trim()
  if (!normalized || /(?:javascript\s*:|expression\s*\(|@import)/i.test(normalized)) return false
  const urls = normalized.match(/url\s*\(([^)]*)\)/gi) ?? []
  return urls.every((entry) => {
    const target = entry.slice(entry.indexOf('(') + 1, -1).trim().replace(/^(['"])(.*)\1$/, '$2')
    return /^#[A-Za-z_][\w:.-]*$/.test(target)
  })
}

/**
 * Excalidraw normalizes SVG through DOMParser + `svg.outerHTML`. Materialize safe presentation
 * declarations as SVG attributes before that boundary, while retaining any declaration we do not
 * understand for the backend sanitizer to inspect. No rasterization or MIME substitution occurs.
 */
export function inlineSvgPresentationStyles(svg: string): string {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = parsed.documentElement
  if (parsed.querySelector('parsererror') || root.localName.toLowerCase() !== 'svg') return svg

  for (const element of Array.from(parsed.querySelectorAll('[style]'))) {
    const retained: string[] = []
    for (const rawDeclaration of (element.getAttribute('style') ?? '').split(';')) {
      const separator = rawDeclaration.indexOf(':')
      if (separator < 1) continue
      const property = rawDeclaration.slice(0, separator).trim().toLowerCase()
      const rawValue = rawDeclaration.slice(separator + 1).trim()
      const value = rawValue.replace(/\s*!important\s*$/i, '').trim()
      if (PRESENTATION_PROPERTIES.has(property) && isSafePresentationValue(value)) {
        element.setAttribute(property, value)
      } else {
        retained.push(`${property}: ${rawValue}`)
      }
    }
    if (retained.length > 0) element.setAttribute('style', retained.join('; '))
    else element.removeAttribute('style')
  }
  return new XMLSerializer().serializeToString(parsed)
}

function isSvgFile(file: File): boolean {
  return file.type.toLowerCase() === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')
}

/** Return an SVG File with Excalidraw-compatible presentation attributes. */
export async function preprocessSvgFile(file: File): Promise<File> {
  if (!isSvgFile(file)) return file
  const xml = inlineSvgPresentationStyles(await file.text())
  return new File([xml], file.name, { type: 'image/svg+xml', lastModified: file.lastModified })
}

/** Capture picker changes before Excalidraw and replay once after native SVG preprocessing. */
export function installSvgFileInputPreprocessor(root: Document = document): () => void {
  const replaying = new WeakSet<HTMLInputElement>()
  const onChange = (event: Event): void => {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || replaying.has(input)) return
    const files = Array.from(input.files ?? [])
    if (!files.some(isSvgFile) || typeof DataTransfer === 'undefined') return

    event.preventDefault()
    event.stopImmediatePropagation()
    void Promise.all(files.map(async (file) => {
      try { return await preprocessSvgFile(file) }
      catch (error) {
        console.warn('[board] failed to prepare SVG file; using original:', error)
        return file
      }
    })).then((processed) => {
      const transfer = new DataTransfer()
      for (const file of processed) transfer.items.add(file)
      input.files = transfer.files
    }).catch((error) => {
      console.warn('[board] failed to replace SVG file input; using original:', error)
    }).finally(() => {
      replaying.add(input)
      try { input.dispatchEvent(new Event('change', { bubbles: true })) }
      finally { replaying.delete(input) }
    })
  }
  root.addEventListener('change', onChange, true)
  return () => root.removeEventListener('change', onChange, true)
}
