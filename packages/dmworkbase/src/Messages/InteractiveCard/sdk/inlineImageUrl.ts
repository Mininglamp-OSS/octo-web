/**
 * 内联图片 `data:` URL 白名单（octo 卡片图片面）。
 *
 * 背景：卡片模板把折叠/展开等图标以 `data:image/svg+xml,…` 内联进 `Image.url`，
 * 避免为几百字节的图标额外发起 CDN 请求、也避免图标域名成为新的外部依赖。
 * 图片面原本一律 https-only（见 sanitizeCardTree），data URL 会被整键剥除、
 * 图标静默消失，故此处按 **服务端白名单（仅 image/svg+xml）** 开一个受限口子。
 *
 * 安全模型（三层，任一不过即拒）：
 *
 * 1. **URL 字面量**：长度上限 + 禁危险字符。`Image.url` 由 SDK 赋给 `img.src`（DOM API，
 *    无注入面），但容器 `backgroundImage` 会被拼进 CSS `background-image: url('…')`——
 *    引号/括号/反斜杠/空白可逃逸该上下文并注入额外 CSS 声明。合法的 percent-encoded /
 *    base64 data URL 天然不含这些字符，故统一按最严口径设防，一份规则覆盖
 *    `Image.url` / `Action.iconUrl` / `backgroundImage` 三个面。
 *
 * 2. **MIME 与参数**：只放 `image/svg+xml`（对齐服务端），参数段仅允许
 *    `base64` / `charset=utf-8` / `charset=us-ascii`。位图 data URL、`text/html`、
 *    空 MIME、MIME 后缀污染（`image/svg+xmlx`）一律拒。
 *
 * 3. **SVG 源**：decode 后必须确实是 SVG，且不含脚本 / 事件属性 / 外部引用
 *    （`use`、`image`、任何 `href`）/ `foreignObject` / DTD 实体 / XML 字符实体。
 *    元素名一律容许命名空间前缀（`<svg:script>` 在 XML 解析下等价于 `<script>`）。
 *    浏览器在 `<img>` 与 CSS 背景中加载 SVG 时本就处于 secure static mode
 *    （不执行脚本、不取外部资源），这一层是纵深防御：既防 SDK 后续改用
 *    innerHTML 类路径，也防同一 helper 被复用到无沙箱的上下文。
 *
 * 纯函数、无副作用；判定失败不抛异常（调用方据布尔值剥键）。
 */

/** data URL 字面量长度上限（字节；下面的字符白名单保证 1 字符 = 1 字节）。 */
export const MAX_INLINE_IMAGE_DATA_URL_LENGTH = 4096;

/** 唯一放行的 MIME（服务端白名单同口径）。 */
const DATA_SVG_PREFIX = "data:image/svg+xml";

/** data URL 参数段白名单（小写比较）。 */
const ALLOWED_DATA_PARAMS: ReadonlySet<string> = new Set([
  "base64",
  "charset=utf-8",
  "charset=us-ascii",
]);

/**
 * data URL 只允许 ASCII 可打印**非空格**字符：排除空白与控制字符（浏览器会从 URL 里
 * 剥除 \t\n\r，可用于拆散关键词），也排除非 ASCII（否则字符数 < UTF-8 字节数，长度上限失真）。
 */
const ALLOWED_URL_CHARS = /^[\x21-\x7e]+$/;

/** 能逃逸 CSS `url('…')` / HTML 属性上下文的字符（ASCII 可打印集合内的危险子集）。 */
const UNSAFE_URL_CHARS = /['"()\\]/;

/** 严格 base64 字面量（禁空、禁 URL-safe 变体、padding 最多 2）。 */
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** SVG 根元素存在性（`<svg>` / `<svg ` / `<svg/>`，允许命名空间前缀）。 */
const SVG_ROOT = /<\s*(?:[\w.-]+:)?svg[\s/>]/i;

/**
 * SVG 源禁用模式（decode 之后匹配，覆盖 percent / base64 编码绕过）。
 *
 * 元素名一律容许命名空间前缀：SVG 经 `<img>` 加载走 XML 解析，`<svg:script>` /
 * `<x:script xmlns:x="…/svg">` 与 `<script>` 等价，只匹配无前缀形会被绕过。
 */
const SVG_DENY_PATTERNS: readonly RegExp[] = [
  /<\s*(?:[\w.-]+:)?script/i, // 脚本
  /<\s*(?:[\w.-]+:)?foreignobject/i, // 嵌 HTML
  /<\s*(?:[\w.-]+:)?iframe/i,
  /<\s*(?:[\w.-]+:)?use\b/i, // 外部/片段引用
  /<\s*(?:[\w.-]+:)?image\b/i, // 外部位图引用
  /<!\s*doctype/i, // DTD → XXE / 实体膨胀
  /<!\s*entity/i,
  /\s(?:[\w.-]+:)?on[a-z-]+\s*=/i, // 事件处理属性（onload/onerror/…）
  /javascript\s*:/i,
  /\bhref\s*=/i, // 图标不需要任何链接/外部引用（含 xlink:href）
  /&#/, // XML 字符实体：属性值内可编码绕过上面的关键词匹配
];

/** 解析 data URL 参数段；非法参数 → null，否则返回是否 base64。 */
function parseDataParams(params: string): { isBase64: boolean } | null {
  if (params === "") return { isBase64: false };
  if (!params.startsWith(";")) return null; // MIME 后缀污染，如 image/svg+xmlx
  let isBase64 = false;
  for (const segment of params.slice(1).split(";")) {
    const normalized = segment.toLowerCase();
    if (!ALLOWED_DATA_PARAMS.has(normalized)) return null;
    if (normalized === "base64") isBase64 = true;
  }
  return { isBase64 };
}

/** 解码 data URL payload；编码损坏 → null。 */
function decodeDataPayload(payload: string, isBase64: boolean): string | null {
  try {
    if (isBase64) {
      if (!STRICT_BASE64.test(payload)) return null;
      // atob 产出 latin1 字节串——足够匹配下面全 ASCII 的禁用模式。
      return atob(payload);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/** decode 后的 SVG 源是否安全。 */
function isSafeSvgSource(source: string): boolean {
  if (!SVG_ROOT.test(source)) return false;
  return !SVG_DENY_PATTERNS.some((pattern) => pattern.test(source));
}

/**
 * 该字符串是否为可安全内联渲染的图片 data URL（当前仅 `image/svg+xml`）。
 * 非 data: scheme 一律返回 false（https 判定见 `isHttpsUrl`）。
 */
export function isSafeInlineImageDataUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_INLINE_IMAGE_DATA_URL_LENGTH) {
    return false;
  }
  if (!ALLOWED_URL_CHARS.test(url) || UNSAFE_URL_CHARS.test(url)) return false;
  if (url.slice(0, DATA_SVG_PREFIX.length).toLowerCase() !== DATA_SVG_PREFIX) {
    return false;
  }

  const rest = url.slice(DATA_SVG_PREFIX.length);
  const separator = rest.indexOf(",");
  if (separator < 0) return false; // 无 payload 分隔符

  const params = parseDataParams(rest.slice(0, separator));
  if (!params) return false;

  const payload = rest.slice(separator + 1);
  if (payload === "") return false;

  const svg = decodeDataPayload(payload, params.isBase64);
  if (svg === null) return false;

  return isSafeSvgSource(svg);
}

export default isSafeInlineImageDataUrl;
