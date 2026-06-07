import APIClient from "./APIClient";

/**
 * 密钥分类。仅用于列表分组/过滤展示，不影响存储或解引用逻辑。
 * - llm：模型密钥（如 Claude / OpenAI 的 sk- 开头 key）
 * - external：外部服务 token（如各类 SaaS 的 app- / bf- token）
 */
export type SecretKind = "llm" | "external";

/**
 * 列表项 —— 后端 write-only 契约（YUJ-3538）：
 * 任何接口永不回显明文/密文，列表只返自然语言名字 + kind + 掩码尾4位 + 时间元数据。
 */
export interface SecretListItem {
  /** 稳定内部 secret_id，引用用它，改名不断引用 */
  secret_id: string;
  /** 自然语言短语（语音友好，允许中文/空格，可重命名），列表大字主标题 */
  display_name: string;
  kind: SecretKind;
  /** 掩码尾4位，如 "sk-****…a1b2"。后端可能只回 last4，前端兜底拼装 */
  masked?: string;
  /** 末尾4位明文（仅用于展示掩码，非敏感） */
  last4?: string;
  /** ISO8601 创建时间 */
  created_at: string;
  /** ISO8601 更新时间 */
  updated_at?: string;
  /** ISO8601 最后使用时间；从未使用为 null/缺省 */
  last_used_at?: string | null;
}

export interface SecretListResponse {
  /**
   * 后端契约（YUJ-3538）list 实测返回 `{ "secrets": [...] }`（gin `c.JSON` 裸出，
   * 无 `data` 包裹）。这里仍兼容 list/items 别名，并在 normalizeList 里额外兜底
   * 一层 `data` 信封（`{ data: { secrets } }` / `{ data: [] }`），以防未来网关/中间件
   * 统一加 envelope —— 多一层防御不会误伤裸响应。
   */
  secrets?: SecretListItem[];
  list?: SecretListItem[];
  items?: SecretListItem[];
  /** 防御性：未来若被统一信封包裹（data: {...} 或 data: [...]）也能解出 */
  data?: SecretListResponse | SecretListItem[];
}

export interface CreateSecretRequest {
  display_name: string;
  kind: SecretKind;
  /**
   * 明文 key，直达后端加密存储，不经任何聊天流。
   * 线上字段名 `key`（YUJ-3538 契约：`POST /v1/manager/secrets` body `{ key }`）。
   */
  key: string;
}

/** 更新：换 key 或改名。secret_id 不变，引用不断。 */
export interface UpdateSecretRequest {
  /** 仅改名时传 */
  display_name?: string;
  /** 仅换 key 时传新明文（线上字段名 `key`）；不传表示不动 key */
  key?: string;
  kind?: SecretKind;
}

/**
 * SecretsService —— 用户外部密钥别名管理前端 Service（YUJ-3539）。
 *
 * 信任边界：key 明文只在「新增/编辑弹窗 → 本 Service → 后端」这条直链上出现，
 * 绝不经过聊天/消息/LLM 请求。保存成功后后端永不回显原值，前端也不缓存明文。
 *
 * 对接后端契约 /v1/manager/secrets（YUJ-3538），走 APIClient.shared 复用
 * 统一鉴权 / Accept-Language / X-Space-Id 注入，不另起 axios/fetch 实例。
 */
export default class SecretsService {
  private constructor() {}
  public static shared = new SecretsService();

  private static readonly BASE = "/manager/secrets";

  /** 列表：只返掩码元数据，永不含明文/密文 */
  async list(): Promise<SecretListItem[]> {
    const resp = await APIClient.shared.get<SecretListResponse | SecretListItem[]>(
      SecretsService.BASE
    );
    return SecretsService.normalizeList(resp);
  }

  /** 新增：明文直达后端加密存储 */
  async create(req: CreateSecretRequest): Promise<SecretListItem> {
    return APIClient.shared.post(SecretsService.BASE, req);
  }

  /** 更新：换 key（动态改 key）或改名，secret_id / 引用不变 */
  async update(secretId: string, req: UpdateSecretRequest): Promise<SecretListItem> {
    return APIClient.shared.put(
      `${SecretsService.BASE}/${encodeURIComponent(secretId)}`,
      req
    );
  }

  async remove(secretId: string): Promise<void> {
    await APIClient.shared.delete(
      `${SecretsService.BASE}/${encodeURIComponent(secretId)}`
    );
  }

  /**
   * 归一化后端列表响应（Jerry-Xin/lml2468 P0-2）：
   * - 实测契约（YUJ-3538）返回 `{ secrets: [...] }`；兼容 list/items 别名与裸数组。
   * - 额外兜底一层 `data` 信封：`{ data: { secrets: [...] } }` / `{ data: [...] }`，
   *   以防网关/中间件统一加 envelope。先剥 data 再按 secrets/list/items/数组解。
   * - **显式字段白名单**（P0-2 必修）：绝不 `...it` 透传后端响应。TS 接口只在编译期
   *   收窄，运行时多余 key（如后端回归误带的 value/plaintext/ciphertext/key/secret_value）
   *   会照样进 React state，被 Sentry 面包屑 / devtool 快照 / 误 JSON.stringify 泄漏。
   *   service normalizer 的职责就是防后端回归——只挑 write-only 契约允许的字段，其余全丢。
   * - 为缺 masked 的项用 last4 兜底拼出掩码串。
   */
  static normalizeList(resp: SecretListResponse | SecretListItem[] | null | undefined): SecretListItem[] {
    if (!resp) return [];
    // 先剥可能存在的 data 信封（仅当 resp 是对象且带 data 字段时）。
    let body: SecretListResponse | SecretListItem[] = resp;
    if (!Array.isArray(body) && body.data != null) {
      body = body.data;
    }
    const raw: SecretListItem[] = Array.isArray(body)
      ? body
      : body.items ?? body.secrets ?? body.list ?? [];
    return raw.map((it) => SecretsService.pickListItem(it));
  }

  /**
   * 从一条后端原始 item 里**只**挑出 write-only 契约允许的字段，其余（含任何明文/密文
   * 字段，如 value/plaintext/ciphertext/key/secret_value）一律丢弃，再补算 masked。
   * 这是运行时的最后一道防泄漏白名单，不依赖后端永远正确。
   */
  private static pickListItem(it: SecretListItem): SecretListItem {
    const safe: SecretListItem = {
      secret_id: it.secret_id,
      display_name: it.display_name,
      kind: it.kind,
      created_at: it.created_at,
      masked: it.masked ?? SecretsService.maskFromLast4(it.last4),
    };
    if (it.last4 != null) safe.last4 = it.last4;
    if (it.updated_at != null) safe.updated_at = it.updated_at;
    // last_used_at 允许 null（从未使用）——显式保留 null 与缺省的区别。
    if (it.last_used_at !== undefined) safe.last_used_at = it.last_used_at;
    return safe;
  }

  /** 用尾4位拼出展示掩码，如 "••••a1b2"。无 last4 时返回通用掩码。 */
  static maskFromLast4(last4?: string): string {
    if (last4 && last4.length > 0) {
      return `••••${last4}`;
    }
    return "••••••••";
  }

  /**
   * 名字归一化：去首尾/重复空格 + 统一小写。
   * 与后端 normalize(display_name) 唯一性校验口径对齐（前端做实时重名预判，
   * 最终以后端 409/duplicate 错误码为准）。简繁折叠交给后端，前端不做。
   */
  static normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLowerCase();
  }
}
