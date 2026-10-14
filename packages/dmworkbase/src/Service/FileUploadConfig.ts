// 消息输入框附件上传上限的解析与默认值。独立 leaf 文件（同 StickerUploadConfig.ts /
// OidcConfig.ts 的理由）：不依赖 React / lottie 等重模块，vitest 可以直接深路径 import
// 真实实现测试。
//
// 后端 /v1/common/appconfig 的 file_upload_limits 对象被 parse 成此结构，供
// Conversation.addPendingAttachments / reeditableMessage.remoteReeditFileToFile 在用户
// 选完文件后本地预校验（单文件 / 累计大小 / 扩展名允许集）。服务端 modules/file 侧仍对
// 每次上传请求用同一份策略快照兜底（大小 + 扩展名黑/白名单），这里只是即时反馈，
// 不构成安全边界（见 octo-server modules/file/api.go 的大小与扩展名校验）。

/**
 * FileUploadLimits 与后端 file_upload_limits 一一对应，字段改成 camelCase。
 */
export interface FileUploadLimits {
  maxSizeKB: number;
  allowedExtensions: string[];
}

/**
 * 默认值 = 字段缺失 / appconfig 请求失败 / 字段格式不对时的回退值，与基线历史硬编码
 * （ConversationVM.MAX_TOTAL_SIZE、MAX_REEDIT_FILE_BYTES 两处 100MB）严格等价，保证拿不
 * 到最新配置时行为零回归。
 *
 * allowedExtensions 默认空数组 = 「后端未下发允许集时不做扩展名白名单限制」，与基线只
 * 走本地 16 项黑名单的行为等价；消费侧把空数组读作「无允许集限制」，不会出现「全部拒绝」
 * 的静默故障。空数组天然不包含基线黑名单里的任何危险扩展名。
 */
export const DEFAULT_FILE_UPLOAD_LIMITS: FileUploadLimits = {
  maxSizeKB: 102400,
  allowedExtensions: [],
};

/**
 * 只接受正整数：非 number/string、NaN、Infinity、≤0、非整数一律回退。注意
 * Number("102400") 是合法路径（后端 JSON 里就是 number，字符串也应容错）。
 */
function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/**
 * 归一化扩展名允许集：过滤非 string / 空串，逐个 trim + 转小写 + 缺前导点补点，并去重。
 * 非数组 / 归一化后为空数组时回退默认值（空允许集若被读成「什么都不能传」，比缺字段更危险）。
 */
function parseAllowedExtensions(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().toLowerCase();
    if (!trimmed) continue;
    const normalized = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.length > 0 ? out : fallback;
}

/**
 * parseFileUploadLimits 把后端 snake_case 的 file_upload_limits 对象解析成前端 camelCase
 * 结构。每个字段独立类型防御、独立回退默认值——不是整体回退，单个字段格式不对不应该连累
 * 另一个字段——与 parseStickerUploadLimits / parseOidcProviders「配置坏了退化不炸」的原则
 * 一致，appconfig 解析不会因为这一个字段抛错。
 */
export function parseFileUploadLimits(raw: unknown): FileUploadLimits {
  if (!raw || typeof raw !== "object") {
    return {
      maxSizeKB: DEFAULT_FILE_UPLOAD_LIMITS.maxSizeKB,
      allowedExtensions: [...DEFAULT_FILE_UPLOAD_LIMITS.allowedExtensions],
    };
  }
  const r = raw as Record<string, unknown>;
  return {
    maxSizeKB: parsePositiveInt(
      r["max_size_kb"],
      DEFAULT_FILE_UPLOAD_LIMITS.maxSizeKB
    ),
    allowedExtensions: parseAllowedExtensions(
      r["allowed_extensions"],
      DEFAULT_FILE_UPLOAD_LIMITS.allowedExtensions
    ),
  };
}

/**
 * fileUploadLimitsEqual 供 WKRemoteConfig.requestConfig() 做变更检测——两个字段都相同才算
 * 相同，用于决定要不要 notifyConfigChangeListeners()。
 */
export function fileUploadLimitsEqual(
  a: FileUploadLimits,
  b: FileUploadLimits
): boolean {
  return (
    a.maxSizeKB === b.maxSizeKB &&
    a.allowedExtensions.length === b.allowedExtensions.length &&
    a.allowedExtensions.every((ext, i) => ext === b.allowedExtensions[i])
  );
}
