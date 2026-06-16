import { t } from "../i18n";
import WKApp from "../App";
import {
  buildRichTextPlain,
  RichTextBlockType,
  RichTextContent,
  RichTextFilePlaceholder,
  RichTextImagePlaceholder,
} from "../Messages/RichText/RichTextContent";
import {
  buildOctoRichTextClipboardPayload,
  encodeOctoRichTextClipboardPayload,
  OCTO_RICHTEXT_CLIPBOARD_ATTR,
} from "./richTextClipboard";
import { isSafeUrl } from "./security";

/**
 * 复制图片到剪贴板。
 *
 * 实现策略：
 * 1. 优先用 Clipboard API（navigator.clipboard.write）— 需 HTTPS / localhost
 * 2. 图片通过带 crossOrigin 的 <img> 加载后 canvas 转 PNG
 * 3. GIF 自动取静态帧（canvas drawImage 只取第一帧）
 * 4. crossOrigin 加载失败时，降级 fetch 重试（处理网络瞬时失败）
 * 5. 不支持时抛出带用户可读文案的 Error，调用方负责 Toast 展示
 */
export async function copyImageToClipboard(src: string): Promise<void> {
  if (!navigator.clipboard?.write) {
    throw new Error(t("base.clipboard.imageUnsupported"));
  }

  const pngBlob = await loadImageAndConvertToPng(src);
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": pngBlob }),
  ]);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function richTextBlockToHtml(
  block: RichTextContent["content"][number]
): string {
  if (block.type === RichTextBlockType.image) {
    if (!block.url) return escapeHtml(RichTextImagePlaceholder);
    const src = WKApp.dataSource.commonDataSource.getImageURL(block.url, {
      width: block.width || 0,
      height: block.height || 0,
    });
    if (!isSafeUrl(src)) {
      return escapeHtml(RichTextImagePlaceholder);
    }
    const alt = escapeHtml(block.name || RichTextImagePlaceholder);
    return `<img src="${escapeHtml(src)}" alt="${alt}" />`;
  }

  if (block.type === RichTextBlockType.file) {
    const label = block.name
      ? `${RichTextFilePlaceholder} ${block.name}`
      : RichTextFilePlaceholder;
    return escapeHtml(label);
  }

  return escapeHtml(block.text || "").replace(/\n/g, "<br>");
}

function buildRichTextHtml(content: RichTextContent): string {
  const blocks = content.content || [];
  const body = blocks.map(richTextBlockToHtml).join("");
  const payload = encodeOctoRichTextClipboardPayload(
    buildOctoRichTextClipboardPayload(content)
  );
  return `<div ${OCTO_RICHTEXT_CLIPBOARD_ATTR}="${payload}">${body}</div>`;
}

function copyHtmlToClipboard(html: string, plain: string): boolean {
  if (
    typeof document === "undefined" ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  let container: HTMLDivElement | null = null;
  const selection =
    typeof window !== "undefined" ? window.getSelection?.() : null;
  const previousRanges: Range[] = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) {
      previousRanges.push(selection.getRangeAt(i).cloneRange());
    }
  }

  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/plain", plain);
  };

  try {
    container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = "0";
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    container.contentEditable = "true";
    container.innerHTML = html;
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.addEventListener("copy", handleCopy);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", handleCopy);
    selection?.removeAllRanges();
    previousRanges.forEach((range) => selection?.addRange(range));
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

export async function copyRichTextToClipboard(
  content: RichTextContent
): Promise<boolean> {
  const plain = content.plain || buildRichTextPlain(content.content || []);
  const html = buildRichTextHtml(content);
  const canWriteRich =
    !!navigator.clipboard?.write && typeof ClipboardItem !== "undefined";

  if (canWriteRich) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      // fall through to plain-text fallback
    }
  }

  if (copyHtmlToClipboard(html, plain)) {
    return true;
  }

  return copyToClipboard(plain);
}

/** 将已加载的 HTMLImageElement 绘制到 canvas 并转为 PNG Blob。
 *  超过 16MP 时等比缩放，避免内存峰值。
 */
function drawImageToBlob(img: HTMLImageElement): Promise<Blob> {
  const MAX_PIXELS = 16 * 1024 * 1024;
  const naturalPixels = img.naturalWidth * img.naturalHeight;
  let drawWidth = img.naturalWidth;
  let drawHeight = img.naturalHeight;
  if (naturalPixels > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / naturalPixels);
    drawWidth = Math.floor(img.naturalWidth * scale);
    drawHeight = Math.floor(img.naturalHeight * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = drawWidth;
  canvas.height = drawHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return Promise.reject(new Error(t("base.clipboard.canvasUnavailable")));
  ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error(t("base.clipboard.imageConvertFailed"))),
      "image/png"
    );
  });
}

function loadImageAndConvertToPng(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // 避免 canvas 被污染（需服务端返回 CORS 头）
    img.onload = () => drawImageToBlob(img).then(resolve).catch(reject);
    img.onerror = () => {
      // crossOrigin 加载失败时降级 fetch 重试（处理网络瞬时失败）
      fallbackFetchAndConvert(src).then(resolve).catch(reject);
    };
    img.src = src;
  });
}

async function fallbackFetchAndConvert(src: string): Promise<Blob> {
  const resp = await fetch(src, { mode: "cors" });
  if (!resp.ok) throw new Error(t("base.clipboard.imageLoadFailed"));
  const blob = await resp.blob();
  // fallback 路径需将文件全量 fetch 到内存，额外限制 5MB 防止内存峰值
  // 主路径通过 <img> 加载无此限制（浏览器自行管理解码内存）
  if (blob.size > 5 * 1024 * 1024) {
    throw new Error(t("base.clipboard.imageTooLarge"));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      drawImageToBlob(img).then(resolve).catch(reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("base.clipboard.imageDecodeFailed")));
    };
    img.src = url;
  });
}

// 复制文本到剪贴板。优先使用 navigator.clipboard，不可用时降级到 textarea + execCommand("copy")，
// 适配 iOS Safari、非 HTTPS 等不支持 Clipboard API 的环境。返回是否复制成功。
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to fallback
    }
  }

  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    // iOS Safari 需要 readOnly + 非负 fontSize 才不会触发键盘和缩放
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    textarea.style.fontSize = "16px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    // iOS Safari：select() 不一定生效，再调一次 setSelectionRange 兜底
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    if (textarea && textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  }
}
