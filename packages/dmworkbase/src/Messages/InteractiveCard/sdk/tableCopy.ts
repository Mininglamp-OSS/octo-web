type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeCellText(text: string): string {
  return text
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromElement(element: unknown): string {
  const obj = asObject(element);
  if (!obj || typeof obj.type !== "string") return "";

  switch (obj.type) {
    case "TextBlock":
      return typeof obj.text === "string" ? obj.text : "";
    case "RichTextBlock":
      return asArray(obj.inlines)
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
      return asArray(obj.items).map(extractTextFromElement).join(" ");
    case "ColumnSet":
      return asArray(obj.columns)
        .map((column) => extractTextFromItems(asObject(column)?.items))
        .join(" ");
    case "Image":
      return typeof obj.altText === "string" ? obj.altText : "";
    default:
      return "";
  }
}

function extractTextFromItems(items: unknown): string {
  return asArray(items).map(extractTextFromElement).join(" ");
}

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

export function extractTableCopyTexts(card: Record<string, unknown>): string[] {
  const tables: JsonObject[] = [];
  collectTables(card, tables);

  return tables
    .map((table) =>
      asArray(table.rows)
        .map((row) => {
          const rowObj = asObject(row);
          return asArray(rowObj?.cells)
            .map((cell) =>
              normalizeCellText(extractTextFromItems(asObject(cell)?.items))
            )
            .join("\t");
        })
        .join("\n")
        .trim()
    )
    .filter(Boolean);
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
  if (copyTexts.length === 0) return;

  const tableRoots = findTableRoots(target, card);
  tableRoots.forEach((tableRoot, index) => {
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
