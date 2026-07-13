import {
  MAX_CARD_VERSION,
  MAX_DEPTH,
  MAX_NODES,
  SUPPORTED_PROFILES,
} from "./types";

/**
 * profile / card_version 协商 + 深度/节点预算。
 *
 * 兜底原则（对齐服务端最终契约，无 per-element fallback）：
 *   - 不支持 profile / card_version → 整卡退 plain + 「需更新客户端」提示；
 *   - 已知 profile 内出现未知元素/动作、结构损坏、深/宽越界 → 整卡退 plain（无提示）。
 */

/** 协商结果：ok 可进入渲染；unsupported-* 需退 plain + 更新提示。 */
export type NegotiationResult =
  | { ok: true }
  | { ok: false; reason: "unsupported-profile" | "unsupported-version" };

export function isSupportedProfile(profile: string): boolean {
  return SUPPORTED_PROFILES.has(profile);
}

/**
 * 比较 "major.minor" 版本号。返回 <0 / 0 / >0。
 * 非法格式返回 NaN，调用方按不支持处理。
 */
export function compareCardVersion(a: string, b: string): number {
  const parse = (v: string): [number, number] | null => {
    const m = /^(\d+)\.(\d+)$/.exec(v.trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2])];
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return NaN;
  if (pa[0] !== pb[0]) return pa[0] - pb[0];
  return pa[1] - pb[1];
}

/** card_version 是否受支持：格式合法且 <= 客户端上限（MAX_CARD_VERSION）。 */
export function isSupportedCardVersion(cardVersion: string): boolean {
  const cmp = compareCardVersion(cardVersion, MAX_CARD_VERSION);
  return Number.isFinite(cmp) && cmp <= 0;
}

/** 协商 profile + card_version。profile 优先判定。 */
export function negotiate(
  profile: string,
  cardVersion: string
): NegotiationResult {
  if (!isSupportedProfile(profile)) {
    return { ok: false, reason: "unsupported-profile" };
  }
  if (!isSupportedCardVersion(cardVersion)) {
    return { ok: false, reason: "unsupported-version" };
  }
  return { ok: true };
}

/**
 * 节点/深度预算。渲染器递归时每访问一个节点 consume() 一次，进入子树前 enter()、
 * 退出时 leave()。任一越界即置 exceeded，渲染器据此整卡 fallback，防栈溢出/卡 UI。
 */
export class RenderBudget {
  private nodes = 0;
  private depth = 0;
  private _exceeded = false;

  constructor(
    private readonly maxNodes = MAX_NODES,
    private readonly maxDepth = MAX_DEPTH
  ) {}

  get exceeded(): boolean {
    return this._exceeded;
  }

  /** 计入一个节点。超过 maxNodes 置 exceeded 并返回 false。 */
  consume(): boolean {
    this.nodes += 1;
    if (this.nodes > this.maxNodes) {
      this._exceeded = true;
      return false;
    }
    return true;
  }

  /** 进入子树一层。超过 maxDepth 置 exceeded 并返回 false。 */
  enter(): boolean {
    this.depth += 1;
    if (this.depth > this.maxDepth) {
      this._exceeded = true;
      return false;
    }
    return true;
  }

  /** 退出子树一层。 */
  leave(): void {
    if (this.depth > 0) this.depth -= 1;
  }
}
