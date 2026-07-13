import { isHttpsUrl } from "../../../Utils/security";

/**
 * 喂官方 SDK 前的卡树消毒（落地计划「坑 B」+ fallback/requires 收敛）。
 *
 * (1) 图片面 **https-only（混合内容防护）**——`Image.url`、容器 `backgroundImage`
 * （字符串或 `{url}` 对象形）、动作 `iconUrl`。官方 SDK 对这些字段一律原样写进 `img.src` /
 * CSS `background-image`，自身不做 scheme 检查；自研渲染器曾用 `isHttpsUrl` 守卫（占位），
 * 迁移后须在此补回。非 https 值一律**剥除**（对齐契约的 per-element 处理，不整卡降级）。
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
 * 纯函数、不可变克隆：绝不改动传入的（可能被缓存/共享的）解码卡树。
 */

/** 仅保留 https 图片 URL，否则返回 undefined（调用方据此剥除该键）。 */
function keepHttpsUrl(value: unknown): string | undefined {
  return typeof value === "string" && isHttpsUrl(value) ? value : undefined;
}

/** backgroundImage 可为字符串或 `{url, ...}` 对象；非 https 一律剥除。 */
function sanitizeBackgroundImage(value: unknown): unknown | undefined {
  if (typeof value === "string") {
    return isHttpsUrl(value) ? value : undefined;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string" && isHttpsUrl(obj.url)) {
      return { ...obj };
    }
  }
  return undefined; // 非法/非 https → 不渲背景图
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
    // Image.url：图片面 https-only（不误伤 Action.OpenUrl.url 等其它 url）。
    if (key === "url" && obj.type === "Image") {
      const safe = keepHttpsUrl(value);
      if (safe !== undefined) out[key] = safe;
      continue;
    }
    // 动作 iconUrl：图片面 https-only。
    if (key === "iconUrl" && isActionType(obj.type)) {
      const safe = keepHttpsUrl(value);
      if (safe !== undefined) out[key] = safe;
      continue;
    }
    // 容器 backgroundImage：字符串或 {url}，https-only。
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
