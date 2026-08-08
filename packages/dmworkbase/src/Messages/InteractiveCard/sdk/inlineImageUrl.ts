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
 * 1. **URL 字面量**：长度上限 + 字符白名单。`Image.url` 由 SDK 赋给 `img.src`（DOM API，
 *    无注入面），但容器 `backgroundImage` 会被拼进 CSS `background-image: url('…')`——
 *    引号/括号/反斜杠/空白可逃逸该上下文并注入额外 CSS 声明。一份规则覆盖
 *    `Image.url` / `Action.iconUrl` / `backgroundImage` 三个面，按最严口径设防。
 *
 *    **生产者契约**：SVG 必须**完整** percent-encode 或改用 base64。注意
 *    `encodeURIComponent` 默认保留 `!'()*`，所以带 `transform="translate(2 2)"`、
 *    `fill="url(#g)"`、`clip-path` 的图标只做 `encodeURIComponent` 会被拒——须额外
 *    编码这几个字符，或直接 `;base64`。被拒时 DEV 下有 `console.warn`（见
 *    sanitizeCardTree），不再像修复前那样静默丢图标。
 *
 * 2. **MIME 与参数**：只放 `image/svg+xml`（对齐服务端），参数段仅允许
 *    `charset=utf-8` / `charset=us-ascii` 与末位唯一的 `base64`。位图 data URL、
 *    `text/html`、空 MIME、MIME 后缀污染（`image/svg+xmlx`）一律拒。
 *
 * 3. **SVG 源**：decode 后必须以 SVG 为**文档根**（不只是文中某处出现 `<svg>`），
 *    且不含脚本 / 事件属性 / SMIL 属性合成 / 外部引用 / DTD 实体 / 字节视图与
 *    解析器视图不一致的编码（UTF-16 等含 NUL 的文档）。
 *
 *    **这一层是 best-effort 的字节级启发式，不是完备的 SVG 净化器。** 正则看到的是
 *    字节，XML 解析器看到的是文档，两者之间永远存在分歧空间（命名空间前缀、字符集、
 *    实体、属性合成……本层已知被绕过过数次）。真正阻断脚本执行与外部请求的是浏览器：
 *    `<img>` 与 CSS 背景中的 SVG 一律以 secure static mode 渲染。所以**不要把本层当作
 *    可依赖的隔离手段**——若哪天有客户端把卡片 SVG 内联进 DOM，必须先换成解析式净化
 *    （DOMParser + 命名空间/属性遍历）再上线，而不是继续往这里加正则。
 *
 * 纯函数、无副作用；判定失败不抛异常（调用方据布尔值剥键）。
 */

/** data URL 字面量长度上限（字节；下面的字符白名单保证 1 字符 = 1 字节）。 */
export const MAX_INLINE_IMAGE_DATA_URL_LENGTH = 4096;

/** 唯一放行的 MIME（服务端白名单同口径）。 */
const DATA_SVG_PREFIX = "data:image/svg+xml";

/** data URL 非编码参数段白名单（小写比较）；`base64` 另按位置规则处理。 */
const ALLOWED_DATA_PARAMS: ReadonlySet<string> = new Set([
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

/**
 * 文档根必须是 SVG。前缀组这里**故意**只收 ASCII（`[\w.-]+`）：根判定是 allow 方向，
 * 放宽等于放行更多，非 ASCII 前缀的根一律 fail-closed。
 */
const SVG_ROOT = /^<(?:[\w.-]+:)?svg[\s/>]/i;

/**
 * 禁用模式（decode 之后匹配，覆盖 percent / base64 编码绕过）。
 *
 * 元素名前缀组用 `[^\s<>/=]+` 而非 `[\w.-]+`：JS 的 `\w` 只含 ASCII，而 XML 的
 * NameStartChar 含非 ASCII，`<ñ:script>` 是合法且等价于 `<script>` 的写法。deny 方向
 * 放宽只会多拦，安全。
 */
const SVG_DENY_PATTERNS: readonly RegExp[] = [
  /<\s*(?:[^\s<>/=]+:)?script/i, // 脚本
  /<\s*(?:[^\s<>/=]+:)?foreignobject/i, // 嵌 HTML
  /<\s*(?:[^\s<>/=]+:)?iframe/i,
  /<\s*(?:[^\s<>/=]+:)?object/i,
  /<\s*(?:[^\s<>/=]+:)?embed/i,
  /<\s*(?:[^\s<>/=]+:)?link/i,
  /<\s*(?:[^\s<>/=]+:)?use\b/i, // 外部/片段引用
  /<\s*(?:[^\s<>/=]+:)?image\b/i, // 外部位图引用
  /<!\s*doctype/i, // DTD → XXE / 实体膨胀
  /<!\s*entity/i,
  /\s(?:[^\s<>/=]+:)?on[a-z-]+\s*=/i, // 事件处理属性（onload/onerror/…）
  // SMIL 属性合成：`<set attributeName="onload" to="…">` / `<animate attributeName="href">`
  // 从不写出字面 `on…=`，绕过上面那条。只拦危险目标属性，`attributeName="opacity"`
  // 之类的正常动画图标照放。
  /attributename\s*=\s*["']?\s*(?:on|href|xlink:href)/i,
  /javascript\s*:/i,
  /\bhref\s*=/i, // 图标不需要任何链接/外部引用（含 xlink:href）
  /@import/i, // `<style>@import "//evil"` 外部样式表
  // CSS 里的外部资源引用。`url(#local)`（渐变/clip-path 同文档引用）必须放过，
  // 所以只拦带 scheme 的形式。
  /url\s*\(\s*["']?\s*(?:https?|data|blob|file|filesystem):/i,
  /&#/, // XML 字符实体：属性值内可编码绕过上面的关键词匹配
];

/** 解析 data URL 参数段；非法参数 → null，否则返回是否 base64。 */
function parseDataParams(params: string): { isBase64: boolean } | null {
  if (params === "") return { isBase64: false };
  if (!params.startsWith(";")) return null; // MIME 后缀污染，如 image/svg+xmlx
  const segments = params.slice(1).split(";");
  let isBase64 = false;
  for (let i = 0; i < segments.length; i++) {
    const normalized = segments[i].toLowerCase();
    if (normalized === "base64") {
      // RFC 2397：`base64` 只有作为逗号前最后一段时才是编码标记，浏览器也如此实现。
      // 出现在中间时浏览器会 percent-decode 而我们会 atob——两侧看到的字节不同。
      // 要求唯一且末位，让「我们扫的就是浏览器要解析的」成为结构性保证而非巧合。
      if (i !== segments.length - 1) return null;
      isBase64 = true;
      continue;
    }
    if (!ALLOWED_DATA_PARAMS.has(normalized)) return null;
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

/**
 * 剥掉根元素之前允许出现的前导内容（空白、`<?xml …?>` 声明、`<!-- -->` 注释）。
 * 用循环而非嵌套量词正则：后者对未闭合注释会退化成多项式回溯。
 */
function stripSvgPrologue(source: string): string {
  let rest = source.trimStart();
  for (;;) {
    if (rest.startsWith("<?")) {
      const end = rest.indexOf("?>");
      if (end < 0) return rest; // 未闭合 → 留给根判定拒掉
      rest = rest.slice(end + 2).trimStart();
      continue;
    }
    if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->");
      if (end < 0) return rest;
      rest = rest.slice(end + 3).trimStart();
      continue;
    }
    return rest;
  }
}

/** decode 后的 SVG 源是否安全。 */
function isSafeSvgSource(source: string): boolean {
  // NUL 字节 ⇒ 这是 UTF-16/UTF-32 之类的宽字符文档：正则扫到的字节串与 XML 解析器
  // 看到的文档结构不同（可在注释里放 ASCII 诱饵骗过根判定，真正的 script 则被 NUL
  // 间隔而匹配不到）。合法的 UTF-8 SVG 不含 NUL，直接拒掉整类视图分歧。
  if (source.includes("\x00")) return false;
  if (!SVG_ROOT.test(stripSvgPrologue(source))) return false;
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
