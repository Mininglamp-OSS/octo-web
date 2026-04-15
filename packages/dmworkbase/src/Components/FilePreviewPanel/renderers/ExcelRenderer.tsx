import React, { useState, useEffect, useCallback } from "react";
import { TableVirtuoso } from "react-virtuoso";
import { BaseRendererProps } from "../types";
import { TooltipCell } from "./TooltipCell";
import "./ExcelRenderer.css";

export interface ExcelRendererProps extends BaseRendererProps {}

/** 列配置 */
interface ColumnConfig {
  key: string | symbol;
  title: string;
}

/** 工作表数据 */
interface SheetData {
  name: string;
  data: Record<string | symbol, unknown>[];
  columns: ColumnConfig[];
}

// 动态加载 xlsx 库
let xlsxLibrary: typeof import("xlsx") | null = null;

async function loadXlsxLibrary(): Promise<typeof import("xlsx")> {
  if (xlsxLibrary) return xlsxLibrary;

  try {
    xlsxLibrary = await import("xlsx");
    return xlsxLibrary;
  } catch {
    xlsxLibrary = (window as unknown as Record<string, typeof import("xlsx")>)
      .XLSX;
    if (xlsxLibrary) return xlsxLibrary;
    throw new Error("xlsx library not available");
  }
}

/**
 * 裁剪尾部空行和右侧空列
 */
const trimEmptyRowsAndColumns = (data: unknown[][]): unknown[][] => {
  if (!data || data.length === 0) return data;

  // 1. 裁剪尾部空行
  let lastNonEmptyRowIndex = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const hasContent = row.some(
      (cell) => cell !== null && cell !== undefined && cell !== ""
    );
    if (hasContent) {
      lastNonEmptyRowIndex = i;
      break;
    }
  }
  const trimmedRows = data.slice(0, lastNonEmptyRowIndex + 1);
  if (trimmedRows.length === 0) return [];

  // 2. 找到最右侧非空列
  let lastNonEmptyColIndex = 0;
  trimmedRows.forEach((row) => {
    for (let i = row.length - 1; i >= 0; i--) {
      const cell = row[i];
      if (cell !== null && cell !== undefined && cell !== "") {
        lastNonEmptyColIndex = Math.max(lastNonEmptyColIndex, i);
        break;
      }
    }
  });

  // 3. 裁剪右侧空列
  return trimmedRows.map((row) => row.slice(0, lastNonEmptyColIndex + 1));
};

/**
 * 解析工作簿为 SheetData 数组
 */
function parseWorkbook(
  XLSX: typeof import("xlsx"),
  rawData: ArrayBuffer | Uint8Array
): SheetData[] {
  const workbook = XLSX.read(rawData, {
    type: "array",
    codepage: 65001,
    raw: true,
  });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const jsonData = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }) as unknown[][];

    const trimmedData = trimEmptyRowsAndColumns(jsonData);
    const headers =
      trimmedData.length > 0 ? (trimmedData[0] as string[]) : [];

    // 构建列配置，用 Symbol 处理重复列名
    const headerNameCount = new Map<string, number>();
    const columns: ColumnConfig[] = [];
    const keyMapping = new Map<number, string | symbol>();

    headers.forEach((headerValue, idx) => {
      const headerName = headerValue || "-";
      const count = headerNameCount.get(headerName) || 0;
      headerNameCount.set(headerName, count + 1);
      const uniqueKey = count > 0 ? Symbol(headerName) : headerName;
      columns.push({ key: uniqueKey, title: headerName });
      keyMapping.set(idx, uniqueKey);
    });

    // 转换为对象数组
    const rows = trimmedData.slice(1).map((row) => {
      const newRow: Record<string | symbol, unknown> = {};
      (row as unknown[]).forEach((cell, idx) => {
        const uniqueKey = keyMapping.get(idx);
        if (uniqueKey) {
          newRow[uniqueKey] = cell;
        }
      });
      return newRow;
    });

    return { name, data: rows, columns };
  });
}

/**
 * 表格内容组件（使用 react-virtuoso TableVirtuoso）
 */
function SheetTable({ sheetData }: { sheetData: SheetData }) {
  const { data, columns } = sheetData;

  const renderCellContent = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  if (!data || data.length === 0) {
    return (
      <div className="wk-file-preview-excel-renderer--empty">
        <span>暂无内容</span>
      </div>
    );
  }

  return (
    <TableVirtuoso
      data={data}
      className="wk-file-preview-excel-renderer__virtual-table"
      fixedHeaderContent={() => (
        <tr>
          {columns.map((col, idx) => (
            <th key={idx} className="wk-file-preview-excel-renderer__th">
              <TooltipCell content={col.title} />
            </th>
          ))}
        </tr>
      )}
      itemContent={(index, row) => (
        <>
          {columns.map((col, idx) => (
            <td key={idx} className="wk-file-preview-excel-renderer__td">
              <TooltipCell content={renderCellContent(row[col.key])} />
            </td>
          ))}
        </>
      )}
    />
  );
}

/**
 * Excel/CSV 渲染器
 * 支持 xlsx, xls, xlsb, xlsm, csv 格式
 * 使用虚拟滚动高效渲染大数据量
 */
const ExcelRenderer: React.FC<ExcelRendererProps> = ({ file, onError }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);

  const loadContent = useCallback(async () => {
    if (!file.url) return;

    setLoading(true);
    setError(null);
    setSheets([]);
    setActiveSheet(0);

    try {
      const XLSX = await loadXlsxLibrary();
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const parsedSheets = parseWorkbook(XLSX, new Uint8Array(buffer));

      if (parsedSheets.length === 0) {
        throw new Error("工作表为空");
      }

      setSheets(parsedSheets);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [file.url, onError]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  if (loading) {
    return (
      <div className="wk-file-preview-excel-renderer wk-file-preview-excel-renderer--loading">
        <div className="wk-file-preview-excel-renderer__spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wk-file-preview-excel-renderer wk-file-preview-excel-renderer--error">
        <span>{error}</span>
        <button
          className="wk-file-preview-excel-renderer__retry"
          onClick={loadContent}
        >
          重试
        </button>
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="wk-file-preview-excel-renderer wk-file-preview-excel-renderer--empty">
        <span>暂无内容</span>
      </div>
    );
  }

  return (
    <div className="wk-file-preview-excel-renderer">
      {/* 表格内容区 */}
      <div className="wk-file-preview-excel-renderer__content">
        <SheetTable sheetData={sheets[activeSheet]} />
      </div>

      {/* 底部信息栏：行数 + 工作表切换 */}
      <div className="wk-file-preview-excel-renderer__footer">
        <span className="wk-file-preview-excel-renderer__row-count">
          共 {sheets[activeSheet]?.data.length ?? 0} 行
        </span>
        {sheets.length > 1 && (
          <div className="wk-file-preview-excel-renderer__tabs">
            {sheets.map((sheet, index) => (
              <button
                key={sheet.name}
                className={`wk-file-preview-excel-renderer__tab ${
                  index === activeSheet
                    ? "wk-file-preview-excel-renderer__tab--active"
                    : ""
                }`}
                onClick={() => setActiveSheet(index)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ExcelRenderer;
export { ExcelRenderer };
