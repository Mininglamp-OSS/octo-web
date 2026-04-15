import type { Meta, StoryObj } from "@storybook/react-vite";
import React, { useState } from "react";
import FilePreviewPanel from "./index";
import { FilePreviewInfo } from "./types";
import "../../theme/index.css";

// 支持 Unicode 的 base64 编码函数
function btoaUnicode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

const meta: Meta<typeof FilePreviewPanel> = {
  title: "Components/FilePreviewPanel",
  component: FilePreviewPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `
文件预览面板组件，基于策略模式实现。

## 特性
- **单一职责**：每种文件类型对应一个独立的渲染器
- **开闭原则**：新增文件类型时，只需添加新的渲染器
- **可扩展性**：支持自定义渲染器注册

## 支持的文件类型
| 类型 | 扩展名 |
|------|--------|
| 图片 | png, jpg, jpeg, gif, bmp, webp, svg |
| PDF | pdf |
| Markdown | md, markdown |
| 代码 | js, ts, py, java, go, rs, json, css, html, xml, yaml, sql 等 |
| 纯文本 | txt, log, ini, conf, cfg |
| Excel/CSV | xlsx, xls, csv |

## 扩展渲染器
\`\`\`tsx
import { fileRendererRegistry } from '@octo/base';
import MyCustomRenderer from './MyCustomRenderer';

fileRendererRegistry.register({
  type: 'custom',
  extensions: ['custom'],
  renderer: MyCustomRenderer,
  needsFetch: true,
});
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          height: "100vh",
          display: "flex",
          background: "var(--wk-bg-base)",
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "20px",
            background: "var(--wk-bg-surface)",
          }}
        >
          <div style={{ color: "var(--wk-text-secondary)" }}>主内容区域</div>
        </div>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FilePreviewPanel>;

// 模拟文件数据
const mockFiles: Record<string, FilePreviewInfo> = {
  image: {
    url: "https://picsum.photos/800/600",
    name: "example-image.png",
    extension: "png",
    size: 1024000,
  },
  pdf: {
    url: "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf",
    name: "document.pdf",
    extension: "pdf",
    size: 2048000,
  },
  markdown: {
    url:
      "data:text/plain;base64," +
      btoaUnicode(`# Hello Markdown

This is a **Markdown** file preview demo.

## Features

- List item 1
- List item 2
- List item 3

## Code Example

\`\`\`javascript
const hello = "world";
console.log(hello);
\`\`\`

> This is a blockquote.

[Link example](https://example.com)
`),
    name: "README.md",
    extension: "md",
    size: 512,
  },
  code: {
    url:
      "data:text/plain;base64," +
      btoaUnicode(`import React, { useState, useEffect } from 'react';

interface Props {
  name: string;
  age?: number;
}

const MyComponent: React.FC<Props> = ({ name, age = 18 }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    console.log('Component mounted');
    return () => {
      console.log('Component unmounted');
    };
  }, []);

  return (
    <div className="my-component">
      <h1>Hello, {name}!</h1>
      <p>Age: {age}</p>
      <button onClick={() => setCount(c => c + 1)}>
        Count: {count}
      </button>
    </div>
  );
};

export default MyComponent;
`),
    name: "MyComponent.tsx",
    extension: "tsx",
    size: 1024,
  },
  text: {
    url:
      "data:text/plain;base64," +
      btoaUnicode(`This is a plain text file.

It contains multiple lines of text.

Line 1
Line 2
Line 3

End of file.
`),
    name: "notes.txt",
    extension: "txt",
    size: 256,
  },
  json: {
    url:
      "data:text/plain;base64," +
      btoaUnicode(`{
  "name": "FilePreviewPanel",
  "version": "1.0.0",
  "description": "A file preview panel component",
  "features": [
    "Image preview",
    "PDF preview",
    "Markdown preview",
    "Code preview",
    "Text preview"
  ],
  "author": {
    "name": "DMWork Team",
    "email": "team@example.com"
  }
}
`),
    name: "package.json",
    extension: "json",
    size: 512,
  },
  jsonArray: {
    url:
      "data:text/plain;base64," +
      btoaUnicode(`{
  "total": 5,
  "page": 1,
  "data": [
    { "id": 1, "name": "张三", "age": 28, "city": "北京", "role": "工程师", "salary": 25000 },
    { "id": 2, "name": "李四", "age": 35, "city": "上海", "role": "设计师", "salary": 22000 },
    { "id": 3, "name": "王五", "age": 42, "city": "广州", "role": "产品经理", "salary": 30000 },
    { "id": 4, "name": "赵六", "age": 31, "city": "深圳", "role": "前端开发", "salary": 28000 },
    { "id": 5, "name": "孙七", "age": 26, "city": "杭州", "role": "后端开发", "salary": 26000 }
  ]
}
`),
    name: "employees.json",
    extension: "json",
    size: 1024,
  },
  jsonLargeArray: {
    url:
      "data:text/plain;base64," +
      btoaUnicode(
        JSON.stringify(
          {
            results: Array.from({ length: 150 }, (_, i) => ({
              id: i + 1,
              product: `商品${i + 1}`,
              price: Math.floor(Math.random() * 1000) + 100,
              stock: Math.floor(Math.random() * 500),
              category: ["电子", "服装", "食品", "家居", "图书"][
                Math.floor(Math.random() * 5)
              ],
              status: Math.random() > 0.3 ? "在售" : "下架",
            })),
          },
          null,
          2
        )
      ),
    name: "products.json",
    extension: "json",
    size: 8192,
  },
  jsonl: {
    url:
      "data:text/plain;base64," +
      btoaUnicode(`{"id": 1, "event": "page_view", "page": "/home", "timestamp": "2024-01-15T10:23:45Z", "user_id": "u_001"}
{"id": 2, "event": "click", "element": "buy_button", "timestamp": "2024-01-15T10:24:12Z", "user_id": "u_001"}
{"id": 3, "event": "page_view", "page": "/product/123", "timestamp": "2024-01-15T10:24:15Z", "user_id": "u_002"}
{"id": 4, "event": "add_to_cart", "product_id": "p_123", "timestamp": "2024-01-15T10:25:01Z", "user_id": "u_001"}
{"id": 5, "event": "checkout", "total": 299.99, "timestamp": "2024-01-15T10:26:30Z", "user_id": "u_001"}`),
    name: "events.jsonl",
    extension: "jsonl",
    size: 512,
  },
  jsonlLarge: {
    url:
      "data:text/plain;base64," +
      btoaUnicode(
        Array.from({ length: 200 }, (_, i) =>
          JSON.stringify({
            id: i + 1,
            timestamp: new Date(
              Date.now() - Math.random() * 86400000
            ).toISOString(),
            level: ["INFO", "WARN", "ERROR", "DEBUG"][
              Math.floor(Math.random() * 4)
            ],
            service: ["api", "worker", "scheduler", "gateway"][
              Math.floor(Math.random() * 4)
            ],
            message: `Log message #${i + 1}`,
            duration_ms: Math.floor(Math.random() * 1000),
          })
        ).join("\n")
      ),
    name: "application.jsonl",
    extension: "jsonl",
    size: 16384,
  },
  unknown: {
    url: "https://example.com/file.xyz",
    name: "unknown-file.xyz",
    extension: "xyz",
    size: 4096,
  },
  csv: {
    // 100行测试数据，包含短/中/长备注测试tooltip（本地文件）
    url: "/samples/employees.csv",
    name: "员工名单.csv",
    extension: "csv",
    size: 2754,
  },
  excel: {
    // 真实xlsx文件，包含两个工作表
    url: "/samples/report.xlsx",
    name: "数据报表.xlsx",
    extension: "xlsx",
    size: 4500,
  },
  html: {
    url:
      "data:text/html;base64," +
      btoaUnicode(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HTML 预览示例</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { color: #7C5CFC; }
    .card {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }
    button {
      background: #7C5CFC;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <h1>HTML 预览示例</h1>
  <p>这是一个 HTML 文件预览的示例页面。</p>

  <div class="card">
    <h3>功能特性</h3>
    <ul>
      <li>支持完整的 HTML 渲染</li>
      <li>支持 CSS 样式</li>
      <li>支持 JavaScript 交互</li>
    </ul>
  </div>

  <button onclick="alert('Hello from HTML!')">点击测试</button>
</body>
</html>`),
    name: "example.html",
    extension: "html",
    size: 1024,
  },
};

// 交互式 Story
const InteractiveTemplate = () => {
  const [selectedFile, setSelectedFile] = useState<FilePreviewInfo | null>(
    mockFiles.image
  );
  const [isOpen, setIsOpen] = useState(true);

  const fileTypes = Object.keys(mockFiles);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%" }}>
      <div
        style={{ flex: 1, padding: "20px", background: "var(--wk-bg-surface)" }}
      >
        <h3 style={{ color: "var(--wk-text-primary)", marginBottom: "16px" }}>
          选择文件类型
        </h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {fileTypes.map((type) => (
            <button
              key={type}
              onClick={() => {
                setSelectedFile(mockFiles[type]);
                setIsOpen(true);
              }}
              style={{
                padding: "8px 16px",
                background:
                  selectedFile === mockFiles[type]
                    ? "var(--wk-brand-primary)"
                    : "var(--wk-bg-base)",
                color:
                  selectedFile === mockFiles[type]
                    ? "var(--wk-text-inverse)"
                    : "var(--wk-text-primary)",
                border: "1px solid var(--wk-border-default)",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {type}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "20px", color: "var(--wk-text-secondary)" }}>
          {selectedFile && (
            <div>
              <p>文件名: {selectedFile.name}</p>
              <p>扩展名: {selectedFile.extension}</p>
              <p>大小: {selectedFile.size} bytes</p>
            </div>
          )}
        </div>
      </div>
      {isOpen && (
        <FilePreviewPanel
          file={selectedFile}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveTemplate />,
  parameters: {
    docs: {
      description: {
        story: "交互式演示，可以切换不同的文件类型查看预览效果。",
      },
    },
  },
};

// 图片预览
export const ImagePreview: Story = {
  args: {
    file: mockFiles.image,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "图片文件预览，支持 png, jpg, jpeg, gif, bmp, webp, svg 格式。",
      },
    },
  },
};

// PDF 预览
export const PdfPreview: Story = {
  args: {
    file: mockFiles.pdf,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "PDF 文件预览，使用浏览器原生 PDF 查看器。",
      },
    },
  },
};

// Markdown 预览
export const MarkdownPreview: Story = {
  args: {
    file: mockFiles.markdown,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "Markdown 文件预览，支持标题、列表、代码块、引用等格式。",
      },
    },
  },
};

// 代码预览
export const CodePreview: Story = {
  args: {
    file: mockFiles.code,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "代码文件预览，支持 js, ts, py, java, go 等多种语言。",
      },
    },
  },
};

// JSON 预览 - 支持嵌套对象和数组数据的表格视图
export const JsonPreview: Story = {
  args: {
    file: mockFiles.jsonArray,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "JSON 文件预览，支持代码视图和表格视图切换。嵌套 JSON 中的数组会被智能提取并以表格展示。",
      },
    },
  },
};

// JSON 预览 - 大数据量（分页）
export const JsonLargeArrayPreview: Story = {
  args: {
    file: mockFiles.jsonLargeArray,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "大数据量 JSON 预览，表格视图支持分页功能（每页 100 条）。",
      },
    },
  },
};

// JSONL 预览 - 事件日志
export const JsonlPreview: Story = {
  args: {
    file: mockFiles.jsonl,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "JSONL 文件预览，每行是一个独立的 JSON 对象。默认表格视图，可切换到代码视图。",
      },
    },
  },
};

// JSONL 预览 - 大数据量（分页）
export const JsonlLargePreview: Story = {
  args: {
    file: mockFiles.jsonlLarge,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "大数据量 JSONL 预览（200+ 行），表格视图支持分页功能。",
      },
    },
  },
};

// 纯文本预览
export const TextPreview: Story = {
  args: {
    file: mockFiles.text,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "纯文本文件预览，支持 txt, log, ini, conf 等格式。",
      },
    },
  },
};

// HTML 预览
export const HtmlPreview: Story = {
  args: {
    file: mockFiles.html,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "HTML 文件预览，使用 iframe 渲染完整的 HTML 页面。",
      },
    },
  },
};

// 不支持的文件类型
export const UnsupportedType: Story = {
  args: {
    file: mockFiles.unknown,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "不支持预览的文件类型，显示下载提示。",
      },
    },
  },
};

// 无文件（null）
export const NoFile: Story = {
  args: {
    file: null,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "文件为 null 时不渲染任何内容。",
      },
    },
  },
};

// Excel/CSV 预览
export const ExcelPreview: Story = {
  args: {
    file: mockFiles.csv,
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "CSV/Excel 文件预览，虚拟滚动、空行裁剪、重复列名处理、多工作表切换（xlsx/xls/csv）。",
      },
    },
  },
};


// 长文件名
export const LongFileName: Story = {
  args: {
    file: {
      url: "https://picsum.photos/800/600",
      name: "this-is-a-very-long-file-name-that-should-be-truncated-with-ellipsis-when-displayed-in-the-header.png",
      extension: "png",
      size: 1024000,
    },
    onClose: () => console.log("Close clicked"),
  },
  parameters: {
    docs: {
      description: {
        story: "长文件名会被截断并显示省略号。",
      },
    },
  },
};

// ============================================================
// 大文件处理测试
// ============================================================

// 生成指定大小的 Blob URL
function createBlobUrl(targetSizeKB: number): string {
  const line = '// This is a line of code that repeats to create large file content for testing purposes.\n';
  const lineSize = new Blob([line]).size;
  const targetSize = targetSizeKB * 1024;
  const repeatCount = Math.ceil(targetSize / lineSize);
  const content = Array(repeatCount).fill(line).join('');
  const blob = new Blob([content], { type: 'text/plain' });
  return URL.createObjectURL(blob);
}

// 小文件 - 语法高亮渲染 (< 30KB)
const SmallFileTemplate = () => {
  const [url, setUrl] = React.useState<string | null>(null);
  
  React.useEffect(() => {
    const blobUrl = createBlobUrl(10);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, []);

  if (!url) return null;
  
  return (
    <FilePreviewPanel
      file={{
        url,
        name: "small-file.ts",
        extension: "ts",
        size: 10 * 1024,
      }}
      onClose={() => console.log("Close clicked")}
    />
  );
};

export const CodeSmallFile: Story = {
  render: () => <SmallFileTemplate />,
  parameters: {
    docs: {
      description: {
        story: "小文件（10KB）- 使用语法高亮渲染。阈值：< 30KB。",
      },
    },
  },
};

// 中等文件 - 纯文本渲染 (30KB ~ 100KB)
const MediumFileTemplate = () => {
  const [url, setUrl] = React.useState<string | null>(null);
  
  React.useEffect(() => {
    const blobUrl = createBlobUrl(50);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, []);

  if (!url) return null;
  
  return (
    <FilePreviewPanel
      file={{
        url,
        name: "medium-file.ts",
        extension: "ts",
        size: 50 * 1024,
      }}
      onClose={() => console.log("Close clicked")}
    />
  );
};

export const CodeMediumFile: Story = {
  render: () => <MediumFileTemplate />,
  parameters: {
    docs: {
      description: {
        story: "中等文件（50KB）- 禁用语法高亮，纯文本渲染。阈值：30KB ~ 100KB。",
      },
    },
  },
};

// 大文件 - 不渲染，提示下载 (> 100KB)
const LargeFileTemplate = () => {
  const [url, setUrl] = React.useState<string | null>(null);
  
  React.useEffect(() => {
    const blobUrl = createBlobUrl(150);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, []);

  if (!url) return null;
  
  return (
    <FilePreviewPanel
      file={{
        url,
        name: "large-file.ts",
        extension: "ts",
        size: 150 * 1024,
      }}
      onClose={() => console.log("Close clicked")}
    />
  );
};

export const CodeLargeFile: Story = {
  render: () => <LargeFileTemplate />,
  parameters: {
    docs: {
      description: {
        story: "大文件（150KB）- 不渲染，显示「文件太大，可下载」提示。阈值：> 100KB。",
      },
    },
  },
};
