type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * AdaptiveCards `isVisible:false` 语义：元素在 DOM 中隐藏，用户不可见。
 * 表格复制必须与所见一致，故抽取阶段跳过（含 ToggleVisibility 初始隐藏）。
 * 校验层已保证 isVisible 只能是 boolean（validateCardForOcto），
 * 但为鲁棒性这里仍按「显式 false 才隐藏」判定。
 */
function isHidden(node: unknown): boolean {
  const obj = asObject(node);
  return obj?.isVisible === false;
}

function normalizeCellText(text: string): string {
  return text
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromElement(element: unknown): string {
  if (isHidden(element)) return "";
  const obj = asObject(element);
  if (!obj || typeof obj.type !== "string") return "";

  switch (obj.type) {
    case "TextBlock":
      return typeof obj.text === "string" ? obj.text : "";
    case "RichTextBlock":
      return asArray(obj.inlines)
        .filter((inline) => !isHidden(inline))
        .map((inline) => {
          const run = asObject(inline);
          return run?.type === "TextRun" && typeof run.text === "string"
            ? run.text
            : "";
        })
        .join("");
    case "FactSet":
      return asArray(obj.facts)
        .map((fact) => {
          const f = asObject(fact);
          const title = typeof f?.title === "string" ? f.title : "";
          const value = typeof f?.value === "string" ? f.value : "";
          return title || value
            ? `${title}${title && value ? ": " : ""}${value}`
            : "";
        })
        .filter(Boolean)
        .join(" ");
    case "Container":
      return asArray(obj.items)
        .filter((item) => !isHidden(item))
        .map(extractTextFromElement)
        .join(" ");
    case "ColumnSet":
      return asArray(obj.columns)
        .filter((column) => !isHidden(column))
        .map((column) => extractTextFromItems(asObject(column)?.items))
        .join(" ");
    case "Image":
      return typeof obj.altText === "string" ? obj.altText : "";
    default:
      return "";
  }
}

function extractTextFromItems(items: unknown): string {
  return asArray(items)
    .filter((item) => !isHidden(item))
    .map(extractTextFromElement)
    .join(" ");
}

/**
 * 收集卡片树中所有 Table 节点。
 *
 * 与 findTableRoots / extractTableShapes 严格同序、同长度：调用方按 index 位置
 * 把 root ↔ copyText 配对（see attachTableCopyButtons）。任何一处引入
 * filter/dedup 都会让 index 错位，进而把 A 表的按钮绑定到 B 表的文本。
 *
 * 隐藏 Table（isVisible:false）**仍纳入序列**——SDK 会把它渲进 DOM（仅 CSS 隐藏），
 * findTableRoots 走 HTML 路径时也能命中，故位序不能省。抽取时会返回空文本，
 * attachTableCopyButtons 检测到空文本自动跳过挂按钮（既不泄内容也不错位）。
 */
function collectTables(node: unknown, out: JsonObject[]): void {
  const obj = asObject(node);
  if (!obj) return;
  if (obj.type === "Table") out.push(obj);

  for (const child of asArray(obj.body)) collectTables(child, out);
  for (const child of asArray(obj.items)) collectTables(child, out);
  for (const child of asArray(obj.columns)) collectTables(child, out);
  for (const row of asArray(obj.rows)) {
    const rowObj = asObject(row);
    for (const cell of asArray(rowObj?.cells)) collectTables(cell, out);
  }
  for (const cellItem of asArray(obj.cells)) collectTables(cellItem, out);
}

function extractTableText(table: JsonObject): string {
  if (isHidden(table)) return "";
  return asArray(table.rows)
    .filter((row) => !isHidden(row))
    .map((row) => {
      const rowObj = asObject(row);
      return asArray(rowObj?.cells)
        .filter((cell) => !isHidden(cell))
        .map((cell) =>
          normalizeCellText(extractTextFromItems(asObject(cell)?.items))
        )
        .join("\t");
    })
    .join("\n")
    .trim();
}

/**
 * 返回每张 Table 的 TSV 文本，长度和顺序与 collectTables 严格对齐。
 *
 * 契约（安全 & 数据完整性）：
 *   1. 一表一槽：**不做 filter/dedup**，空文本的表返回 `""` 占位。这样
 *      copyTexts[i] 始终对应 tableRoots[i]（see attachTableCopyButtons），
 *      否则一张早期的空表会让后续所有按钮串到错误内容。
 *   2. isVisible 感知：隐藏行/单元格/元素不参与文本抽取，杜绝 ToggleVisibility
 *      场景下「显示的内容 ≠ 复制的内容」的隐藏内容泄漏。
 */
export function extractTableCopyTexts(card: Record<string, unknown>): string[] {
  const tables: JsonObject[] = [];
  collectTables(card, tables);
  return tables.map(extractTableText);
}

function isElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

function isSdkTableRow(row: Element, columnCount: number): boolean {
  const cells = Array.from(row.children).filter((child) =>
    child.classList.contains("ac-container")
  );
  return cells.length === columnCount;
}

function findSdkDivTables(
  target: HTMLElement,
  tableShapes: Array<{ rows: number; columns: number }>
): HTMLElement[] {
  const candidates = Array.from(target.querySelectorAll("div")).filter(
    (node): node is HTMLElement => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.className) return false;
      const rows = Array.from(node.children);
      if (rows.length === 0) return false;
      return rows.every((row) => row instanceof HTMLElement && !row.className);
    }
  );

  const used = new Set<HTMLElement>();
  return tableShapes
    .map((shape) => {
      const match = candidates.find((candidate) => {
        if (used.has(candidate)) return false;
        const rows = Array.from(candidate.children);
        return (
          rows.length === shape.rows &&
          rows.every((row) => isSdkTableRow(row, shape.columns))
        );
      });
      if (match) used.add(match);
      return match;
    })
    .filter(isElement);
}

function findTableRoots(
  target: HTMLElement,
  card: Record<string, unknown>
): HTMLElement[] {
  const htmlTables = Array.from(
    target.querySelectorAll<HTMLElement>("table:not(.ac-factset)")
  );
  if (htmlTables.length > 0) return htmlTables;

  const tableShapes = extractTableShapes(card);
  return findSdkDivTables(target, tableShapes);
}

const TABLE_CELL_PADDING = "var(--wk-sp-2, 8px) var(--wk-sp-5, 20px)";

function applyTableCellSpacing(tableRoot: HTMLElement): void {
  if (tableRoot.tagName.toLowerCase() === "table") {
    tableRoot.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
      cell.style.setProperty("padding", TABLE_CELL_PADDING);
    });
    return;
  }

  Array.from(tableRoot.children).forEach((row) => {
    Array.from(row.children).forEach((cell) => {
      if (
        cell instanceof HTMLElement &&
        cell.classList.contains("ac-container")
      ) {
        cell.style.setProperty("padding", TABLE_CELL_PADDING);
      }
    });
  });
}

function extractTableShapes(
  card: Record<string, unknown>
): Array<{ rows: number; columns: number }> {
  const tables: JsonObject[] = [];
  collectTables(card, tables);
  return tables.map((table) => ({
    rows: asArray(table.rows).length,
    columns: asArray(table.columns).length,
  }));
}

export interface AttachTableCopyButtonsOptions {
  card: Record<string, unknown>;
  target: HTMLElement;
  label: string;
  onCopy: (text: string) => void;
}

export function attachTableCopyButtons(
  options: AttachTableCopyButtonsOptions
): void {
  const { card, target, label, onCopy } = options;
  const copyTexts = extractTableCopyTexts(card);
  // 允许全空：hidden/纯图表格返回 [""...]，forEach 会自动跳过挂按钮。
  // 但完全没有 Table 时提前退出，省去 DOM 查询。
  if (copyTexts.length === 0) return;

  const tableRoots = findTableRoots(target, card);
  tableRoots.forEach((tableRoot, index) => {
    // index 与 copyTexts 严格对齐（extractTableCopyTexts / collectTables 契约）；
    // 空文本 → 该 Table 无可复制内容（纯图或整表 isVisible:false），跳过挂按钮但不解构后续索引。
    const text = copyTexts[index];
    if (!text) {
      return;
    }
    applyTableCellSpacing(tableRoot);

    if (
      tableRoot.parentElement?.classList.contains(
        "wk-interactive-card-table-frame"
      )
    ) {
      return;
    }

    const frame = document.createElement("div");
    frame.className = "wk-interactive-card-table-frame";

    const header = document.createElement("div");
    header.className = "wk-interactive-card-table-header";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wk-interactive-card-table-copy";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCopy(text);
    });
    header.appendChild(button);

    tableRoot.parentNode?.insertBefore(frame, tableRoot);
    frame.appendChild(header);
    frame.appendChild(tableRoot);
  });
}
