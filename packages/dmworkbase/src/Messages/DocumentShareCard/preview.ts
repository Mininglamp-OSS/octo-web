import APIClient from "../../Service/APIClient";
import WKApp from "../../App";
import type {
  DocShareKind,
  DocSharePreview,
  DocSharePreviewStatus,
} from "../../ui/DocumentShareCard";

export interface DocPreviewResult {
  status: DocSharePreviewStatus;
  preview?: DocSharePreview;
}

/** 首屏预览取值上限，控制卡片高度与解析预算。 */
const MAX_PARAGRAPHS = 3;
const MAX_ROWS = 3;
const MAX_NODES = 6;
/** 解析预算：wire 内容不可信，递归/字符/扫描都要有硬上限，防恶意大 payload 拖垮渲染。 */
const MAX_TEXT_CHARS = 500;
const MAX_DEPTH = 20;
const MAX_BLOCK_SCAN = 200;

/** 递归收集 ProseMirror 节点纯文本；深度 + 字符双上限（P2-5）。 */
function collectText(node: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return "";
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n?.text === "string") return n.text.slice(0, MAX_TEXT_CHARS);
  if (Array.isArray(n?.content)) {
    let out = "";
    for (const child of n.content as unknown[]) {
      out += collectText(child, depth + 1);
      if (out.length >= MAX_TEXT_CHARS) break;
    }
    return out.slice(0, MAX_TEXT_CHARS);
  }
  return "";
}

/** 解析 GET /docs/:id/content 的 ProseMirror 文档 → 首个标题 + 前几段。 */
function parseDocPreview(body: unknown): DocSharePreview | undefined {
  const doc = (body as { doc?: { content?: unknown } })?.doc;
  const blocks = Array.isArray(doc?.content) ? (doc!.content as any[]) : [];
  let heading: string | undefined;
  const paragraphs: string[] = [];
  const scan = Math.min(blocks.length, MAX_BLOCK_SCAN);
  for (let i = 0; i < scan; i++) {
    const block = blocks[i];
    const text = collectText(block).trim();
    if (!text) continue;
    if (!heading && block?.type === "heading") {
      heading = text;
      continue;
    }
    paragraphs.push(text);
    if (paragraphs.length >= MAX_PARAGRAPHS) break;
  }
  if (!heading && paragraphs.length === 0) return undefined;
  return { type: "doc", heading, paragraphs };
}

/**
 * 解析 GET /docs/:id/scene（画板）→ 元素中的文本标签。
 * NOTE: scene 的精确响应结构（Excalidraw elements）尚待用真实数据核对，这里做**稳健的
 * 文本提取**，拿不到就返回 undefined（卡片降级为无预览，不影响身份/权限/链接/打开）。
 */
function parseBoardPreview(body: unknown): DocSharePreview | undefined {
  const elements =
    (body as { elements?: unknown; scene?: { elements?: unknown } })?.elements ??
    (body as { scene?: { elements?: unknown } })?.scene?.elements;
  if (!Array.isArray(elements)) return undefined;
  const nodes: string[] = [];
  for (const el of elements as any[]) {
    const text = typeof el?.text === "string" ? el.text.trim().slice(0, MAX_TEXT_CHARS) : "";
    if (text) nodes.push(text);
    if (nodes.length >= MAX_NODES) break;
  }
  return nodes.length > 0 ? { type: "board", nodes } : undefined;
}

/**
 * 解析 GET /docs/:id/sheet（表格）→ 首个 sheet 左上角小网格（row0 表头 + 前几行）。
 * 真实响应是**扁平 cell map**：`body.sheetCells = { "<sheetId>!<row>:<col>": {v,f,s,...} }`
 * （key 格式见 docs-backend sheetCellKey）。取 cell 数最多的 sheet，重建 rows 0..MAX_ROWS × 前几列。
 * 扫描量有硬上限，仅非空值计入；拿不到 → undefined（降级无预览）。
 */
const SHEET_CELL_KEY = /^(.+)!(\d+):(\d+)$/;
const SHEET_MAX_COLS = 5;
const SHEET_MAX_SCAN = 4000;

function parseSheetPreview(body: unknown): DocSharePreview | undefined {
  const cells = (body as { sheetCells?: unknown })?.sheetCells;
  if (!cells || typeof cells !== "object") return undefined;
  const bySheet = new Map<string, Map<number, Map<number, string>>>();
  let scanned = 0;
  for (const [key, cell] of Object.entries(cells as Record<string, unknown>)) {
    if (++scanned > SHEET_MAX_SCAN) break;
    const m = SHEET_CELL_KEY.exec(key);
    if (!m) continue;
    const row = Number(m[2]);
    const col = Number(m[3]);
    if (row > MAX_ROWS || col > SHEET_MAX_COLS) continue;
    const v = (cell as { v?: unknown })?.v;
    if (v == null || v === "") continue;
    const sheetId = m[1];
    let rows = bySheet.get(sheetId);
    if (!rows) { rows = new Map(); bySheet.set(sheetId, rows); }
    let cols = rows.get(row);
    if (!cols) { cols = new Map(); rows.set(row, cols); }
    cols.set(col, String(v).slice(0, MAX_TEXT_CHARS));
  }
  if (bySheet.size === 0) return undefined;
  let target: Map<number, Map<number, string>> | undefined;
  let best = -1;
  for (const rows of bySheet.values()) {
    let count = 0;
    for (const cols of rows.values()) count += cols.size;
    if (count > best) { best = count; target = rows; }
  }
  if (!target) return undefined;
  const colSet = new Set<number>();
  for (const cols of target.values()) for (const c of cols.keys()) colSet.add(c);
  const colList = [...colSet].sort((a, b) => a - b).slice(0, SHEET_MAX_COLS + 1);
  if (colList.length === 0) return undefined;
  const buildRow = (r: number): string[] => colList.map((c) => target!.get(r)?.get(c) ?? "");
  const headers = buildRow(0);
  const dataRows: string[][] = [];
  for (let r = 1; r <= MAX_ROWS; r++) {
    if (target.has(r)) dataRows.push(buildRow(r));
  }
  if (headers.every((h) => h === "") && dataRows.length === 0) return undefined;
  return { type: "sheet", headers, rows: dataRows };
}

const ENDPOINT: Record<DocShareKind, string> = {
  doc: "content",
  board: "scene",
  sheet: "sheet",
  // html **故意**打 /content，虽然它没有专属预览端点。docs-backend 的 docContent 是
  // 先跑 requireDocRole(reader)、通过后才撞 doc_type 闸抛 409 `unsupported_doc_type`，
  // 所以这一枪被当作纯粹的 **ACL 探针**：409 `unsupported_doc_type` 就是“有 reader 权限、
  // 但此类型无预览”（→ empty），403/404 依旧是无权限/失效。注意 409 **不止这一种**
  // （见 requestPreview 的错误码分派），只有这个码能推出 reader。零新端点、ACL 语义不丢，
  // 且未来任何新 doc_type 自动兜住。
  html: "content",
};

/**
 * 从 APIClient reject 出来的错误里取 docs-backend 的 **wire 错误码**。
 *
 * 为什么不能读 `rejected.code` / `normalized.code`：docs-backend 这批 GET 预览接口返回的是
 * `{ error: "unsupported_doc_type" }`，`error` 是**字符串**；而 apiError.ts 的
 * `isV2ErrorEnvelope` 要求 `data.error` 是**对象**才认作 v2 信封，所以这个响应走 legacy
 * 分支，两个 `code` 字段恒为 undefined。判别码只能从原始 axios error 上取
 * （`APIClientRejectedError.error` 即原始 axios error，见 Service/APIClient.ts 拦截器）。
 * 同款先例：dmworkmcp/src/api/mcpService.ts、expertService.ts 的 extractErrorMessage。
 */
function wireErrorCode(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const raw = (e as { error?: unknown }).error;
  if (!raw || typeof raw !== "object") return undefined;
  const response = (raw as { response?: unknown }).response;
  if (!response || typeof response !== "object") return undefined;
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const code = (data as { error?: unknown }).error;
  return typeof code === "string" && code !== "" ? code : undefined;
}

async function requestPreview(
  kind: DocShareKind,
  docId: string,
  spaceId: string,
): Promise<DocPreviewResult> {
  try {
    const body = await APIClient.shared.get<unknown>(
      `docs/${encodeURIComponent(docId)}/${ENDPOINT[kind]}`,
      {
        headers: spaceId ? { "X-Space-Id": spaceId } : undefined,
        param: spaceId ? { sp: spaceId } : undefined,
      } as any,
    );
    // html 没有可渲染的首屏预览，body 形状也不是 ProseMirror doc——绝不能拿去
    // parseDocPreview 解析。防御性分支：今天 backend 必回 409、走不到这里，但哪天
    // 它给 html 开了 200，也只能得出 empty（有权限无预览），不能崩也不能乱渲染。
    if (kind === "html") return { status: "empty" };
    const preview =
      kind === "doc"
        ? parseDocPreview(body)
        : kind === "board"
          ? parseBoardPreview(body)
          : parseSheetPreview(body);
    return { status: "ready", preview };
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 403) return { status: "denied" };
    if (status === 404 || status === 410) return { status: "unavailable" };
    // 409 **不是单一语义**，同一批 GET 预览接口至少吐三类，必须按 wire 错误码分派，
    // 否则会把「已归档」和「数据损坏」一起吞成绿色「可查看」（fail-open 状态误判）：
    //   • unsupported_doc_type（docContent.ts / docSheet.ts / docScene.ts）——doc_type 闸在
    //     requireDocRole(reader) **通过之后**才跑，故它确证「有 reader 权限、只是此类型无
    //     预览」，是正常降级 → empty（卡片标绿 + 「暂无预览」占位）。
    //   • conflict（guard.ts 的 requireDocRole，鉴权通过后发现 meta.status === 2）——文档
    //     **已归档** → unavailable，与 404/410 同类（文案「可能已被删除或归档」正好吻合）。
    //   • sheet_snapshot_invalid / board_snapshot_invalid（GET 路径）——真实的数据损坏/契约
    //     违例，后端明确 fail-closed → 必须保持 error（红色），不能被吞成绿色。
    // 兜底方向是 **fail-closed**：任何其它 409、以及**取不到错误码**的 409，一律 error。
    // 宁可多显示一次红色，也不能把未知状态标成「可查看」。
    if (status === 409) {
      const code = wireErrorCode(e);
      if (code === "unsupported_doc_type") return { status: "empty" };
      if (code === "conflict") return { status: "unavailable" };
      return { status: "error" };
    }
    return { status: "error" };
  }
}

/** 结果缓存 TTL：同一 (kind,doc,space) 30s 内复用，别每个 cell 挂载都打一枪（P2-4）。 */
const PREVIEW_TTL_MS = 30_000;
const resultCache = new Map<string, { at: number; result: DocPreviewResult }>();
const inflight = new Map<string, Promise<DocPreviewResult>>();

/** 测试用：清空预览结果缓存与在飞表，避免用例间串味。 */
export function resetDocPreviewCache(): void {
  resultCache.clear();
  inflight.clear();
  cacheOwnerUid = null;
}

/**
 * 当前缓存归属的登录 uid。预览结果是按 ACL 授权给「当前登录用户」的，
 * 不能跨账号复用：换号登录后旧号缓存的 ready/denied 必须作废（Jerry-Xin/lml2468 🔴
 * 跨账号缓存泄漏）。缓存 key 内已嵌 uid 做隔离；这里再在 uid 变化时整体清空，
 * 双保险并回收旧号内存。
 */
let cacheOwnerUid: string | null = null;

/** 读当前登录 uid；未登录/取不到时返回空串（连同 docId 缺失一样走 error）。 */
function currentViewerUid(): string {
  return WKApp.loginInfo?.uid ?? "";
}

function cacheKey(
  viewerUid: string,
  kind: DocShareKind,
  docId: string,
  spaceId: string,
): string {
  return `${viewerUid}\u0000${kind}\u0000${docId}\u0000${spaceId}`;
}

/**
 * 拉取一份 ACL-safe 首屏预览。信任边界由 **docs 后端 reader 接口**把守（requireDocRole）：
 * 无权限 → 403 → denied；文档删/锁 → 404/410 → unavailable；有 reader 权限但该类型无预览 →
 * 409 `unsupported_doc_type` → empty；文档已归档 → 409 `conflict` → unavailable；
 * 其余错误（含**其它 409**，如 snapshot_invalid 这类后端 fail-closed 的数据损坏）→ error。
 * space 用显式 X-Space-Id 头传文档自身 space（文档可能不在当前 space）。
 *
 * 去重 + 缓存（P2-4）：并发同 key 共享一个在飞请求；成功/无权限/失效/无预览结果缓存 30s
 * （empty 和 ready 一样是**稳定结论**，doc_type 不会在 TTL 内变），error 不缓存（可能是瞬时
 * 故障，允许下次重试）。`signal` 保留以兼容调用方，但共享请求不按单个调用方 abort
 * （Cell 侧已用自身 aborted 标志守 setState，卸载后不写状态）。
 */
export async function fetchDocPreview(
  kind: DocShareKind,
  docId: string,
  spaceId: string,
  opts: { force?: boolean } = {},
): Promise<DocPreviewResult> {
  if (!docId) return { status: "error" };

  // 账号隔离（Jerry-Xin/lml2468 🔴 跨账号缓存泄漏）：预览结果按当前登录用户的 ACL
  // 授权，换号后旧号缓存不可复用。检测到 uid 变化先整体清空缓存与在飞表，再用带 uid
  // 的 key 存取，杜绝下一个用户在 TTL 窗口内读到上一个用户的 ready/denied。
  const viewerUid = currentViewerUid();
  if (viewerUid !== cacheOwnerUid) {
    resultCache.clear();
    inflight.clear();
    cacheOwnerUid = viewerUid;
  }

  const key = cacheKey(viewerUid, kind, docId, spaceId);

  // force=true（焦点/可见性重查）：跳过缓存读，强制拿最新 ACL 结果——用户刚在别处授权后
  // 切回来应立即反映，不能被 30s 旧缓存挡住。仍复用在飞请求做去重。
  if (!opts.force) {
    const cached = resultCache.get(key);
    if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) return cached.result;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = requestPreview(kind, docId, spaceId).then((result) => {
    inflight.delete(key);
    if (result.status !== "error") resultCache.set(key, { at: Date.now(), result });
    return result;
  });
  inflight.set(key, p);
  return p;
}
