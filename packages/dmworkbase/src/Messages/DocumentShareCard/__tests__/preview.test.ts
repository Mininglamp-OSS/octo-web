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

/**
 * 构造一个和 APIClient 拦截器真实 reject 形状一致的错误对象。
 * 见 Service/APIClient.ts 的 `const rejected: APIClientRejectedError = { error, msg,
 * status, code, ... }`：`error` 字段就是**原始 axios error**，wire 错误体在
 * `error.response.data`。docs-backend 这批 GET 预览接口回的是 `{ error: "<code>" }`
 * （error 是**字符串**），所以它走不进 apiError.ts 的 v2 envelope 分支
 * （`isV2ErrorEnvelope` 要求 data.error 是**对象**），`normalized.code`/`rejected.code`
 * 一律 undefined —— 判别码只能从原始 axios error 里取。
 */
function wireReject(status: number, errorCode?: string) {
  return {
    error: errorCode === undefined ? {} : { response: { data: { error: errorCode } } },
    msg: "",
    status,
    code: undefined,
    normalized: { httpStatus: status, message: "", raw: {} },
  };
}

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
    // html 没有专属预览端点，故意复用 /content 当 ACL 探针
    // （预期 409 unsupported_doc_type，见下面的 empty 用例）。
    ["html", "content"],
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

  // docs-backend 的 409 unsupported_doc_type 只可能在 requireDocRole(reader) **通过之后**
  // 才抛出（docContent.ts:151 / docSheet.ts:55 / docScene.ts:48），所以它证明了「有权限、
  // 但这个 doc_type 没有预览」——是正常降级（empty），不是错误（error）。掉进 error 会让
  // html 文档卡片必现红色「预览不可用」。
  it("409 unsupported_doc_type → empty (has access, type has no preview — NOT an error)", async () => {
    apiGet.mockRejectedValueOnce(wireReject(409, "unsupported_doc_type"));
    const res = await fetchDocPreview("html", "d_1", "sp_1");
    expect(res.status).toBe("empty");
    expect(res.preview).toBeUndefined();
  });

  // 同一批 GET 预览接口的 409 **不止一种**。guard.ts:104 的 requireDocRole 在鉴权
  // **通过之后**发现 meta.status === 2（文档已归档）时也抛 409，错误码是 "conflict"。
  // 把它当 empty 会把「已归档」渲染成绿色「可查看 + 暂无预览」——错的。它语义上等同
  // 404/410：文案 docShareCard.placeholder.unavailable.desc 正是「可能已被删除或归档」。
  it("409 conflict (archived doc) → unavailable, NOT empty", async () => {
    apiGet.mockRejectedValueOnce(wireReject(409, "conflict"));
    const res = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(res.status).toBe("unavailable");
    expect(res.preview).toBeUndefined();
  });

  // 🔴 最关键的一条：snapshot_invalid 是后端明确 fail-closed 的**数据损坏/契约违例**
  // （docSheet.ts:165 / docScene.ts:94 的 GET 路径）。绝不能被吞成绿色「可查看」，
  // 必须保持红色 error，否则用户会以为文档没事。
  it.each([
    ["sheet" as const, "sheet_snapshot_invalid"],
    ["board" as const, "board_snapshot_invalid"],
  ])("409 %s snapshot_invalid → error (data corruption must stay fail-closed)", async (kind, code) => {
    apiGet.mockRejectedValueOnce(wireReject(409, code));
    const res = await fetchDocPreview(kind, "d_1", "sp_1");
    expect(res.status).toBe("error");
    expect(res.preview).toBeUndefined();
  });

  // fail-closed 兜底：拿不到错误码（响应体缺失 / 形状意外 / 未知新码）的 409 一律 error。
  // 宁可多显示一次红色，也不能把**未知**状态标成绿色「可查看」。
  it.each([
    ["missing response body", undefined],
    ["unknown error code", "some_future_code"],
  ])("409 with %s → error (fail-closed default)", async (_label, code) => {
    apiGet.mockRejectedValueOnce(wireReject(409, code));
    const res = await fetchDocPreview("doc", "d_1", "sp_1");
    expect(res.status).toBe("error");
  });

  // 缓存约定回归：error 不缓存（可能瞬时故障，允许重试）、unavailable 缓存（稳定结论）。
  it("does NOT cache a 409 error result (retry allowed on next call)", async () => {
    apiGet.mockRejectedValueOnce(wireReject(409, "sheet_snapshot_invalid"));
    expect((await fetchDocPreview("sheet", "d_err", "sp_1")).status).toBe("error");
    expect(apiGet).toHaveBeenCalledTimes(1);
    apiGet.mockRejectedValueOnce(wireReject(409, "sheet_snapshot_invalid"));
    expect((await fetchDocPreview("sheet", "d_err", "sp_1")).status).toBe("error");
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it("caches a 409 unavailable result (second call within TTL does not re-request)", async () => {
    apiGet.mockRejectedValueOnce(wireReject(409, "conflict"));
    expect((await fetchDocPreview("doc", "d_arch", "sp_1")).status).toBe("unavailable");
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect((await fetchDocPreview("doc", "d_arch", "sp_1")).status).toBe("unavailable");
    expect(apiGet).toHaveBeenCalledTimes(1);
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

describe("fetchDocPreview — html kind (unsupported_doc_type degrade)", () => {
  // 防御性：今天 backend 对 html 必回 409，走不到这里。但哪天它给 html 开了 200，
  // body 形状也不是 ProseMirror doc——绝不能拿去 parseDocPreview 解析/崩溃，直接 empty。
  it("html + HTTP 200 → empty (never parses a non-ProseMirror body)", async () => {
    apiGet.mockResolvedValueOnce({
      doc: { type: "doc", content: [{ type: "heading", content: [{ type: "text", text: "X" }] }] },
    });
    const res = await fetchDocPreview("html", "d_1", "sp_1");
    expect(res.status).toBe("empty");
    expect(res.preview).toBeUndefined();
  });

  // empty 是**稳定结论**（doc_type 不会在 TTL 内变），必须和 ready/denied 一样进缓存，
  // 否则每个 cell 挂载/每次 focus 都对同一个 html 文档白打一枪 409。
  it("caches the empty result (second call within TTL does not re-request)", async () => {
    apiGet.mockRejectedValueOnce(wireReject(409, "unsupported_doc_type"));
    const first = await fetchDocPreview("html", "d_1", "sp_1");
    expect(first.status).toBe("empty");
    expect(apiGet).toHaveBeenCalledTimes(1);

    const again = await fetchDocPreview("html", "d_1", "sp_1");
    expect(again.status).toBe("empty");
    expect(apiGet).toHaveBeenCalledTimes(1);
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
