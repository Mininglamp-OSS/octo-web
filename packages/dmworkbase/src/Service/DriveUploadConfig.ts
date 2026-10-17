// 网盘(Drive)动态上传策略的解析与默认值。独立 leaf 文件（同 StickerUploadConfig.ts /
// FileUploadConfig.ts / OidcConfig.ts 的理由）：不依赖 React / lottie 等重模块，vitest
// 可以直接深路径 import 真实实现测试。
//
// 后端 /v1/common/appconfig 的 drive_upload_limits 对象被 parse 成此结构，供企业模块
// (④ octo-drive-module) 在用户选完文件后本地预校验 / 分片调度（选片并发 / 会话并发）。
// 主壳本身不渲染任何 drive 上传 UI，只提供唯一真值来源；服务端仍对每次上传请求用同一份
// 策略快照兜底（大小 + 分片 + 并发），这里只是即时反馈与调度建议，不构成安全边界。
// 依据：octo-web 主壳设计 §3.1 A / §3.3。

/**
 * DriveUploadLimits 与后端 drive_upload_limits 一一对应，字段改成 camelCase。
 */
export interface DriveUploadLimits {
  maxSizeKB: number;
  multipartThresholdKB: number;
  partSizeKB: number;
  maxConcurrentParts: number;
  maxConcurrentSessions: number;
}

/**
 * 默认值 = 字段缺失 / appconfig 请求失败 / 字段格式不对时的回退值，即
 * 1 GiB / 128 MiB / 64 MiB / 3 / 3（1048576 / 131072 / 65536 / 3 / 3）。
 *
 * 1 GiB 是服务器侧已合并（octo-server PR #930）下发的 effective 上限；主壳不做任何
 * 防御性 clamp（硬上限是 ① 的部署级知识，见设计 §3.3 / 06 冻结决策 3），只透传。
 */
export const DEFAULT_DRIVE_UPLOAD_LIMITS: DriveUploadLimits = {
  maxSizeKB: 1048576,
  multipartThresholdKB: 131072,
  partSizeKB: 65536,
  maxConcurrentParts: 3,
  maxConcurrentSessions: 3,
};

/**
 * 只接受正整数：非 number/string、NaN、Infinity、≤0、非整数一律回退。注意
 * Number("1048576") 是合法路径（后端 JSON 里就是 number，字符串也应容错）。
 */
function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/**
 * parseDriveUploadLimits 把后端 snake_case 的 drive_upload_limits 对象解析成前端 camelCase
 * 结构。每个字段独立类型防御、独立回退默认值——不是整体回退，单个字段格式不对不应该连累
 * 其余字段——与 parseStickerUploadLimits / parseFileUploadLimits / parseOidcProviders
 * 「配置坏了退化不炸」的原则一致，appconfig 解析不会因为这一个字段抛错。
 *
 * 主壳只解析、不做语义校正：例如 multipart_threshold_kb 大于 max_size_kb 这类退化解也原样
 * 透传，业务归一由服务端 / 消费方负责（见设计 §6.1）。
 */
export function parseDriveUploadLimits(raw: unknown): DriveUploadLimits {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_DRIVE_UPLOAD_LIMITS };
  }
  const r = raw as Record<string, unknown>;
  return {
    maxSizeKB: parsePositiveInt(
      r["max_size_kb"],
      DEFAULT_DRIVE_UPLOAD_LIMITS.maxSizeKB
    ),
    multipartThresholdKB: parsePositiveInt(
      r["multipart_threshold_kb"],
      DEFAULT_DRIVE_UPLOAD_LIMITS.multipartThresholdKB
    ),
    partSizeKB: parsePositiveInt(
      r["part_size_kb"],
      DEFAULT_DRIVE_UPLOAD_LIMITS.partSizeKB
    ),
    maxConcurrentParts: parsePositiveInt(
      r["max_concurrent_parts"],
      DEFAULT_DRIVE_UPLOAD_LIMITS.maxConcurrentParts
    ),
    maxConcurrentSessions: parsePositiveInt(
      r["max_concurrent_sessions"],
      DEFAULT_DRIVE_UPLOAD_LIMITS.maxConcurrentSessions
    ),
  };
}

/**
 * driveUploadLimitsEqual 供 WKRemoteConfig.requestConfig() 做变更检测——五个字段都相同才算
 * 相同，用于决定要不要 notifyConfigChangeListeners()。
 */
export function driveUploadLimitsEqual(
  a: DriveUploadLimits,
  b: DriveUploadLimits
): boolean {
  return (
    a.maxSizeKB === b.maxSizeKB &&
    a.multipartThresholdKB === b.multipartThresholdKB &&
    a.partSizeKB === b.partSizeKB &&
    a.maxConcurrentParts === b.maxConcurrentParts &&
    a.maxConcurrentSessions === b.maxConcurrentSessions
  );
}
