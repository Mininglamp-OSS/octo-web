/**
 * 防手滑：检测粘贴进聊天输入框的明文是否像一个 API 密钥（YUJ-3539）。
 *
 * 信任边界：用户绝不应把 key 明文带进聊天（消息/会话/LLM 请求）。命中时调用方**硬
 * 拦截粘贴**——明文绝不进编辑器 DOM，因此也不可能被后续 send 读到发出去；同时弹一条
 * 引导提示，点它去密钥管理新增弹窗并本地预填（仅本机，不发送）。
 *
 * 命中前缀：sk- (OpenAI/Claude 等)、bf- (bot token)、app- (各类外部服务)。
 *
 * 边界：前缀左侧不能是「标识符字符」(字母/数字/下划线/连字符)。这样既能命中
 * 裸 token、空白分隔，也能命中 `.env`(`OPENAI_API_KEY=sk-...`) 和 JSON
 * (`"api_key":"sk-..."`) 里的 key，又不会把 `myapp-token` 里的 `app-` 误判
 * （左侧 `p` 是标识符字符，被边界挡掉）。
 * 保守匹配：前缀后需再跟够长的 token 体，避免把「app-store」这种普通词误判。
 */
const SECRET_PREFIX_RE = /(?:^|[^A-Za-z0-9_-])((?:sk|bf|app)-[A-Za-z0-9_-]{12,})/;

export interface DetectedSecret {
  /** 命中的完整 token 明文 */
  value: string;
  /** 命中的前缀，如 "sk-" */
  prefix: string;
}

/**
 * 在粘贴文本里找第一个像密钥的片段。没有则返回 null。
 */
export function detectPastedSecret(text: string): DetectedSecret | null {
  if (!text) return null;
  const m = SECRET_PREFIX_RE.exec(text);
  if (!m) return null;
  const value = m[1];
  const dash = value.indexOf("-");
  return {
    value,
    prefix: value.slice(0, dash + 1),
  };
}

/**
 * 粘贴防护决策（纯函数，便于回归测试）——给 ProseMirror `handlePaste` 用。
 *
 * 命中疑似密钥时：调用 `onDetected(value)` 走引导提示/预填，并返回 `true` 告诉调用方
 * **硬拦截这次粘贴**（preventDefault + return true），明文因此绝不进编辑器 DOM，也就
 * 不可能被后续 send（读 editor 文本）发进聊天。未命中返回 `false`，走默认粘贴。
 *
 * 这是 Jerry-Xin/lml2468 P0-1 的核心修复点：旧实现只提示却放行默认粘贴，明文进了
 * 编辑器，用户回车即把密钥发出去——「不会发送」是假安全。现在改为硬拦截。
 */
export function handleSecretPaste(
  pastedText: string,
  onDetected: (value: string) => void
): boolean {
  const hit = detectPastedSecret(pastedText);
  if (!hit) return false;
  onDetected(hit.value);
  return true;
}
