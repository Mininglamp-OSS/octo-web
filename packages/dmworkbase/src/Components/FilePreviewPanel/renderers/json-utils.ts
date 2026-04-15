/**
 * JSON/JSONL 渲染器共享工具函数和类型
 */

// 视图模式类型
export type ViewMode = "code" | "table";

// 表格列配置
export interface ColumnConfig {
  key: string;
  title: string;
}

/**
 * 安全解析 JSON 字符串
 */
export function safeJsonParse<T>(
  jsonString: string | undefined | null,
  fallback: T
): T {
  if (!jsonString) {
    return fallback;
  }
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.warn("Failed to parse JSON string:", e);
    return fallback;
  }
}

/**
 * 规范化数组数据
 * 确保数组中的每个元素都是对象
 */
export function normalizeArrayData(data: any[]): Record<string, any>[] {
  return data
    .filter((item) => item !== null && item !== undefined)
    .map((item) => {
      if (typeof item === "object" && !Array.isArray(item)) {
        return item;
      }
      // 对于非对象类型，包装成对象
      return { value: item };
    });
}

/**
 * 从嵌套 JSON 结构中提取数组数据
 * 支持常见的 API 响应格式
 */
export function extractArrayFromJson(jsonData: any): Record<string, any>[] {
  if (!jsonData) {
    return [];
  }

  try {
    const data =
      typeof jsonData === "string" ? safeJsonParse(jsonData, []) : jsonData;

    // 如果本身就是数组
    if (Array.isArray(data)) {
      return normalizeArrayData(data);
    }

    // 如果是对象，查找数组类型的属性
    if (data && typeof data === "object") {
      // 常见的数组属性名称
      const commonArrayProps = [
        "data",
        "items",
        "results",
        "list",
        "rows",
        "records",
        "products",
        "entries",
        "content",
      ];

      // 先检查常见的数组属性名
      for (const prop of commonArrayProps) {
        if (data[prop] && Array.isArray(data[prop])) {
          return normalizeArrayData(data[prop]);
        }
      }

      // 查找第一个数组类型的属性
      for (const key in data) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          return normalizeArrayData(data[key]);
        }
      }

      // 如果对象只有一个属性，尝试递归查找
      const keys = Object.keys(data);
      if (keys.length === 1 && typeof data[keys[0]] === "object") {
        return extractArrayFromJson(data[keys[0]]);
      }

      // 如果是单个对象，包装成数组
      if (keys.length > 0) {
        return [data];
      }
    }

    return [];
  } catch (error) {
    console.error("提取JSON数组时出错:", error);
    return [];
  }
}

/**
 * 解析 JSONL 内容
 * 每行是一个独立的 JSON 对象
 */
export function parseJsonl(content: string): Record<string, any>[] {
  if (!content) return [];

  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  const results: Record<string, any>[] = [];

  for (const line of lines) {
    const parsed = safeJsonParse(line.trim(), null);
    if (parsed !== null) {
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        results.push(parsed);
      } else {
        // 非对象类型包装成对象
        results.push({ value: parsed });
      }
    }
  }

  return results;
}

/**
 * 格式化 JSONL 内容用于代码视图
 * 每行 JSON 单独格式化
 */
export function formatJsonl(content: string): string {
  if (!content) return "";

  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  const formatted: string[] = [];

  for (const line of lines) {
    const parsed = safeJsonParse(line.trim(), null);
    if (parsed !== null) {
      try {
        formatted.push(JSON.stringify(parsed, null, 2));
      } catch {
        formatted.push(line.trim());
      }
    } else {
      formatted.push(line.trim());
    }
  }

  return formatted.join("\n\n// ---\n\n");
}

/**
 * 渲染单元格内容
 */
export function renderCellContent(value: any): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * 从数据行中提取列配置
 */
export function extractColumns(data: Record<string, any>[]): ColumnConfig[] {
  if (data.length === 0) return [];

  const allKeys = new Set<string>();
  data.forEach((row) => {
    if (typeof row === "object" && row !== null) {
      Object.keys(row).forEach((key) => allKeys.add(key));
    }
  });

  return Array.from(allKeys).map((key) => ({ key, title: key }));
}

/**
 * 统计 JSONL 行数
 */
export function countJsonlLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).filter((line) => line.trim() !== "").length;
}
