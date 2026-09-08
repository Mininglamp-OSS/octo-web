import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, waitFor } from "@storybook/test";
import DriveSearchPanel from "./DriveSearchPanel";
import type {
  DriveSearchHit,
  DriveSearchResponse,
  GlobalSearchDataSource,
} from "../../Service/SearchTypes";

// Build `count` drive hits with unique ids (offset keeps ids distinct across
// pages). Rotates through the three renderable types so the icon variants show.
function makeHits(count: number, offset = 0): DriveSearchHit[] {
  const types: DriveSearchHit["type"][] = ["folder", "doc", "blob"];
  return Array.from({ length: count }, (_, i) => {
    const n = offset + i;
    const type = types[n % types.length];
    return {
      file_id: 1000 + n,
      space_id: "space-1",
      space_name: "产研共享",
      parent_id: 0,
      path: ["设计稿", "2026"],
      name: `需求评审纪要-${n}.${type === "folder" ? "" : "md"}`.replace(
        /\.$/,
        ""
      ),
      type,
      ext: type === "folder" ? undefined : "md",
      size: type === "folder" ? undefined : 24_576 + n * 1024,
      owner_uid: "u-alex",
      owner_name: "Alex Chen",
      updater_uid: "u-alex",
      updater_name: "Alex Chen",
      created_at: "2026-08-20T10:00:00.000Z",
      updated_at: "2026-08-24T09:30:00.000Z",
    };
  });
}

// Minimal data source: the panel only ever calls searchDrive. Cast through
// unknown so the story doesn't have to stub the whole GlobalSearchDataSource.
function makeDataSource(
  searchDrive: GlobalSearchDataSource["searchDrive"]
): GlobalSearchDataSource {
  return { searchDrive } as unknown as GlobalSearchDataSource;
}

const meta = {
  title: "Base/GlobalSearch/DriveSearchPanel",
  component: DriveSearchPanel,
  parameters: {
    docs: {
      description: {
        component:
          "网盘搜索面板:offset(page_index) 滚动加载 + 世代保护 + AbortController,全态覆盖(empty / loading / hits / highlight / loadingMore / hasNoMore / truncated)。",
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
} satisfies Meta<typeof DriveSearchPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

// 1. 未输入关键词 → 空提示
export const Empty: Story = {
  args: {
    keyword: "",
    isActive: true,
    dataSource: makeDataSource(async () => ({
      total: 0,
      truncated: false,
      items: [],
    })),
  },
};

// 2. 首页加载中(请求永不 resolve)
export const Loading: Story = {
  args: {
    keyword: "评审",
    isActive: true,
    dataSource: makeDataSource(
      () => new Promise<DriveSearchResponse>(() => undefined)
    ),
  },
};

// 3. 命中列表(还有下一页,不显示底部提示)
export const Hits: Story = {
  args: {
    keyword: "评审",
    isActive: true,
    dataSource: makeDataSource(async () => ({
      total: 40,
      truncated: false,
      items: makeHits(6),
    })),
  },
};

// 4. 命中 + name/body 高亮(<mark>)
export const HitsWithHighlight: Story = {
  args: {
    keyword: "评审",
    isActive: true,
    dataSource: makeDataSource(async () => ({
      total: 40,
      truncated: false,
      items: makeHits(4).map((hit, i) => ({
        ...hit,
        highlights: {
          name: [`需求<mark>评审</mark>纪要-${i}`],
          body: [`本次<mark>评审</mark>通过了排期,请各位在周五前确认。`],
        },
      })),
    })),
  },
};

// 5. 追加下一页加载中:首页返回满页(total>已加载),滚动触发 loadNextPage,
//    第二页请求挂起 → 底部 spinner「加载中…」。
export const LoadingMore: Story = {
  args: {
    keyword: "评审",
    isActive: true,
    dataSource: makeDataSource(async (query) => {
      if (query.page_index === 0) {
        return { total: 40, truncated: false, items: makeHits(20, 0) };
      }
      // 第二页永不 resolve,停在 loadingMore 态
      return new Promise<DriveSearchResponse>(() => undefined);
    }),
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const list = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(
        ".wk-drive-search__list"
      );
      if (!el || !el.querySelector(".wk-drive-search__item")) {
        throw new Error("first page not rendered yet");
      }
      return el;
    });
    list.scrollTop = list.scrollHeight;
    fireEvent.scroll(list);
    await waitFor(() => {
      if (!canvasElement.querySelector(".wk-drive-search__footer")) {
        throw new Error("loadingMore footer not shown yet");
      }
    });
  },
};

// 6. 已加载全部(total===已加载)→ 底部「已显示全部 N 条」
export const HasNoMore: Story = {
  args: {
    keyword: "评审",
    isActive: true,
    dataSource: makeDataSource(async () => ({
      total: 6,
      truncated: false,
      items: makeHits(6),
    })),
  },
};

// 7. 结果不完整(truncated=true)→ 底部软提示,不阻塞翻页
export const Truncated: Story = {
  args: {
    keyword: "评审",
    isActive: true,
    dataSource: makeDataSource(async () => ({
      total: 8,
      truncated: true,
      items: makeHits(8),
    })),
  },
};

// 8. 图标全覆盖:folder / 在线文档(doc) + 各扩展名的 blob,验证 driveIconSrc
//    的按扩展名分派命中了 drive-module 彩色图标集(而非旧的 lucide 线框图标)。
export const IconVariety: Story = {
  args: {
    keyword: "文件",
    isActive: true,
    dataSource: makeDataSource(async () => {
      const base = makeHits(1)[0];
      // folder + doc 走类型分派;其余按扩展名走 fileIconSrc。
      const specs: Array<{ type: DriveSearchHit["type"]; name: string }> = [
        { type: "folder", name: "设计稿" },
        { type: "doc", name: "需求说明" },
        { type: "blob", name: "季度报告.pdf" },
        { type: "blob", name: "预算表.xlsx" },
        { type: "blob", name: "汇报.pptx" },
        { type: "blob", name: "导出数据.csv" },
        { type: "blob", name: "归档.zip" },
        { type: "blob", name: "宣传片.mp4" },
        { type: "blob", name: "录音.mp3" },
        { type: "blob", name: "动图.gif" },
        { type: "blob", name: "截图.png" },
        { type: "blob", name: "页面.html" },
        { type: "blob", name: "README.md" },
        { type: "blob", name: "笔记.txt" },
        { type: "blob", name: "index.ts" },
        { type: "blob", name: "未知类型.xyz" },
      ];
      return {
        total: specs.length,
        truncated: false,
        items: specs.map((s, i) => ({
          ...base,
          file_id: 2000 + i,
          name: s.name,
          type: s.type,
          ext: s.type === "folder" ? undefined : s.name.split(".").pop(),
          size: s.type === "folder" ? undefined : 12_288 + i * 2048,
        })),
      };
    }),
  },
};
