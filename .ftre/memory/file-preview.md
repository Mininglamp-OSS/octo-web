# FilePreviewPanel 文件预览面板

> 基于策略模式的文件预览组件，支持多种文件类型的渲染，可扩展注册新渲染器

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/dmworkbase/src/Components/FilePreviewPanel/index.tsx` | 主面板容器（header + 内容区） |
| `packages/dmworkbase/src/Components/FilePreviewPanel/registry.ts` | 渲染器注册表（策略模式核心） |
| `packages/dmworkbase/src/Components/FilePreviewPanel/types.ts` | 类型定义：FilePreviewInfo, BaseRendererProps, FileType |
| `packages/dmworkbase/src/Components/FilePreviewPanel/config.ts` | 集中配置：文件大小阈值、渲染模式等 |
| `packages/dmworkbase/src/Components/FilePreviewPanel/hooks/useFileContent.ts` | 文件内容加载 Hook |
| `packages/dmworkbase/src/Components/FilePreviewPanel/renderers/index.ts` | 渲染器统一导出 |
| `packages/dmworkbase/src/Components/FilePreviewPanel/renderers/CodeRenderer.tsx` | 通用代码渲染器，支持 30+ 语言 |
| `packages/dmworkbase/src/Components/FilePreviewPanel/renderers/code-highlight.css` | 代码类渲染器共享的语法高亮样式 |

## 业务流程

### 渲染器选择链路
```
index.tsx:FilePreviewPanel 
  → getExtension() 提取扩展名
  → registry.ts:FileRendererRegistry.getRenderer(ext) 查找渲染器
  → 匹配 renderers/ 下的对应渲染器组件
```

### 渲染器注册（初始化时）
```
registry.ts:registerDefaults() 
  → 各渲染器静态注册到 Map<扩展名, RendererRegistryItem>
```

## 渲染器清单

| 渲染器 | 扩展名 | 依赖 | 视图类型 |
|--------|--------|------|----------|
| ImageRenderer | png, jpg, jpeg, gif, bmp, webp, svg | 无 | 图片展示 |
| PdfRenderer | pdf | @react-pdf-viewer/* | PDF 阅读器 |
| MarkdownRenderer | md, markdown | MarkdownContent | Markdown 渲染 |
| CodeRenderer | js, ts, py, java 等 30+ | react-syntax-highlighter | 代码高亮 |
| JsonRenderer | json | react-syntax-highlighter | 代码高亮（仅代码视图） |
| JsonlRenderer | jsonl | react-syntax-highlighter, react-virtuoso | 代码/表格双视图 |
| TextRenderer | txt, log, ini | 无 | 纯文本 |
| HtmlRenderer | html, htm | iframe | HTML 渲染 |
| ExcelRenderer | xlsx, xls, csv | xlsx, react-virtuoso | 表格视图（多 sheet） |
| FallbackRenderer | 其他 | lucide-react | 不支持提示 |

### 代码类渲染器对比

| 渲染器 | 代码视图 | 表格视图 | 说明 |
|--------|----------|----------|------|
| CodeRenderer | ✅ 语法高亮/纯文本 | ❌ | 通用代码文件 |
| JsonRenderer | ✅ 语法高亮/纯文本 | ❌ | JSON 专用，仅代码视图 |
| JsonlRenderer | ✅ 语法高亮/纯文本 | ✅ 虚拟滚动 | JSON Lines，支持双视图 |

## 共享代码高亮样式

代码类渲染器（CodeRenderer, JsonRenderer, JsonlRenderer）共用统一的语法高亮样式：

| 文件 | 职责 |
|------|------|
| `renderers/code-highlight.css` | 共享语法高亮样式，基于 CSS Token 变量 |
| `renderers/CodeRenderer.tsx` | 导入 code-highlight.css |
| `renderers/JsonRenderer.tsx` | 导入 code-highlight.css |
| `renderers/JsonlRenderer.tsx` | 导入 code-highlight.css |

### 使用方式

```tsx
import SyntaxHighlighter from "react-syntax-highlighter";
import "./code-highlight.css";

<SyntaxHighlighter
  language="json"
  useInlineStyles={false}  // 必须禁用内联样式
  showLineNumbers
  className="wk-code-highlight-container"
>
  {code}
</SyntaxHighlighter>
```

## 大文件处理策略

> 代码类渲染器（CodeRenderer, JsonRenderer, JsonlRenderer）采用三阶段降级策略

| 阶段 | 文件大小 | 处理方式 | 适用渲染器 |
|------|----------|----------|------------|
| 1 | < 30KB | 完全渲染（SyntaxHighlighter 语法高亮） | CodeRenderer, JsonRenderer, JsonlRenderer |
| 2 | 30KB ~ 100KB | 纯文本渲染（无语法高亮） | CodeRenderer, JsonRenderer, JsonlRenderer |
| 3 | > 100KB | 不渲染，显示「文件太大，可下载」提示 | CodeRenderer, JsonRenderer, JsonlRenderer |

### 配置项

```ts
// config.ts 集中配置
export const FILE_SIZE_THRESHOLD = {
  HIGHLIGHT: 30 * 1024,    // 30KB - 语法高亮阈值
  PLAIN_TEXT: 100 * 1024,  // 100KB - 纯文本渲染阈值
} as const;

export function getRenderMode(contentSize: number): 'highlight' | 'plain' | 'skip';
export function formatFileSize(bytes: number): string;
```

- 文件大小从 `FilePreviewInfo.size` 获取
- 阶段 3 时 `useFileContent` 不会发起 fetch 请求

## 虚拟表格渲染器架构（ExcelRenderer, JsonlRenderer）

使用 `react-virtuoso` + `TooltipCell` 架构：

### 专属文件
| 文件 | 职责 |
|------|------|
| `renderers/ExcelRenderer.tsx` | Excel/CSV 解析、工作表切换、TableVirtuoso 渲染 |
| `renderers/ExcelRenderer.css` | 表格样式 |
| `renderers/JsonlRenderer.tsx` | JSONL 解析、表格/代码双视图切换、TableVirtuoso 渲染 |
| `renderers/JsonlRenderer.css` | 表格、代码视图样式 |
| `renderers/TooltipCell.tsx` | 带 tooltip 的单元格，处理内容溢出 |
| `renderers/json-utils.ts` | 工具函数：safeJsonParse, extractArrayFromJson, extractColumns, normalizeArrayData 等 |

### TableVirtuoso 组件结构
```tsx
<TableVirtuoso
  data={data}
  fixedHeaderContent={() => <tr>{/* 表头 */}</tr>}
  itemContent={(index, row) => <>{/* 单元格 */}</>}
/>
```

### Excel 数据流
```
file.url
  → fetch → ArrayBuffer
  → XLSX.read(new Uint8Array(buffer), { type: "array" })  // 统一处理 xlsx/csv
  → parseWorkbook() → SheetData[] { name, data, columns }
  → TableVirtuoso 虚拟滚动渲染当前 activeSheet
```

### JSONL 数据流
```
file.url
  → useFileContent() → content
  → parseJsonl() → rows[]
  → extractColumns() → columns[]
  → 表格视图：TableVirtuoso 虚拟滚动
  → 代码视图：formatJsonl() → 三阶段降级渲染
```

### JSONL 视图模式
- **表格视图**：TableVirtuoso 虚拟滚动表格（自动识别结构化数据）
- **代码视图**：三阶段降级处理（语法高亮 → 纯文本 → 不渲染）

### 表格视图启用条件（JsonlRenderer）

```tsx
// 判断是否可以显示表格视图
// 如果只有一个 "value" 列，说明是简单类型数组，不适合表格展示
const canShowTable =
  tableData.length > 0 &&
  columns.length > 0 &&
  !(columns.length === 1 && columns[0].key === "value");
```

- 数据非空且有列定义
- **例外**：如果只有一列且列名为 `value`，说明是简单类型数组（如 `["a", "b", "c"]` 被 `normalizeArrayData` 转换成 `[{value: "a"}, {value: "b"}, ...]`），不适合表格展示，降级为代码视图

## 设计决策

- **策略模式**：每种文件类型独立渲染器，避免条件堆砌，便于维护和扩展
- **集中配置**：文件大小阈值、分页配置统一放在 `config.ts`，高度可配置化
- **needsFetch 区分**：部分渲染器（图片、PDF）直接用 url，其他需先 fetch 内容
- **动态导入 Excel 库**：xlsx 库体积大，采用动态导入避免首屏加载
- **react-virtuoso 虚拟滚动**：TableVirtuoso 提供成熟的表格虚拟滚动方案，比自研方案稳定可靠
- **自研 VirtualList 方案失败原因**：曾尝试使用自研 VirtualList 方案，但因 CSS flex 高度链问题导致容器的 `clientHeight` 等于内容总高度（而非视口高度），虚拟滚动无法计算视口内元素数量，最终放弃该方案
- **条件渲染当前工作表**：多 sheet 时不使用 `display: none` 隐藏非活跃表，而是只渲染当前 active 的 SheetTable
- **XLSX.read 统一解析**：xlsx 和 csv 都用 `XLSX.read(arrayBuffer, { type: "array" })` 处理
- **TooltipCell 处理溢出**：表格单元格内容溢出时使用 TooltipCell 显示省略号，hover 展示完整内容
- **大文件三阶段降级**：代码类文件按大小分级处理，避免大文件导致浏览器卡死
- **共享代码高亮样式**：CodeRenderer/JsonRenderer/JsonlRenderer 共用 `code-highlight.css`，避免样式重复和显示不一致
- **JsonRenderer 仅代码视图**：JSON 文件结构多样（配置对象、嵌套对象、简单数组等），表格展示体验不佳，因此 JsonRenderer 仅保留代码视图；结构化行数据请使用 JsonlRenderer
- **简单类型数组降级为代码视图**：如果 `normalizeArrayData` 后只有一列 `value`，说明原始数据是简单类型数组（字符串数组等），自动禁用表格视图，提供更好的用户体验

## 注意事项

- 扩展名匹配不区分大小写，registry 内部统一转小写处理
- 暗色模式检测通过 `document.body.getAttribute("theme-mode")` 实现
- PDF 渲染依赖 @react-pdf-viewer 系列包，功能完整（缩略图、缩放、翻页）
- xlsx 解析配置：`raw: true` 返回原始数据
- 重复列名处理：使用 Symbol 生成唯一 key
- **CSS 高度链**：父容器 `.wk-file-preview-content > *` 设置 `flex: 1; min-height: 0` 确保子组件能被正确约束高度
- **TableVirtuoso 高度问题**：组件在 `display: none` 容器中无法计算自身尺寸，切换工作表时必须用条件渲染而非 CSS 隐藏
- **单元格溢出**：td/th 设置 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`，配合 TooltipCell 实现 hover 显示完整内容
- **配色规范**：Dark mode 样式禁止使用硬编码颜色，必须使用 CSS Token 变量
- **SyntaxHighlighter 样式**：设置 `useInlineStyles={false}` 并完全依赖 CSS 类定义样式，避免内联样式与 CSS Token 冲突
- **新增代码类渲染器**：如新增需要语法高亮的渲染器，应导入 `code-highlight.css` 而非自建样式
- **JSONL 数组提取的隐含转换**：`normalizeArrayData` 会将非对象元素包装成 `{ value: item }`，这会导致简单类型数组（如字符串数组）在表格中只显示一列 `value`，因此 `canShowTable` 需要额外判断这种情况
- **CSS Token 不可用变量**：`--wk-text-on-brand` 不存在，若用于背景色会导致紫色背景+黑色字体的显示异常；按钮激活状态应使用 `--wk-text-inverse`

### 调试 checklist（当虚拟滚动出现问题时）

1. **检查嵌套滚动容器**
   - 外层容器是否设置了 `overflow: auto/scroll`
   - TableVirtuoso 自身是滚动容器，避免双层滚动

2. **检查高度链**
   - 所有 flex 父容器是否有 `min-height: 0`
   - ResizeObserver 检测的 `clientHeight` 是否等于内容总高度（说明高度链失效）

3. **检查 display:none 影响**
   - 非活跃工作表是否用了 `display: none` 隐藏
   - 改为条件渲染：`<SheetTable key={sheets[activeSheet].name} />`
