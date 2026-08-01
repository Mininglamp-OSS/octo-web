import { isAgentProgressCard } from "./cardLayout";

/**
 * 客户端兜底：进度卡「未终态」判定 + 触发时机。
 *
 * 背景：agent 框架（openclaw / cc / hermes / codex）发出 type=17 进度卡后，正常应在收尾时把
 * 卡片切到终态（✅ 已完成 / ⚠️ 已中断）。发方漏发终态帧时卡片会永久停在「🤖 正在处理…」，
 * 而同一 assistant 往往已发出 type=1 的 final text（战报/结论）。本模块提供纯判定，供
 * ConversationVM 在收到 final text 后决定是否把该 assistant 最近一张未终态卡降级显示。
 *
 * 判定只依赖 octo card 协议里 progress 卡 header 的首字标记（见 openclaw card-render.ts
 * `headerText`）：非终态以 🤖 / ⏳ 起始；终态以 ✅ / ⚠️ / ❌ / ⏹ / ⏱ 起始；⏸ 表示「等待任务
 * 结果」（sessions_yield，故意保持非终态），兜底不介入。未识别的 header 一律保守视为「不触发」。
 */

/** 从卡最后一次 patch 到收到 final text 的最小空闲间隔（秒）。低于此值视为快速动作序列，不触发。 */
export const CARD_FALLBACK_MIN_IDLE_SEC = 3;

/** header 首字为这些标记之一 → 卡片正在进行中（可被兜底降级）。 */
const ACTIVE_HEADER_MARKERS = ["🤖", "⏳"] as const;

/**
 * header 首字为这些标记之一 → 卡片已是终态或故意等待，兜底不介入。
 * ⏸ = 等待子任务结果（sessions_yield），不是「卡住」；⏱ = 等待超时（发方已给结论）。
 */
const TERMINAL_HEADER_MARKERS = ["✅", "⚠️", "❌", "⏹", "⏱", "⏸"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 从单个展示元素取文本：TextBlock 取 text；RichTextBlock 拼接 inlines[].text。 */
function elementText(node: unknown): string {
  const el = asRecord(node);
  if (!el) return "";
  if (el.type === "TextBlock") {
    return typeof el.text === "string" ? el.text : "";
  }
  if (el.type === "RichTextBlock" && Array.isArray(el.inlines)) {
    return el.inlines
      .map((inline) => {
        const run = asRecord(inline);
        return run && typeof run.text === "string" ? run.text : "";
      })
      .join("");
  }
  return "";
}

/**
 * 取进度卡 header 文案。specialized layout 契约：`body[0]` 为 ColumnSet，其 `columns[0].items`
 * 首个展示元素即 header（RichTextBlock 或 TextBlock）。结构异常时返回 null（保守，不触发）。
 */
export function getProgressCardHeaderText(
  card: Record<string, unknown>
): string | null {
  const body = card.body;
  if (!Array.isArray(body)) return null;
  const columnSet = body.find((node) => asRecord(node)?.type === "ColumnSet");
  const columns = asRecord(columnSet)?.columns;
  if (!Array.isArray(columns)) return null;
  const items = asRecord(columns[0])?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const text = elementText(item).trim();
    if (text) return text;
  }
  return null;
}

/**
 * 该卡是否为「仍在进行中」的 agent progress 卡（可被 final-text 兜底降级）。
 *
 * 严格保守：仅当确认是 agent_progress_v1 卡、且 header 首字命中进行中标记（🤖/⏳）且未命中任何
 * 终态/等待标记时返回 true；其余（终态、等待、未识别、非 progress 卡）一律返回 false。
 */
export function isNonTerminalProgressCard(
  card: Record<string, unknown>
): boolean {
  if (!isAgentProgressCard(card)) return false;
  const header = getProgressCardHeaderText(card);
  if (!header) return false;
  if (TERMINAL_HEADER_MARKERS.some((m) => header.startsWith(m))) return false;
  return ACTIVE_HEADER_MARKERS.some((m) => header.startsWith(m));
}

/**
 * 距卡片最后一次 patch 是否已空闲够久，可触发兜底。
 * `cardUpdatedAtSec` 缺失（从未记录）时保守返回 false。
 */
export function isProgressCardIdleEnough(
  cardUpdatedAtSec: number | undefined,
  finalTextAtSec: number,
  minIdleSec: number = CARD_FALLBACK_MIN_IDLE_SEC
): boolean {
  if (typeof cardUpdatedAtSec !== "number") return false;
  return finalTextAtSec - cardUpdatedAtSec >= minIdleSec;
}
