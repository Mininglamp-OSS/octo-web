import { isSafeUrl } from "../../Utils/security";
import { RenderBudget } from "./guards";

/**
 * octo 预校验 pass（纯函数，不产 JSX）。
 *
 * 背景：官方 AdaptiveCards SDK 默认对未知元素做**逐元素** fallback（丢弃/替换该元素、其余照渲），
 * 而 octo 契约要求**整卡降级为 plain**（任一未知/损坏/越界 → 整卡退 plain，无 per-element fallback）。
 * 故把卡片喂给 SDK 之前，先用本函数走一遍 octo 白名单/结构/预算/D1 校验：
 *   - `ok:false` ⇒ Cell 不喂 SDK，直接渲 plain（实现整卡降级）；
 *   - `ok:true`  ⇒ 交给 SDK 渲染。
 *
 * 规则实现 octo 契约的整卡降级条件（元素/动作白名单、结构、URL、预算、D1），确保
 * 「校验面 ≥ 渲染面」，与服务端 `pkg/cardmsg` walker 对齐。
 *
 * 注意分工（与整卡降级区分）：
 *   - Action.OpenUrl / selectAction 的 url 非法（javascript: 等）→ **整卡降级**（本函数 ok:false）；
 *   - Image.url / backgroundImage / iconUrl 非 https（混合内容）→ **不在此降级**，属 per-element
 *     处理（喂 SDK 前对 card 树做 URL 消毒，见 S4），本函数视其结构合法。
 */

export interface ValidateOptions {
  /** octo/v2：允许 Input.* / Action.Submit。默认 false（octo/v1）。 */
  allowInteractive?: boolean;
}

export interface ValidateResult {
  ok: boolean;
}

/** 内部整卡降级信号（仅用于提前中断校验，catch 后转为 ok:false）。 */
class OctoInvalidCard extends Error {}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** 结构化数组字段：缺省合法（空数组）；present-but-非数组 = 结构损坏 → 整卡降级。 */
function requireArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new OctoInvalidCard("structural field must be an array");
  }
  return v;
}

interface Ctx {
  budget: RenderBudget;
  allowInteractive: boolean;
  seenIds: Set<string>;
  targetableElementIds: Set<string>;
  targetRefs: string[];
}

function normalizeRequiredId(kind: string, rawId: unknown): string {
  if (typeof rawId !== "string" || rawId.trim() === "") {
    throw new OctoInvalidCard(`${kind} missing id`);
  }
  return rawId;
}

function registerUniqueId(ctx: Ctx, id: string): void {
  if (ctx.seenIds.has(id)) {
    throw new OctoInvalidCard("duplicate id in frame");
  }
  ctx.seenIds.add(id);
}

/** 登记帧内交互 id（Input.* / Action.Submit 与元素 id 共享命名空间）；缺失/重复 → 整卡降级。 */
function registerInteractiveId(ctx: Ctx, rawId: unknown): void {
  registerUniqueId(ctx, normalizeRequiredId("interactive element", rawId));
}

function requireRegisteredElementId(rawId: unknown): void {
  normalizeRequiredId("interactive element", rawId);
}

function registerElementId(ctx: Ctx, rawId: unknown): string | undefined {
  if (rawId === undefined || rawId === null) return undefined;
  const id = normalizeRequiredId("element", rawId);
  registerUniqueId(ctx, id);
  ctx.targetableElementIds.add(id);
  return id;
}

function registerElementIdWithVisibility(
  ctx: Ctx,
  obj: Record<string, unknown>
): string | undefined {
  const id = registerElementId(ctx, obj.id);
  if (obj.isVisible !== undefined && typeof obj.isVisible !== "boolean") {
    throw new OctoInvalidCard("isVisible must be boolean");
  }
  return id;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function validateToggleTargetElement(target: unknown, ctx: Ctx): void {
  if (typeof target === "string") {
    if (target.trim() === "") {
      throw new OctoInvalidCard("ToggleVisibility target id is empty");
    }
    ctx.targetRefs.push(target);
    return;
  }
  const obj = asObject(target);
  if (
    !obj ||
    typeof obj.elementId !== "string" ||
    obj.elementId.trim() === ""
  ) {
    throw new OctoInvalidCard("malformed ToggleVisibility target");
  }
  if (obj.isVisible !== undefined && typeof obj.isVisible !== "boolean") {
    throw new OctoInvalidCard(
      "ToggleVisibility target isVisible must be boolean"
    );
  }
  ctx.targetRefs.push(obj.elementId);
}

function validateToggleVisibilityAction(
  obj: Record<string, unknown>,
  ctx: Ctx
): void {
  const targets = requireArray(obj.targetElements);
  if (targets.length === 0) {
    throw new OctoInvalidCard("ToggleVisibility targetElements required");
  }
  for (const target of targets) {
    // 每个 target 计入节点预算（与 facts / actions / columns / choices / images 一致），
    // 对齐服务端 walker MAX_NODES 计数口径，防止巨量 target 数组绕过预算。
    if (!ctx.budget.consume()) throw new OctoInvalidCard("node count exceeded");
    validateToggleTargetElement(target, ctx);
  }
}

function validateCopyToClipboardAction(obj: Record<string, unknown>): void {
  if (typeof obj.text !== "string") {
    throw new OctoInvalidCard("CopyToClipboard text required");
  }
  if (utf8ByteLength(obj.text) > 4096) {
    throw new OctoInvalidCard("CopyToClipboard text too large");
  }
  if (obj.title !== undefined && typeof obj.title !== "string") {
    throw new OctoInvalidCard("CopyToClipboard title must be string");
  }
}

/** 校验一个动作（根 actions / selectAction 共用）。非 OpenUrl 且非（v2）Submit → 降级。 */
function validateAction(action: unknown, ctx: Ctx): void {
  const obj = asObject(action);
  if (ctx.allowInteractive && obj?.type === "Action.Submit") {
    // Action.Submit：id 必填 + 帧内唯一（data 不参与校验，客户端不回传）。
    registerInteractiveId(ctx, obj.id);
    return;
  }
  if (obj?.type === "Action.ToggleVisibility") {
    validateToggleVisibilityAction(obj, ctx);
    return;
  }
  if (obj?.type === "Action.CopyToClipboard") {
    validateCopyToClipboardAction(obj);
    return;
  }
  if (!obj || obj.type !== "Action.OpenUrl") {
    // 未知/不支持动作（Execute/ShowCard/v1 下的 Submit/其他）→ 整卡降级。
    throw new OctoInvalidCard("unsupported action");
  }
  const url = obj.url;
  if (typeof url !== "string" || !isSafeUrl(url)) {
    throw new OctoInvalidCard("Action.OpenUrl has unsafe/missing url");
  }
  // iconUrl 混合内容属 per-element（非法则渲染期忽略），不在此降级。
}

/** 校验 selectAction：不存在合法；存在则计入预算 + 走动作校验。 */
function validateSelectAction(sel: unknown, ctx: Ctx): void {
  if (sel === undefined || sel === null) return;
  validateAction(sel, ctx);
  if (!ctx.budget.consume()) throw new OctoInvalidCard("node count exceeded");
}

function validateItems(items: unknown[], ctx: Ctx): void {
  for (const el of items) validateElement(el, ctx);
}

function validateRichTextInline(inline: unknown, ctx: Ctx): void {
  if (!ctx.budget.consume()) throw new OctoInvalidCard("node count exceeded");
  const obj = asObject(inline);
  if (!obj || obj.type !== "TextRun") {
    throw new OctoInvalidCard("unsupported rich text inline");
  }
  validateSelectAction(obj.selectAction, ctx);
}

function validateImageSetImage(image: unknown, ctx: Ctx): void {
  if (!ctx.budget.consume()) throw new OctoInvalidCard("node count exceeded");
  const obj = asObject(image);
  if (!obj || obj.type !== "Image") {
    throw new OctoInvalidCard("malformed image set image");
  }
  registerElementIdWithVisibility(ctx, obj);
  validateSelectAction(obj.selectAction, ctx);
}

function validateElement(el: unknown, ctx: Ctx): void {
  if (!ctx.budget.consume()) throw new OctoInvalidCard("node count exceeded");
  const obj = asObject(el);
  if (!obj || typeof obj.type !== "string") {
    throw new OctoInvalidCard("malformed element");
  }
  const elementId = registerElementIdWithVisibility(ctx, obj);
  switch (obj.type) {
    case "TextBlock":
      return;
    case "RichTextBlock": {
      const inlines = requireArray(obj.inlines);
      for (const inline of inlines) validateRichTextInline(inline, ctx);
      return;
    }
    case "Image":
      // Image.url 混合内容属 per-element（喂 SDK 前消毒），结构层合法。
      validateSelectAction(obj.selectAction, ctx);
      return;
    case "ImageSet": {
      const images = requireArray(obj.images);
      for (const image of images) validateImageSetImage(image, ctx);
      return;
    }
    case "FactSet": {
      const facts = requireArray(obj.facts);
      for (const _f of facts) {
        if (!ctx.budget.consume())
          throw new OctoInvalidCard("node count exceeded");
      }
      return;
    }
    case "ActionSet": {
      const actions = requireArray(obj.actions);
      for (const action of actions) {
        if (!ctx.budget.consume())
          throw new OctoInvalidCard("node count exceeded");
        validateAction(action, ctx);
      }
      return;
    }
    case "Container": {
      if (!ctx.budget.enter()) throw new OctoInvalidCard("depth exceeded");
      validateItems(requireArray(obj.items), ctx);
      validateSelectAction(obj.selectAction, ctx);
      ctx.budget.leave();
      return;
    }
    case "Table": {
      if (!ctx.budget.enter()) throw new OctoInvalidCard("depth exceeded");
      const columns = requireArray(obj.columns);
      if (columns.length === 0) {
        throw new OctoInvalidCard("Table columns required");
      }
      for (const column of columns) {
        if (!asObject(column))
          throw new OctoInvalidCard("malformed table column");
        if (!ctx.budget.consume())
          throw new OctoInvalidCard("node count exceeded");
      }
      const rows = requireArray(obj.rows);
      for (const row of rows) {
        const rowObj = asObject(row);
        if (!rowObj) throw new OctoInvalidCard("malformed table row");
        registerElementIdWithVisibility(ctx, rowObj);
        if (!ctx.budget.consume())
          throw new OctoInvalidCard("node count exceeded");
        const cells = requireArray(rowObj.cells);
        if (cells.length !== columns.length) {
          throw new OctoInvalidCard("Table row cell count mismatch");
        }
        for (const cell of cells) {
          const cellObj = asObject(cell);
          if (!cellObj) throw new OctoInvalidCard("malformed table cell");
          registerElementIdWithVisibility(ctx, cellObj);
          if (!ctx.budget.consume())
            throw new OctoInvalidCard("node count exceeded");
          if (!ctx.budget.enter()) throw new OctoInvalidCard("depth exceeded");
          validateSelectAction(cellObj.selectAction, ctx);
          validateItems(requireArray(cellObj.items), ctx);
          ctx.budget.leave();
        }
      }
      ctx.budget.leave();
      return;
    }
    case "ColumnSet": {
      if (!ctx.budget.enter()) throw new OctoInvalidCard("depth exceeded");
      validateSelectAction(obj.selectAction, ctx);
      const columns = requireArray(obj.columns);
      for (const c of columns) {
        const co = asObject(c);
        if (!co) throw new OctoInvalidCard("malformed column");
        // Column.type 可省略（缺省视为 Column）；仅拒绝显式非 Column。
        if (co.type !== undefined && co.type !== "Column") {
          throw new OctoInvalidCard("unsupported column");
        }
        registerElementIdWithVisibility(ctx, co);
        if (!ctx.budget.consume())
          throw new OctoInvalidCard("node count exceeded");
        if (!ctx.budget.enter()) throw new OctoInvalidCard("depth exceeded");
        validateSelectAction(co.selectAction, ctx);
        validateItems(requireArray(co.items), ctx);
        ctx.budget.leave();
      }
      ctx.budget.leave();
      return;
    }
    case "Input.Text":
    case "Input.Toggle":
    case "Input.ChoiceSet":
    case "Input.Number":
    case "Input.Date":
    case "Input.Time": {
      if (!ctx.allowInteractive) {
        // octo/v1 内出现 Input.* = 白名单外 → 整卡降级。
        throw new OctoInvalidCard("unsupported element (interactive)");
      }
      if (elementId === undefined) {
        registerInteractiveId(ctx, obj.id);
      } else {
        requireRegisteredElementId(obj.id);
      }
      if (obj.type === "Input.ChoiceSet") {
        // 每个 choice 计入节点预算（与 FactSet.facts / actions / columns 一致，对齐服务端 walker）。
        const choices = requireArray(obj.choices);
        for (let i = 0; i < choices.length; i++) {
          if (!ctx.budget.consume())
            throw new OctoInvalidCard("node count exceeded");
        }
      }
      // 输入的 inlineAction（框内内联按钮，通常 Action.Submit）：按动作同规则校验
      // （id 帧内唯一 / OpenUrl url 安全 / 非白名单动作整卡降级）并计入预算，
      // 避免 SDK 渲染出未经 validate 的内联动作（对齐服务端 inlineAction 路由）。
      if (obj.inlineAction !== undefined && obj.inlineAction !== null) {
        validateAction(obj.inlineAction, ctx);
        if (!ctx.budget.consume())
          throw new OctoInvalidCard("node count exceeded");
      }
      return;
    }
    default:
      throw new OctoInvalidCard("unsupported element");
  }
}

/**
 * 校验整张卡是否可交给 SDK 渲染。任一违规 → `{ok:false}`（Cell 据此整卡降级为 plain）。
 */
export function validateCardForOcto(
  card: Record<string, unknown>,
  opts?: ValidateOptions
): ValidateResult {
  try {
    if (!card || card.type !== "AdaptiveCard") {
      throw new OctoInvalidCard("not an AdaptiveCard");
    }
    const ctx: Ctx = {
      budget: new RenderBudget(),
      allowInteractive: opts?.allowInteractive ?? false,
      seenIds: new Set<string>(),
      targetableElementIds: new Set<string>(),
      targetRefs: [],
    };
    validateSelectAction(card.selectAction, ctx);
    validateItems(requireArray(card.body), ctx);
    const actions = requireArray(card.actions);
    for (const a of actions) {
      if (!ctx.budget.consume())
        throw new OctoInvalidCard("node count exceeded");
      validateAction(a, ctx);
    }
    for (const elementId of ctx.targetRefs) {
      if (!ctx.targetableElementIds.has(elementId)) {
        throw new OctoInvalidCard("ToggleVisibility target does not exist");
      }
    }
    if (ctx.budget.exceeded) throw new OctoInvalidCard("budget exceeded");
    return { ok: true };
  } catch (e) {
    if (e instanceof OctoInvalidCard) return { ok: false };
    // 非预期异常同样 fail-closed（整卡降级），不外泄。
    return { ok: false };
  }
}

export default validateCardForOcto;
