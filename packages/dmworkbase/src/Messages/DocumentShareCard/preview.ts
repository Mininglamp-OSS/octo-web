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
};

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
 * 无权限 → 403 → denied；文档删/锁/归档 → 404/410 → unavailable；其余错误 → error。
 * space 用显式 X-Space-Id 头传文档自身 space（文档可能不在当前 space）。
 *
 * 去重 + 缓存（P2-4）：并发同 key 共享一个在飞请求；成功/无权限/失效结果缓存 30s，
 * error 不缓存（可能是瞬时故障，允许下次重试）。`signal` 保留以兼容调用方，但共享请求
 * 不按单个调用方 abort（Cell 侧已用自身 aborted 标志守 setState，卸载后不写状态）。
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
