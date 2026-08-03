import { DesktopLocalFileService, type IOpenFileOptions } from '@univerjs/ui'

const RASTER_IMAGE_ACCEPT_RE = /(?:^|,)\s*\.(?:png|jpe?g|gif|bmp)(?:,|$)/i

/**
 * Univer's sheet drawing picker derives its accept list from a package-local
 * allow-list. pnpm may install that package more than once, so mutating the
 * app's imported copy does not reliably reach the picker. Intercept the actual
 * file-open service instead and add the real SVG extension to image pickers.
 */
export class SheetLocalFileService extends DesktopLocalFileService {
  override openFile(options?: IOpenFileOptions): Promise<File[]> {
    return super.openFile(withSvgImageAccept(options))
  }
}

export function withSvgImageAccept(options?: IOpenFileOptions): IOpenFileOptions | undefined {
  const accept = options?.accept
  if (!accept || !RASTER_IMAGE_ACCEPT_RE.test(accept)) return options

  const values = accept.split(',').map((value) => value.trim()).filter(Boolean)
  if (!values.some((value) => value.toLowerCase() === '.svg')) values.push('.svg')
  return { ...options, accept: values.join(',') }
}
