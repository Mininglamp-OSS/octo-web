import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../Service/APIClient", () => ({
  default: {
    shared: {
      get: vi.fn(),
    },
  },
}));

// preview.ts 读 WKApp.loginInfo.uid 做缓存账号隔离。这里 mock 掉 App，
// 既切断把整个 App 渲染依赖树（react-virtuoso 等）拖进纯逻辑测试的 ESM 解析崩溃，
// 又让下面能改 currentUid 模拟换号登录。
let currentUid = "u_self";
vi.mock("../../../App", () => ({
  default: {
    get loginInfo() {
      return { uid: currentUid };
    },
  },
}));

import APIClient from "../../../Service/APIClient";
import { fetchDocPreview, resetDocPreviewCache } from "../preview";

const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiGet.mockReset();
  currentUid = "u_self";
  resetDocPreviewCache();
});

describe("fetchDocPreview — kind → endpoint mapping (blocker #2 regression)", () => {
  // 回归：BoardShell/SheetView 曾漏传 kind，board/sheet 全打到 /content 端点导致预览必失败。
  // 这里锁死每种 kind 打对端点。
  it.each([
    ["doc", "content"],
    ["board", "scene"],
    ["sheet", "sheet"],
  ] as const)("kind=%s → GET docs/:id/%s", async (kind, endpoint) => {
    apiGet.mockResolvedValueOnce({});
    await fetchDocPreview(kind, "d_1", "sp_1");
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet.mock.calls[0][0]).toBe(`docs/d_1/${endpoint}`);
  });

  it("carries the doc's own space via explicit X-Space-Id header (cross-space preview)", async () => {
    apiGet.mockResolvedValueOnce({});
    await fetchDocPreview("doc", "d_1", "sp_other");
    const cfg = apiGet.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(cfg.headers?.["X-Space-Id"]).toBe("sp_other");
  });
});

describe("fetchDocPreview — ACL-safe status mapping (blocker #3 / ACL design)", () => {
  it("403 → denied (viewer lacks access; no preview leaked)", async () => {
    apiGet.mockRejectedValueOnce({ status: 403 });
    const res = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(res.status).toBe("denied");
    expect(res.preview).toBeUndefined();
  });

  it.each([404, 410])("%d → unavailable (deleted/locked/archived)", async (code) => {
    apiGet.mockRejectedValueOnce({ status: code });
    const res = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(res.status).toBe("unavailable");
  });

  it("other error → error", async () => {
    apiGet.mockRejectedValueOnce({ status: 500 });
    const res = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(res.status).toBe("error");
  });

  it("empty docId short-circuits to error without a request", async () => {
    const res = await fetchDocPreview("doc", "", "sp_1");
    expect(res.status).toBe("error");
    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe("fetchDocPreview — doc ProseMirror parsing", () => {
  it("extracts first heading + paragraphs from the /content body", async () => {
    apiGet.mockResolvedValueOnce({
      doc: {
        type: "doc",
        content: [
          { type: "heading", content: [{ type: "text", text: "一、发布节奏" }] },
          { type: "paragraph", content: [{ type: "text", text: "第一段。" }] },
          { type: "paragraph", content: [{ type: "text", text: "第二段。" }] },
        ],
      },
    });
    const res = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(res.status).toBe("ready");
    expect(res.preview).toEqual({
      type: "doc",
      heading: "一、发布节奏",
      paragraphs: ["第一段。", "第二段。"],
    });
  });

  it("ready with no parseable content → undefined preview (graceful degrade)", async () => {
    apiGet.mockResolvedValueOnce({ doc: { type: "doc", content: [] } });
    const res = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(res.status).toBe("ready");
    expect(res.preview).toBeUndefined();
  });
});

describe("fetchDocPreview — cross-account cache isolation (Jerry-Xin/lml2468 🔴)", () => {
  // 预览结果按「当前登录用户」的 ACL 授权，换号后旧号缓存不可复用。
  it("does NOT serve one user's cached preview to a different logged-in user", async () => {
    // 用户 A：拿到 ready 并入缓存。
    currentUid = "u_alice";
    apiGet.mockResolvedValueOnce({ doc: { type: "doc", content: [] } });
    const a = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(a.status).toBe("ready");
    expect(apiGet).toHaveBeenCalledTimes(1);

    // 换号成 B（TTL 未过）：绝不能命中 A 的缓存，必须重新请求 B 自己的 ACL。
    currentUid = "u_bob";
    apiGet.mockRejectedValueOnce({ status: 403 });
    const b = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(b.status).toBe("denied");
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it("still caches within the same user (no regression on TTL hit)", async () => {
    currentUid = "u_alice";
    apiGet.mockResolvedValueOnce({ doc: { type: "doc", content: [] } });
    await fetchDocPreview("doc", "d_1", "sp_1");
    // 同一用户、同一 key、TTL 内第二次：走缓存，不再请求。
    const again = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(again.status).toBe("ready");
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
