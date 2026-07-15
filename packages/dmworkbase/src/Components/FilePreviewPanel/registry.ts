import {
  FileType,
  FileRenderer,
  RendererRegistryItem,
  getExtension,
} from "./types";
import FileViewerRenderer from "./renderers/FileViewerRenderer";

/** Routes every registered preview format through file-viewer. */
class FileRendererRegistry {
  private registry: Map<string, RendererRegistryItem> = new Map();
  private fallback: FileRenderer = FileViewerRenderer;

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    const formats: Record<FileType, string[]> = {
      image: ["gif", "jpg", "jpeg", "bmp", "tiff", "tif", "png", "svg", "webp", "avif", "ico", "heic", "heif", "jxl"],
      pdf: ["pdf", "ofd", "xps"],
      markdown: ["md", "markdown"],
      code: ["js", "mjs", "cjs", "css", "java", "py", "html", "htm", "jsx", "ts", "tsx", "xml", "log", "vue", "yaml", "yml", "ini", "sh", "bash", "sql", "go", "rs", "php", "c", "cpp", "cc", "h", "hpp", "cs", "diff", "patch", "jsonc", "json5", "toml", "proto", "hcl", "tex", "rb", "swift", "kt"],
      json: ["json"],
      jsonl: ["jsonl", "ndjson"],
      text: ["txt", "conf", "cfg", "srt", "vtt", "ass", "tsv"],
      archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
      excel: ["xlsx", "xltx", "xlsm", "xlsb", "xls", "xlt", "xltm", "csv", "ods", "fods", "numbers", "et"],
      docx: ["docx", "docm", "dotx", "dotm", "doc", "dot", "rtf", "odt", "wps"],
      ppt: ["pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "odp", "dps"],
      video: ["mp4", "webm", "m3u8", "m4v", "mov", "ogv"],
      audio: ["mp3", "mpeg", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "midi", "mid"],
      epub: ["epub", "umd"],
      unknown: [],
    };

    for (const [type, extensions] of Object.entries(formats) as [FileType, string[]][]) {
      if (!extensions.length) continue;
      this.register({
        type,
        extensions,
        renderer: FileViewerRenderer,
        needsFetch: false,
      });
    }
  }

  register(item: RendererRegistryItem) {
    for (const ext of item.extensions) this.registry.set(ext.toLowerCase(), item);
  }

  getRenderer(extension: string, fileName?: string): RendererRegistryItem {
    const ext = getExtension(extension, fileName);
    return this.registry.get(ext) ?? {
      type: "unknown" as FileType,
      extensions: [],
      renderer: this.fallback,
      needsFetch: false,
    };
  }

  setFallback(renderer: FileRenderer) {
    this.fallback = renderer;
  }

  canPreview(extension: string, fileName?: string): boolean {
    return this.registry.has(getExtension(extension, fileName));
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.registry.keys());
  }

  getExtensionsByType(type: FileType): string[] {
    return Array.from(this.registry.entries())
      .filter(([, item]) => item.type === type)
      .map(([ext]) => ext);
  }
}

export const fileRendererRegistry = new FileRendererRegistry();
export default fileRendererRegistry;
