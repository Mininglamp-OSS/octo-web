/** Browser-side image rasterization shared by OOXML exporters. */

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('SVG image could not be decoded'))
    image.src = source
  })
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Canvas did not produce a PNG')),
      'image/png',
    )
  })
}

async function hasPngSignature(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.slice(0, PNG_SIGNATURE.length).arrayBuffer())
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/**
 * Decode SVG in the browser and return genuine PNG bytes.
 * Optional dimensions are used by spreadsheet drawings; DOCX omits them so the
 * SVG's intrinsic dimensions/aspect ratio become the raster dimensions.
 */
export async function rasterizeSvgToPng(
  source: string | Blob,
  width?: number,
  height?: number,
): Promise<Blob> {
  const dataUrl = typeof source === 'string' ? source : await readAsDataUrl(source)
  const image = await loadImage(dataUrl)
  const intrinsicWidth = image.naturalWidth || image.width
  const intrinsicHeight = image.naturalHeight || image.height
  const targetWidth = Math.max(1, Math.ceil(width || intrinsicWidth || 96))
  const targetHeight = Math.max(1, Math.ceil(height || intrinsicHeight || 96))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  context.drawImage(image, 0, 0, targetWidth, targetHeight)
  const png = await canvasToPng(canvas)
  if (!(await hasPngSignature(png))) throw new Error('Canvas output is not a PNG')
  return png
}

/** Convert a Blob to a data URL for exporters that store base64 media. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return readAsDataUrl(blob)
}
