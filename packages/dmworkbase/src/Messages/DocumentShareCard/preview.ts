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

/**
 * 采用并**规范化** GET /docs/:id/html-preview 的 `body.preview`。
 *
 * ⚠️ 这个 body **不是** ProseMirror 树，是后端已经抽好的纯文本结果，喂给
 * parseDocPreview 只会读到 `body.doc.content === undefined` → 恒 undefined。
 * 所以 html 分支只认 `body.preview`、**绝不解析 `body.doc`**（后端
 * docHtmlPreview.ts 文件头明确写了这条契约）。
 *
 * 但“不解析”不等于“逐字照收”：wire 数据仍不可信，这里会 trim、丢弃非字符串与空串、
 * 按本文件既有预算截断长度与段数（MAX_TEXT_CHARS / MAX_PARAGRAPHS）——别让后端的上限
 * 成为前端唯一的上限。
 *
 * ⚠️ heading/paragraphs 是从**攻击者可控**的 HTML 文档里抽出来的纯文本，可能含
 * `<` `>` `&`（`&lt;script&gt;` 解码后就是字面量 `<script>`）。消费端必须**当文本渲染**
 * ——ui/DocumentShareCard 的 JSX 插值天然转义，符合要求；任何 innerHTML /
 * dangerouslySetInnerHTML 都会把文本变回 markup，重新造出这个端点本来要消灭的 XSS。
 */
function adoptHtmlPreview(body: unknown): DocSharePreview | undefined {
  const preview = (body as { preview?: unknown })?.preview;
  if (!preview || typeof preview !== "object") return undefined;
  const p = preview as { heading?: unknown; paragraphs?: unknown };
  const rawHeading = typeof p.heading === "string" ? p.heading.trim() : "";
  const heading = rawHeading ? rawHeading.slice(0, MAX_TEXT_CHARS) : undefined;
  const paragraphs: string[] = [];
  if (Array.isArray(p.paragraphs)) {
    for (const item of p.paragraphs as unknown[]) {
      if (typeof item !== "string") continue;
      const text = item.trim();
      if (!text) continue;
      paragraphs.push(text.slice(0, MAX_TEXT_CHARS));
      if (paragraphs.length >= MAX_PARAGRAPHS) break;
    }
  }
  // 空 paragraphs + 无 heading 是后端的**正常降级**（无 slug / 上游取不到 / 解析不出
  // 内容时它回 200 + 空预览，绝不 5xx）→ undefined，交给 requestPreview 判成 empty
  // （灰色「暂无预览」），**不能**变成红色 error。
  if (!heading && paragraphs.length === 0) return undefined;
  return { type: "doc", heading, paragraphs };
}

const ENDPOINT: Record<DocShareKind, string> = {
  doc: "content",
  board: "scene",
  sheet: "sheet",
  // html 有了专属预览端点（docs-backend docHtmlPreview.ts，reader / requireDocRole）：
  // 服务端抓上游 HTML、抽出 heading + 前几段**纯文本**返回，原始 markup 永不过界。
  // 它复用 doc 的三段式错误码语义（403 无权限 / 404·410 失效 / 409
  // `unsupported_doc_type` 该类型无预览 / 409 `conflict` 已归档），所以下面的分派不变。
  html: "html-preview",
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
    const preview =
      kind === "doc"
        ? parseDocPreview(body)
        : kind === "board"
          ? parseBoardPreview(body)
          : kind === "sheet"
            ? parseSheetPreview(body)
            : adoptHtmlPreview(body);
    // html-preview 的 200 + 空预览是后端**刻意**的降级出口（宁可无预览也不让卡片变红），
    // 前端必须把它落成 empty（灰色「暂无预览」），而不是 ready-with-undefined。
    if (kind === "html" && !preview) return { status: "empty" };
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
 * html 另有一条：/html-preview 回 **200 + 空 preview** → empty（后端刻意的降级出口）；
 * 其余错误（含**其它 409**，如 snapshot_invalid 这类后端 fail-closed 的数据损坏）→ error。
 * space 用显式 X-Space-Id 头传文档自身的 space（文档可能不在当前 space）。
 *
 * 去重 + 缓存（P2-4）：并发同 key 共享一个在飞请求；成功/无权限/失效/无预览结果缓存 30s，
 * error 不缓存（可能是瞬时故障，允许下次重试）。
 *
 * ⚠️ empty **不是稳定结论**，它仍然进缓存是一个权衡，不是推论：
 *   • 409 `unsupported_doc_type` 这条确实稳定（doc_type 不会在 TTL 内变）；
 *   • 但 html 的 200 + 空 preview 可能源于**上游超时 / 临时故障 / 无 slug**
 *     （见 docs-backend htmlPreviewFetch.ts：任何失败都降级成空预览，绝不 5xx）——
 *     这类 empty **30s 内完全可能自愈**。
 * 仍然缓存它的理由：（1）不缓存就变成每个 cell 挂载都对同一文档重打一枪，而 html 那一枪
 * 还会穿透到上游取源，成本远高于一次 409；（2）降级态本身是中性的「暂无预览」，多撑一会
 * 不会误导用户（不会把有预览说成没权限，也不会把正常说成出错）。
 *
 * ⚠️ 但**没有定时重查**：能拿到新结果的只有两种情况——缓存**已过期**后的 Cell 挂载（挂载走
 * `force: false`，TTL 内重新挂载会直接命中旧 empty，**不**会重取），或 `force: true`（Cell 侧绑的
 * window focus / visibilitychange，见 Messages/DocumentShareCard/index.tsx）。注意 `force: true`
 * 只绕过**结果缓存**，不绕过在飞去重：同 key 请求正在路上时它复用那一枪、不另发。用户若一直
 * 停在同一个可见窗口盯着这张卡，上游恢复了它也不会自己变出预览——陈旧态**不是有界的**，
 * 需要用户切走再切回（force），或等 TTL 过期后再挂载。缩短 html empty 的 TTL 或加定时重试
 * 可以改善这一点，属于后续优化，不在本次改动范围内。
 *
 * `signal` 保留以兼容调用方，但共享请求不按单个调用方 abort
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
