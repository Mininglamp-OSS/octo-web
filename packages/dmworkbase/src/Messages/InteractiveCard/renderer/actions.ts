import { isHttpsUrl, isSafeUrl } from "../../../Utils/security";

/**
 * octo/v1 动作处理（波 1 仅 Action.OpenUrl）。
 *
 * 契约：未知动作类型（Input.* / Action.Submit / Action.Execute / 其他）在已知 profile 内
 * 出现时，整卡 fallback plain（抛 CardRenderError），**绝不发起任何 card/action 请求**。
 */

/** 整卡 fallback 信号。渲染链任意处抛出，由 Cell 顶层 try-catch 捕获退 plain。 */
export class CardRenderError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CardRenderError";
  }
}

export interface OpenUrlAction {
  title: string;
  url: string;
  iconUrl?: string;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * 解析 Action.OpenUrl。合法返回结构，非 OpenUrl 类型抛整卡 fallback。
 * url 必须通过 isSafeUrl（http/https），否则视为损坏动作 → 整卡 fallback。
 */
export function parseOpenUrl(action: unknown): OpenUrlAction {
  const obj = asObject(action);
  if (!obj || obj.type !== "Action.OpenUrl") {
    // 未知/不支持动作（Input.*/Submit/Execute/其他）→ 整卡 fallback。
    throw new CardRenderError(
      `unsupported action: ${obj?.type ?? typeof action}`
    );
  }
  const url = obj.url;
  if (typeof url !== "string" || !isSafeUrl(url)) {
    throw new CardRenderError("Action.OpenUrl has unsafe/missing url");
  }
  const title = typeof obj.title === "string" ? obj.title : "";
  // iconUrl 是图片面，走 https-only（与 Image/backgroundImage 混合内容策略一致）；
  // http/非法 icon 不渲染，避免 HTTPS 页混合内容被拦或静默损坏。链接 url 仍允许 http/https。
  const iconUrl =
    typeof obj.iconUrl === "string" && isHttpsUrl(obj.iconUrl)
      ? obj.iconUrl
      : undefined;
  return { title, url, iconUrl };
}

/**
 * 解析 selectAction（元素/卡片可点区域）。
 *   - 不存在 → null（元素不可点）；
 *   - 存在且为合法 Action.OpenUrl → 返回目标；
 *   - 存在但非 OpenUrl（或 url 非法）→ 整卡 fallback（parseOpenUrl 抛出）。
 */
export function parseSelectAction(sel: unknown): OpenUrlAction | null {
  if (sel === undefined || sel === null) return null;
  return parseOpenUrl(sel);
}

/** 在新标签打开 URL。不用 <a> 包裹可点区域，避免与内部链接产生嵌套锚点。 */
export function openUrl(url: string): void {
  if (!isSafeUrl(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
