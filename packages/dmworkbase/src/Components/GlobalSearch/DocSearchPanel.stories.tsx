import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import DocSearchPanel from "./DocSearchPanel";
import type {
  DocSearchItem,
  DocSearchResponse,
  GlobalSearchDataSource,
} from "../../Service/SearchTypes";

// Minimal data source: the panel only ever calls searchDocs. Cast through
// unknown so the story doesn't have to stub the whole GlobalSearchDataSource.
function makeDataSource(
  searchDocs: GlobalSearchDataSource["searchDocs"]
): GlobalSearchDataSource {
  return { searchDocs } as unknown as GlobalSearchDataSource;
}

const meta = {
  title: "Base/GlobalSearch/DocSearchPanel",
  component: DocSearchPanel,
  parameters: {
    docs: {
      description: {
        component:
          "云文档搜索面板:每个 doc_type(doc / sheet / board / html)使用 drive-module 彩色图标集,由 docIconSrc 分派。",
      },
    },
  },
  decorators: [
    (Story: React.FC) => (
      <div
        style={{
          width: "min(100%, 720px)",
          height: "480px",
          margin: "0 auto",
          background: "var(--wk-bg-surface)",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DocSearchPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

// 1. 未输入关键词 → 空提示
export const Empty: Story = {
  args: {
    keyword: "",
    isActive: true,
    dataSource: makeDataSource(async () => ({ total: 0, items: [] })),
  },
};

// 2. 四种 doc_type 全覆盖,验证 docIconSrc 的图标分派。
export const IconVariety: Story = {
  args: {
    keyword: "方案",
    isActive: true,
    dataSource: makeDataSource(async () => {
      const kinds: Array<{ docType: DocSearchItem["docType"]; title: string }> =
        [
          { docType: "doc", title: "产品需求文档" },
          { docType: "sheet", title: "排期表" },
          { docType: "board", title: "架构画板" },
          { docType: "html", title: "发布说明页面" },
        ];
      return {
        total: kinds.length,
        items: kinds.map((k, i) => ({
          docId: `d-${i}`,
          title: k.title,
          docType: k.docType,
          updatedAt: Date.UTC(2026, 7, 24 - i),
          highlight: `这是<em>方案</em>相关的 ${k.docType} 内容摘要。`,
        })),
      };
    }),
  },
};
