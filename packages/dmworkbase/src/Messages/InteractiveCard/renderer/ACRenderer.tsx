import React from "react";
import { isHttpsUrl } from "../../../Utils/security";
import { RenderBudget } from "../guards";
import {
  CardRenderError,
  openUrl,
  parseOpenUrl,
  parseSelectAction,
  type OpenUrlAction,
} from "./actions";
import { CardMarkdown } from "./cardMarkdown";

/**
 * Adaptive Cards octo/v1 静态渲染器（波 1 展示型）。
 *
 * 契约（对齐服务端 pkg/cardmsg，无 per-element fallback）：
 *   - 支持 5 元素：TextBlock / Image / Container / ColumnSet(含 Column) / FactSet；
 *   - 支持 Action.OpenUrl + selectAction(仅含 OpenUrl)；
 *   - 未知元素/动作、结构损坏、深/宽越界 → 抛 CardRenderError，由 Cell 整卡 fallback plain；
 *   - Image http（混合内容）→ per-element 占位（契约明确允许，非整卡 fallback）；
 *   - 波 1 不实现任何交互（Input.* / Submit / Execute），不发 card/action 请求。
 */

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * 结构化数组字段（body / items / columns / actions / facts）取值。
 * 缺省（undefined/null）视为空数组（合法）；但「存在且非数组」是结构损坏
 * （对齐服务端 ErrCardBadShape）→ 抛 CardRenderError 触发整卡 plain fallback，
 * 不 fail-open 成空/部分卡（本模块威胁模型假设畸形 payload 可绕过服务端到达客户端）。
 */
function requireArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new CardRenderError("structural field must be an array");
  }
  return v;
}

/** 解析 backgroundImage（string 或 {url}），仅 https 生效（混合内容防护）。 */
function backgroundStyle(bg: unknown): React.CSSProperties | undefined {
  let url: string | undefined;
  if (typeof bg === "string") url = bg;
  else {
    const obj = asObject(bg);
    if (obj && typeof obj.url === "string") url = obj.url;
  }
  if (!url || !isHttpsUrl(url)) return undefined;
  return {
    // encodeURI 加固：即便 URL 含引号也不会破坏 url("...") 字面量（isHttpsUrl 已挡危险 scheme）。
    backgroundImage: `url("${encodeURI(url)}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

/** 可点区域包装：selectAction 携带 OpenUrl 时，元素整体可点（onClick 打开，避免嵌套锚点）。 */
function withSelectAction(
  node: React.ReactElement,
  select: OpenUrlAction | null
): React.ReactElement {
  if (!select) return node;
  return (
    <div
      className="wk-interactive-card-clickable"
      role="link"
      tabIndex={0}
      onClick={(e) => {
        // 阻止冒泡：嵌套可点区域 / 内部链接点击不应再触发外层 selectAction。
        e.stopPropagation();
        openUrl(select.url);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          openUrl(select.url);
        }
      }}
    >
      {node}
    </div>
  );
}

/**
 * 解析 selectAction 并计入节点预算。服务端 walker 把每个 selectAction 当一个 action 节点，
 * 故存在有效 selectAction 时 consume() 一次，越界整卡 fallback。
 * （非 OpenUrl 的 selectAction 由 parseSelectAction 抛错，先于计数。）
 */
function resolveSelectAction(
  sel: unknown,
  budget: RenderBudget
): OpenUrlAction | null {
  const action = parseSelectAction(sel);
  if (action && !budget.consume()) {
    throw new CardRenderError("node count exceeded");
  }
  return action;
}

function renderTextBlock(
  el: Record<string, unknown>,
  key: string
): React.ReactElement {
  const text = typeof el.text === "string" ? el.text : "";
  const weight = el.weight === "Bolder" ? " wk-interactive-card-tb--bold" : "";
  return (
    <div key={key} className={`wk-interactive-card-textblock${weight}`}>
      <CardMarkdown text={text} />
    </div>
  );
}

function renderImage(
  el: Record<string, unknown>,
  key: string,
  budget: RenderBudget
): React.ReactElement {
  const url = typeof el.url === "string" ? el.url : "";
  const altText = typeof el.altText === "string" ? el.altText : "";
  // Image 也可携带 selectAction（服务端 validate 允许并计数），与其他元素一致处理。
  const select = resolveSelectAction(el.selectAction, budget);
  // 图片面仅渲 https；http（混合内容）或非法 → 占位（不自动升级，不整卡 fallback）。
  const node = !isHttpsUrl(url) ? (
    <div
      key={key}
      className="wk-interactive-card-img-placeholder"
      aria-label={altText}
    >
      {altText}
    </div>
  ) : (
    <img
      key={key}
      className="wk-interactive-card-img"
      src={url}
      alt={altText}
      loading="lazy"
    />
  );
  return withSelectAction(node, select);
}

function renderFactSet(
  el: Record<string, unknown>,
  key: string,
  budget: RenderBudget
): React.ReactElement {
  const facts = requireArray(el.facts);
  return (
    <div key={key} className="wk-interactive-card-factset">
      {facts.map((f, i) => {
        // 每个 fact 计入节点预算（对齐服务端 walker），越界整卡 fallback。
        if (!budget.consume()) throw new CardRenderError("node count exceeded");
        const fo = asObject(f);
        const title = fo && typeof fo.title === "string" ? fo.title : "";
        const value = fo && typeof fo.value === "string" ? fo.value : "";
        return (
          <div key={`${key}-f${i}`} className="wk-interactive-card-fact">
            <div className="wk-interactive-card-fact-title">
              <CardMarkdown text={title} />
            </div>
            <div className="wk-interactive-card-fact-value">
              <CardMarkdown text={value} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderContainer(
  el: Record<string, unknown>,
  key: string,
  budget: RenderBudget
): React.ReactElement {
  const items = renderItems(requireArray(el.items), `${key}-i`, budget);
  const select = resolveSelectAction(el.selectAction, budget);
  const node = (
    <div
      key={key}
      className="wk-interactive-card-container"
      style={backgroundStyle(el.backgroundImage)}
    >
      {items}
    </div>
  );
  return withSelectAction(node, select);
}

function renderColumnSet(
  el: Record<string, unknown>,
  key: string,
  budget: RenderBudget
): React.ReactElement {
  const columns = requireArray(el.columns);
  const select = resolveSelectAction(el.selectAction, budget);
  const cols = columns.map((c, i) => {
    const co = asObject(c);
    if (!co) {
      throw new CardRenderError("malformed column");
    }
    // ColumnSet.columns[*] 的 type 可省略（AC 隐式规则，服务端 validate 亦允许）：
    // 缺省视为 Column，仅拒绝显式的非 Column type。
    if (co.type !== undefined && co.type !== "Column") {
      throw new CardRenderError(`unsupported column: ${co.type}`);
    }
    // 每个 Column 计入节点预算（对齐服务端 walker）。
    if (!budget.consume()) throw new CardRenderError("node count exceeded");
    if (!budget.enter()) throw new CardRenderError("depth exceeded");
    const colSelect = resolveSelectAction(co.selectAction, budget);
    const inner = (
      <div
        key={`${key}-c${i}`}
        className="wk-interactive-card-column"
        style={backgroundStyle(co.backgroundImage)}
      >
        {renderItems(requireArray(co.items), `${key}-c${i}-i`, budget)}
      </div>
    );
    budget.leave();
    return withSelectAction(inner, colSelect);
  });
  const node = (
    <div
      key={key}
      className="wk-interactive-card-columnset"
      style={backgroundStyle(el.backgroundImage)}
    >
      {cols}
    </div>
  );
  return withSelectAction(node, select);
}

/** 分发单个元素。未知 type → 整卡 fallback。 */
function renderElement(
  el: unknown,
  key: string,
  budget: RenderBudget
): React.ReactElement {
  if (!budget.consume()) throw new CardRenderError("node count exceeded");
  const obj = asObject(el);
  if (!obj || typeof obj.type !== "string") {
    throw new CardRenderError("malformed element");
  }
  switch (obj.type) {
    case "TextBlock":
      return renderTextBlock(obj, key);
    case "Image":
      return renderImage(obj, key, budget);
    case "FactSet":
      return renderFactSet(obj, key, budget);
    case "Container": {
      if (!budget.enter()) throw new CardRenderError("depth exceeded");
      const node = renderContainer(obj, key, budget);
      budget.leave();
      return node;
    }
    case "ColumnSet": {
      if (!budget.enter()) throw new CardRenderError("depth exceeded");
      const node = renderColumnSet(obj, key, budget);
      budget.leave();
      return node;
    }
    default:
      // 未知元素（已知 profile 内）→ 整卡 fallback plain。
      throw new CardRenderError(`unsupported element: ${obj.type}`);
  }
}

function renderItems(
  items: unknown[],
  keyPrefix: string,
  budget: RenderBudget
): React.ReactElement[] {
  return items.map((el, i) => renderElement(el, `${keyPrefix}-${i}`, budget));
}

function renderActions(
  actions: unknown[],
  budget: RenderBudget
): React.ReactElement | null {
  if (actions.length === 0) return null;
  const parsed = actions.map((a) => {
    // 每个 action 计入节点预算（对齐服务端 walker），越界整卡 fallback。
    if (!budget.consume()) throw new CardRenderError("node count exceeded");
    return parseOpenUrl(a); // 非 OpenUrl → 抛整卡 fallback
  });
  return (
    <div className="wk-interactive-card-actions">
      {parsed.map((a, i) => (
        <button
          key={`action-${i}`}
          type="button"
          className="wk-interactive-card-action"
          onClick={(e) => {
            // 阻止冒泡：按钮点击不应触发外层 selectAction 可点区域。
            e.stopPropagation();
            openUrl(a.url);
          }}
        >
          {a.iconUrl && (
            <img
              className="wk-interactive-card-action-icon"
              src={a.iconUrl}
              alt=""
            />
          )}
          {a.title}
        </button>
      ))}
    </div>
  );
}

/**
 * 渲染 AdaptiveCard 根。任何未知元素/动作、结构损坏、深/宽越界均抛 CardRenderError。
 * 调用方（Cell）必须 try-catch，捕获后整卡退 plain。
 */
export function renderCard(
  card: Record<string, unknown>,
  budget: RenderBudget
): React.ReactElement {
  if (!card || card.type !== "AdaptiveCard") {
    throw new CardRenderError(`not an AdaptiveCard: ${card?.type}`);
  }
  const select = resolveSelectAction(card.selectAction, budget);
  const body = renderItems(requireArray(card.body), "b", budget);
  const actions = renderActions(requireArray(card.actions), budget);
  if (budget.exceeded) throw new CardRenderError("budget exceeded");

  const node = (
    <div
      className="wk-interactive-card-root"
      style={backgroundStyle(card.backgroundImage)}
    >
      {body}
      {actions}
    </div>
  );
  return withSelectAction(node, select);
}

export { CardRenderError } from "./actions";
