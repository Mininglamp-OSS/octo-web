// 自定义贴纸上传上限的解析与默认值。独立 leaf 文件（同 OidcConfig.ts 的理由）：
// 不依赖 React / lottie 等重模块，vitest 可以直接深路径 import 真实实现测试。
//
// 后端 /v1/common/appconfig 的 sticker_upload_limits 对象被 parse 成此结构，供
// EmojiToolbar 在用户选完文件后本地预校验（size/format/dimension）。服务端
// modules/file 侧仍对每次 sticker upload 请求做同一份 stickerLimits 快照兜底，
// 这里只是即时反馈，不构成安全边界（见 octo-server #544/#547）。

/**
 * StickerUploadLimits 与后端 stickerUploadLimitsResp（sticker_upload_limits 字段）
 * 一一对应，字段改成 camelCase。
 */
export interface StickerUploadLimits {
  maxSizeKB: number;
  maxDimension: number;
  allowedFormats: string[];
}

/**
 * 默认值 = 字段缺失 / appconfig 请求失败 / 字段格式不对时的回退值，与 PR #544
 * 之前的历史硬编码（EmojiToolbar 原 MAX_STICKER_BYTES=1MB、512px、gif/png/jpg/
 * jpeg/webp）严格等价，保证拿不到最新配置时行为无回归。
 */
export const DEFAULT_STICKER_UPLOAD_LIMITS: StickerUploadLimits = {
  maxSizeKB: 1024,
  maxDimension: 512,
  allowedFormats: [".gif", ".png", ".jpg", ".jpeg", ".webp"],
};

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseAllowedFormats(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value.filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  return out.length > 0 ? out : fallback;
}

/**
 * parseStickerUploadLimits 把后端 snake_case 的 sticker_upload_limits 对象解析成
 * 前端 camelCase 结构。每个字段独立类型防御、独立回退默认值——不是整体回退，
 * 单个字段格式不对不应该连累其余两个字段——与 parseOidcProviders「配置坏了退化
 * 不炸」的原则一致，appconfig 解析不会因为这一个字段抛错。
 */
export function parseStickerUploadLimits(raw: unknown): StickerUploadLimits {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_STICKER_UPLOAD_LIMITS };
  }
  const r = raw as Record<string, unknown>;
  return {
    maxSizeKB: parsePositiveInt(
      r["max_size_kb"],
      DEFAULT_STICKER_UPLOAD_LIMITS.maxSizeKB
    ),
    maxDimension: parsePositiveInt(
      r["max_dimension"],
      DEFAULT_STICKER_UPLOAD_LIMITS.maxDimension
    ),
    allowedFormats: parseAllowedFormats(
      r["allowed_formats"],
      DEFAULT_STICKER_UPLOAD_LIMITS.allowedFormats
    ),
  };
}

/**
 * stickerUploadLimitsEqual 供 WKRemoteConfig.requestConfig() 做变更检测——三个
 * 字段都相同才算相同，用于决定要不要 notifyConfigChangeListeners()。
 */
export function stickerUploadLimitsEqual(
  a: StickerUploadLimits,
  b: StickerUploadLimits
): boolean {
  return (
    a.maxSizeKB === b.maxSizeKB &&
    a.maxDimension === b.maxDimension &&
    a.allowedFormats.length === b.allowedFormats.length &&
    a.allowedFormats.every((f, i) => f === b.allowedFormats[i])
  );
}
