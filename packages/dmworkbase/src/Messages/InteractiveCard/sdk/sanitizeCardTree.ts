import { isHttpsUrl } from "../../../Utils/security";
import { isSafeInlineImageDataUrl } from "./inlineImageUrl";

/**
 * 喂官方 SDK 前的卡树消毒（落地计划「坑 B」+ fallback/requires 收敛）。
 *
 * (1) 图片面 **https 或内联 SVG data URL**——`Image.url`、容器 `backgroundImage`
 * （字符串或 `{url}` 对象形）、动作 `iconUrl`。官方 SDK 对这些字段一律原样写进 `img.src` /
 * CSS `background-image`，自身不做 scheme 检查；自研渲染器曾用 `isHttpsUrl` 守卫（占位），
 * 迁移后须在此补回。放行两类：https（避免 http 混合内容被浏览器拦成破图）与
 * `data:image/svg+xml`（模板内联图标，白名单+源码校验见 `inlineImageUrl.ts`，与服务端同口径）。
 * 其余值一律**剥除**（对齐契约的 per-element 处理，不整卡降级）。
 *
 * (2) 剥除 **`fallback` 与 `requires`**——SDK 会在 `requires` 能力门不满足时渲染元素的
 * `fallback` 子树；octo 的 HostConfig 未声明任何 host capability，故任意 `requires` 都不满足，
 * SDK 会渲出 `validateCardForOcto` **从未校验过**的 fallback 子树，绕过整卡降级 / 节点预算 /
 * D1 唯一 id / 交互门（契约禁止 per-element fallback）。剥掉这两个键即恢复「主元素照渲、
 * 无 fallback」的旧渲染器行为——主元素已由 validateCardForOcto 白名单校验，安全照渲。
 *
 * **不动 `Action.OpenUrl.url`**：那是导航面，契约允许 http/https，且已由 validateCardForOcto
 * + 点击期 openUrl 双重 isSafeUrl 守卫。
 *
 * **图片面清单是穷举的，不是通配的**：本函数按键名识别 `url`(Image) / `iconUrl` / `backgroundImage`
 * 三个键。SDK 还有别的取图键（如 `Media.poster` → `posterImageElement.src`），今天不可达
 * ——`Media` 不在 validateElement 的白名单里，整卡会先降级——但谁若放宽元素白名单，
 * **必须在同一个 commit 里把对应的取图键补进下面的分支**，否则新元素的图片面就是裸的。
 *
 * 纯函数、不可变克隆：绝不改动传入的（可能被缓存/共享的）解码卡树。
 * 唯一的例外是 DEV 下的 `console.warn`（见 warnRejectedImageUrl），生产构建会被剔除。
 */

/** 图片面放行判定：https 或受限内联 SVG data URL。 */
function isRenderableImageUrl(url: string): boolean {
  return isHttpsUrl(url) || isSafeInlineImageDataUrl(url);
}

/**
 * DEV 下报告被剥除的图片 URL。
 *
 * 剥键本身是静默的，而这正是本模块修复的那个 bug 难查的原因：整卡不降级、文字照渲、
 * 只有图标凭空消失。图片面的白名单比服务端严（见 inlineImageUrl 的生产者契约），
 * 所以模板一旦产出不合规的编码，需要一眼能看出是被这里拒的。
 *
 * 生产构建里 `import.meta.env.DEV` 为常量 false，整个调用被 tree-shake 掉。
 */
function warnRejectedImageUrl(surface: string, value: unknown): void {
  if (!import.meta.env.DEV) return;
  const shown = typeof value === "string" ? value.slice(0, 160) : value;
  console.warn(
    `[octo-card] ${surface} rejected by the image URL allowlist ` +
      `(needs https or a fully-encoded data:image/svg+xml):`,
    shown
  );
}

/** 仅保留可渲染的图片 URL，否则返回 undefined（调用方据此剥除该键）。 */
function keepImageUrl(value: unknown, surface: string): string | undefined {
  if (typeof value === "string" && isRenderableImageUrl(value)) return value;
  warnRejectedImageUrl(surface, value);
  return undefined;
}

/** backgroundImage 可为字符串或 `{url, ...}` 对象；不可渲染一律剥除。 */
function sanitizeBackgroundImage(value: unknown): unknown | undefined {
  if (typeof value === "string") {
    if (isRenderableImageUrl(value)) return value;
    warnRejectedImageUrl("backgroundImage", value);
    return undefined;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string" && isRenderableImageUrl(obj.url)) {
      return { ...obj };
    }
    warnRejectedImageUrl("backgroundImage.url", obj.url);
    return undefined;
  }
  return undefined; // 非法/不可渲染 → 不渲背景图
}

function isActionType(type: unknown): boolean {
  return typeof type === "string" && type.startsWith("Action.");
}

function sanitizeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeNode);
  if (node === null || typeof node !== "object") return node;

  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // fallback / requires：SDK 会据此渲染未经 validate 的子树 → 一律剥除（无 per-element fallback）。
    if (key === "fallback" || key === "requires") {
      continue;
    }
    // `__proto__`：`out[key] = …` 会命中原型 setter，把被剥掉的键从原型链上「复活」
    // ——消毒后的节点会暴露输入里并不存在的 url。SDK 当前用 hasOwnProperty 取属性所以
    // 读不到，但不能依赖第三方实现细节。改用 Object.create(null) 反而更糟：SDK 的
    // internalParse 调 `source.hasOwnProperty(...)`，无原型对象上该方法不存在会抛。
    // 与 fallback/requires 一样直接跳过，零风险。
    if (key === "__proto__") {
      continue;
    }
    // Image.url：图片面白名单（不误伤 Action.OpenUrl.url 等其它 url）。
    if (key === "url" && obj.type === "Image") {
      const safe = keepImageUrl(value, "Image.url");
      if (safe !== undefined) out[key] = safe;
      continue;
    }
    // 动作 iconUrl：图片面白名单。
    if (key === "iconUrl" && isActionType(obj.type)) {
      const safe = keepImageUrl(value, `${obj.type}.iconUrl`);
      if (safe !== undefined) out[key] = safe;
      continue;
    }
    // 容器 backgroundImage：字符串或 {url}，同白名单。
    if (key === "backgroundImage") {
      const safe = sanitizeBackgroundImage(value);
      if (safe !== undefined) out[key] = safe;
      continue;
    }
    // 其余字段递归（进入 body/items/columns/actions/selectAction 等，触达嵌套 Image/Action）。
    out[key] = sanitizeNode(value);
  }
  return out;
}

/**
 * 返回图片类 URL 已消毒的新卡树（不可变）。在 validateCardForOcto 通过后、喂 SDK parse 前调用。
 */
export function sanitizeCardTree(
  card: Record<string, unknown>
): Record<string, unknown> {
  return sanitizeNode(card) as Record<string, unknown>;
}

export default sanitizeCardTree;
