/**
 * 防手滑：检测粘贴进聊天输入框的明文是否像一个 API 密钥（YUJ-3539 轻量版）。
 *
 * 信任边界：用户不应把 key 明文打进聊天。这里只做「即时提示 + 引导去密钥管理保存」，
 * 不拦截粘贴本身，也绝不把检测到的明文发出去（仅本地预填新增弹窗）。
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
