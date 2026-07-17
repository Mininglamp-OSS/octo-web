import APIClient from "./APIClient";

/**
 * 群入站 Webhook（Incoming Webhook）类型与纯工具函数。
 *
 * 对应 octo-server 用户管理面 `/v1/groups/{group_no}/incoming-webhooks*`
 * （#250 iwh 身份 / #254 软删除 / #297 平台适配器 / #340 开放给成员与 bot）。
 *
 * 本文件不依赖 WKApp / WKSDK；HTTP 边界统一使用 APIClient，交互状态留给调用方。
 */

/** webhook 发送者 UID 前缀。`FromUID = iwh_*` 的消息发送者永远不是群成员。 */
export const INCOMING_WEBHOOK_UID_PREFIX = "iwh_";

/** webhook 状态：0=禁用，1=启用，2=已删除（软删，不出现在 list） */
export const IncomingWebhookStatus = {
    disabled: 0,
    enabled: 1,
    deleted: 2,
} as const;

/** webhook 元信息（list / update 返回，不含 token） */
export interface IncomingWebhook {
    webhook_id: string;
    group_no: string;
    name: string;
    /** 成员 / bot 创建的 webhook 恒为空字符串 */
    avatar: string;
    /** 创建者 uid / robot_id，与当前操作者比对判断「是否我创建的」 */
    creator_uid: string;
    status: number;
    /** 最近一次 native 推送的 Unix 秒；从未使用为 0 */
    last_used_at: number;
    /** 累计 native 推送次数（test 推送不计） */
    call_count: number;
    /** 创建时间 Unix 秒 */
    created_at: number;
    /** 是否放行该 webhook 用「@所有人」：0/1，表单开关回显（缺省视为 0） */
    allow_mention_all?: number;
    /** 是否放行该 webhook 用「@所有AI」：0/1，表单开关回显（缺省视为 0） */
    allow_mention_bots?: number;
    /**
     * 每次推送自动 @ 的成员/bot uid 列表（#465）。回显恒为数组（无配置=[]）；
     * 老后端不返回该键（undefined），调用方按「未配置」即空数组处理。
     */
    mention_uids?: string[];
    /**
     * 该 webhook 绑定投递的子区 short_id（#451 / octo-server #454）。仅子区 webhook 非空，
     * 群 webhook 不返回（undefined，后端 omitempty）。创建时绑定、之后不可改；不影响推送 URL
     * （仍按 webhook_id/token）。
     */
    thread_short_id?: string;
}

/**
 * 各适配器的推送 URL（服务端返回相对路径，自带 /v1 前缀）。
 * native/github/wecom 为既有形态；gitlab/feishu/multica 为新增（现网 main）。
 */
export interface IncomingWebhookUrls {
    native?: string;
    github?: string;
    wecom?: string;
    gitlab?: string;
    feishu?: string;
    multica?: string;
}

/**
 * 适配器接入示例的鉴权说明（octo-server #475）。
 * - `url_token`：token 已在 URL 中，无需额外 header。
 * - `url_token_and_header`：URL 带 token，另需在目标平台填一个 header（如 GitLab 的
 *   `X-Gitlab-Token`）。`value_source = "token"` 表示该 header 的值就是本次响应的 token。
 */
export interface IncomingWebhookAdapterAuth {
    type: string;
    /** 需要额外 header 时的 header 名（如 `X-Gitlab-Token`）；服务端下发，前端不写死。 */
    header?: string;
    /** header 值来源；目前为 `"token"`（取本次响应的明文 token）。 */
    value_source?: string;
}

/**
 * 「更多适配器」接入示例（octo-server #475，仅 create/regenerate 响应返回）。
 *
 * 文案（title/description/steps）由服务端按语言协商本地化，前端直接渲染、不再写死；
 * `key` 刻意用开放 `string`：后端将来新增适配器时前端无需发版即可兼容渲染。
 * `url` 为相对路径（不含 host），前端按既有逻辑拼接 base（见 {@link buildWebhookAdapterExamples}）。
 */
export interface IncomingWebhookAdapterExample {
    key: string;
    title: string;
    description: string;
    /** 相对路径，不含 host */
    url: string;
    content_type: string;
    auth: IncomingWebhookAdapterAuth;
    /** 已是分步数组，前端按列表展示，不需自行按换行拆分 */
    steps: string[];
}

/** 创建 / 重置 token 的响应。明文 token 与推送 URL 仅此一次返回。 */
export interface IncomingWebhookCreateResp extends IncomingWebhook {
    token: string;
    url: string;
    urls?: IncomingWebhookUrls;
    /**
     * 「更多适配器」本地化接入示例（octo-server #475）。仅 create/regenerate 返回，
     * list 不回显；老后端（#475 之前）不返回此键（undefined），调用方需有兜底渲染。
     * native 不在其中（它是默认推送地址，单独在顶部展示）。
     */
    adapter_examples?: IncomingWebhookAdapterExample[];
}

/** 创建 / 更新请求体。留空字段不要传（成员传 avatar 会被服务端 400 拒绝）。 */
export interface IncomingWebhookUpsertReq {
    name?: string;
    avatar?: string;
    status?: number;
    /** ★放行该 webhook 用「@所有人」（*bool，缺省 false）。能管理该 webhook 者均可设置。 */
    allow_mention_all?: boolean;
    /** ★放行该 webhook 用「@所有AI」（*bool，缺省 false）。能管理该 webhook 者均可设置。 */
    allow_mention_bots?: boolean;
    /**
     * ★#465：每次推送自动 @ 的成员/bot uid 列表。
     * create：非空才发；update：不传=不动，传 `[]` = 显式清空（改为不 @）。
     */
    mention_uids?: string[];
}

type IncomingWebhookListResponse =
    | IncomingWebhook[]
    | { list?: IncomingWebhook[]; items?: IncomingWebhook[]; webhooks?: IncomingWebhook[] }
    | null
    | undefined;

/** 群/子区入站 Webhook 的 HTTP 边界。 */
export const IncomingWebhookService = {
    basePath(groupNo: string, threadShortId?: string): string {
        const groupPath = `groups/${encodeURIComponent(groupNo)}`;
        return threadShortId
            ? `${groupPath}/threads/${encodeURIComponent(threadShortId)}/incoming-webhooks`
            : `${groupPath}/incoming-webhooks`;
    },

    async list(groupNo: string, threadShortId?: string): Promise<IncomingWebhook[]> {
        const response = await APIClient.shared.get<IncomingWebhookListResponse>(
            this.basePath(groupNo, threadShortId)
        );
        if (Array.isArray(response)) return response;
        if (!response) return [];
        return response.list || response.items || response.webhooks || [];
    },

    create(groupNo: string, request: IncomingWebhookUpsertReq, threadShortId?: string): Promise<IncomingWebhookCreateResp> {
        return APIClient.shared.post(this.basePath(groupNo, threadShortId), request);
    },

    update(groupNo: string, webhookId: string, request: IncomingWebhookUpsertReq, threadShortId?: string): Promise<IncomingWebhook> {
        return APIClient.shared.put(`${this.basePath(groupNo, threadShortId)}/${encodeURIComponent(webhookId)}`, request);
    },

    delete(groupNo: string, webhookId: string, threadShortId?: string): Promise<void> {
        return APIClient.shared.delete(`${this.basePath(groupNo, threadShortId)}/${encodeURIComponent(webhookId)}`);
    },

    regenerate(groupNo: string, webhookId: string, threadShortId?: string): Promise<IncomingWebhookCreateResp> {
        return APIClient.shared.post(`${this.basePath(groupNo, threadShortId)}/${encodeURIComponent(webhookId)}/regenerate`);
    },

    test(groupNo: string, webhookId: string, threadShortId?: string): Promise<void> {
        return APIClient.shared.post(`${this.basePath(groupNo, threadShortId)}/${encodeURIComponent(webhookId)}/test`);
    },
};

/**
 * 权限判断（与服务端权限矩阵 #340 对齐，仅做 UI 门控，服务端兜底）：
 * 群主/管理员可管理任意 webhook；普通成员仅能管理自己创建的。
 */
export function canManageIncomingWebhook(
    item: Pick<IncomingWebhook, "creator_uid">,
    opts: { isManager: boolean; myUid?: string }
): boolean {
    if (opts.isManager) return true;
    return !!opts.myUid && item.creator_uid === opts.myUid;
}

/**
 * 是否允许对该 webhook 执行「测试推送」（纯函数，便于单测钉死三态）。
 *
 * 仅 enabled 可测：test 走管理面、绕开推送面的 enabled 检查，对 disabled / deleted
 * 的 webhook 仍会向群内发真实消息，且「测试成功」会对一个真实推送被 401 挡掉的
 * webhook 给出假信心。与「禁用=不再发消息」的语义保持一致。
 */
export function canTestWebhook(item: Pick<IncomingWebhook, "status">): boolean {
    return item.status === IncomingWebhookStatus.enabled;
}

/** mention_uids 数量上限（与服务端 DM_INCOMINGWEBHOOK_MAX_MENTION_UIDS 默认值对齐）。 */
export const MENTION_UIDS_MAX = 50;
/** 单个 mention uid 字符数上限（服务端校验）。 */
export const MENTION_UID_MAX_LENGTH = 40;

/**
 * 归一化后端 0/1 能力位到 boolean。后端不同节点可能把 tinyint(1) 序列化成
 * 数字 `1`、布尔 `true` 或字符串 `"1"`/`"true"`（与 displayName 实名位同源的序列化
 * 漂移）；只比较 `=== 1` 会把这些读成「关」，导致开关回显错误、保存时静默清权限、
 * 或 AI 徽章漏标。统一收敛 truthy 形态。
 */
export function isFlagOn(v: unknown): boolean {
    return v === 1 || v === true || v === "1" || v === "true";
}

/** 规整 mention_uids：trim、丢空、按首次出现去重（保持选择顺序）。 */
export function normalizeMentionUids(uids: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of uids) {
        const uid = (raw ?? "").trim();
        if (!uid || seen.has(uid)) continue;
        seen.add(uid);
        out.push(uid);
    }
    return out;
}

/**
 * 校验 mention_uids（前端即时反馈，服务端仍兜底）：去重后数量 ≤ {@link MENTION_UIDS_MAX}、
 * 单个 uid 长度 ≤ {@link MENTION_UID_MAX_LENGTH}。
 *
 * 成员资格不在此校验：前端无权威成员名册，候选由选择器限定为本群成员，
 * 退群等边界由服务端 400 `reason=mention_uids` / 推送时成员闸兜底。
 */
export function validateMentionUids(
    uids: readonly string[]
): { ok: true; uids: string[] } | { ok: false; reason: "tooMany" | "tooLong" } {
    const normalized = normalizeMentionUids(uids);
    if (normalized.length > MENTION_UIDS_MAX) {
        return { ok: false, reason: "tooMany" };
    }
    if (normalized.some((uid) => uid.length > MENTION_UID_MAX_LENGTH)) {
        return { ok: false, reason: "tooLong" };
    }
    return { ok: true, uids: normalized };
}

/** 两个 uid 集合是否等价（忽略顺序与重复）。 */
function sameMentionUids(a: readonly string[], b: readonly string[]): boolean {
    const sa = new Set(a);
    const sb = new Set(b);
    if (sa.size !== sb.size) return false;
    for (const x of sa) if (!sb.has(x)) return false;
    return true;
}

/**
 * 构造 webhook 新建 / 编辑请求体（纯函数，便于单测钉死易错边界）。
 *
 * 规则（与服务端契约对齐）：
 * - 名称 / 头像先 trim；
 * - 头像仅 `isManager` 才发（普通成员带 avatar 会被服务端 400 拒绝）；
 * - `allow_mention_all` / `allow_mention_bots` 能力位：能管理该 webhook 者（管理员 /
 *   自己创建）均可开关，不受 `isManager` 门控（与头像不同）。请求体发 *bool，
 *   服务端响应回显 0/1；
 * - `mention_uids`（#465）：每次推送自动 @ 的成员/bot。先 {@link normalizeMentionUids}
 *   去重；create 非空才发；edit 与原回显按集合对比，变化才发——**含改为空数组**
 *   （`[]` 是服务端约定的「显式清空」语义）；
 * - 编辑态只发「有值且与原值不同」的字段，无任何变化时返回 `null`
 *   —— 调用方据此直接关闭弹窗、不发请求；
 * - 新建态名称有值才发（留空由服务端自动命名），能力位仅 true 时附带
 *   （缺省 false，不必显式发），始终返回对象（可为空 `{}`）。
 */
export function buildWebhookUpsertReq(opts: {
    isEdit: boolean;
    isManager: boolean;
    name: string;
    avatar: string;
    /** 「@所有人」开关当前值（缺省视为关闭） */
    mentionAll?: boolean;
    /** 「@所有AI」开关当前值（缺省视为关闭） */
    mentionBots?: boolean;
    /** 自动 @ 成员/bot 当前选择（缺省视为空） */
    mentionUids?: string[];
    webhook?: Pick<
        IncomingWebhook,
        "name" | "avatar" | "allow_mention_all" | "allow_mention_bots" | "mention_uids"
    >;
}): IncomingWebhookUpsertReq | null {
    const trimmedName = opts.name.trim();
    const trimmedAvatar = opts.avatar.trim();
    const mentionAll = !!opts.mentionAll;
    const mentionBots = !!opts.mentionBots;
    const mentionUids = normalizeMentionUids(opts.mentionUids ?? []);
    const req: IncomingWebhookUpsertReq = {};

    if (opts.isEdit && opts.webhook) {
        if (trimmedName && trimmedName !== opts.webhook.name) {
            req.name = trimmedName;
        }
        if (opts.isManager && trimmedAvatar !== (opts.webhook.avatar || "")) {
            req.avatar = trimmedAvatar;
        }
        // 能力位逐个对比原回显（归一化 0/1/true/"1" → bool），仅在变化时下发。
        if (mentionAll !== isFlagOn(opts.webhook.allow_mention_all)) {
            req.allow_mention_all = mentionAll;
        }
        if (mentionBots !== isFlagOn(opts.webhook.allow_mention_bots)) {
            req.allow_mention_bots = mentionBots;
        }
        // mention_uids 与原回显按集合对比；变化才发（含清空为 []）。
        const originalUids = normalizeMentionUids(opts.webhook.mention_uids ?? []);
        if (!sameMentionUids(mentionUids, originalUids)) {
            req.mention_uids = mentionUids;
        }
        // 无任何变化 → 不发请求
        return Object.keys(req).length === 0 ? null : req;
    }

    if (trimmedName) req.name = trimmedName;
    if (opts.isManager && trimmedAvatar) req.avatar = trimmedAvatar;
    // 缺省 false，仅 true 时附带，保持请求体精简。
    if (mentionAll) req.allow_mention_all = true;
    if (mentionBots) req.allow_mention_bots = true;
    // 新建态仅非空才发（[] 与不发等价：都=不 @）。
    if (mentionUids.length > 0) req.mention_uids = mentionUids;
    return req;
}

/**
 * 把服务端返回的相对推送路径（如 `/v1/incoming-webhooks/{id}/{token}`）
 * 拼成可直接复制给外部服务的绝对 URL。
 *
 * 难点：前端 `apiURL` 形如 `/api/v1/`（生产经 Nginx 代理），而服务端返回的
 * 相对路径自带 `/v1` 前缀 —— 直接拼接会出现重复的 `/v1`，这里先剥掉
 * base 末尾的版本段再拼。
 */
export function buildIncomingWebhookUrl(
    relativeUrl: string,
    apiURL: string,
    origin: string
): string {
    if (!relativeUrl) return "";
    // 服务端未来直接返回绝对地址时原样透传
    if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
    let abs: URL;
    try {
        abs = new URL(apiURL || "/", origin);
    } catch {
        return "";
    }
    let basePath = abs.pathname.replace(/\/v1\/?$/, "/");
    if (basePath.endsWith("/")) basePath = basePath.slice(0, -1);
    const rel = relativeUrl.startsWith("/") ? relativeUrl : `/${relativeUrl}`;
    return `${abs.origin}${basePath}${rel}`;
}

/**
 * canonical 推送路径里的「入站 webhook」段。服务端 publicURL/publicURLs 始终广告这一形态
 * —— octo-server #456 刻意保持向后兼容，不在响应里返回短别名。
 */
const CANONICAL_WEBHOOK_SEGMENT = "/v1/incoming-webhooks/";
/**
 * 等价的短别名段（octo-server #455/#456）：`/v1/webhooks/{id}/{token}[/adapter]` 与 canonical
 * 共用同一套 handler / 中间件链 / 限流桶，access-log token 脱敏也对两个前缀做了 parity。
 */
const SHORT_WEBHOOK_SEGMENT = "/v1/webhooks/";

/**
 * 把 canonical 推送地址改写成更短的 `/v1/webhooks` 别名，用于推送地址弹窗的展示 / 复制
 * （octo-web #452）。仅替换首个 `/v1/incoming-webhooks/` 段，webhook_id / token / 适配器
 * 后缀 / query 一律原样保留。
 *
 * - 幂等且前向兼容：地址已是 `/v1/webhooks/` 形态、或根本不含 canonical 段时原样返回——
 *   将来后端若直接返回短别名也不会被二次改写（正好覆盖 issue 里「if/when the backend
 *   returns it」）。
 * - 只匹配 `/v1/incoming-webhooks/` 这一精确前缀，不会误伤管理面
 *   `/v1/groups/{group_no}/incoming-webhooks`（其 `incoming-webhooks` 前不是 `/v1/`）。
 * - 纯字符串改写，相对路径（`/v1/...`）与绝对地址（`https://host/api/v1/...`）皆可用：
 *   用 indexOf 定位、只替换一次，避免误伤路径里其它同名子串。
 */
export function toShortWebhookAlias(url: string): string {
    if (!url) return url;
    const idx = url.indexOf(CANONICAL_WEBHOOK_SEGMENT);
    if (idx < 0) return url;
    return (
        url.slice(0, idx) +
        SHORT_WEBHOOK_SEGMENT +
        url.slice(idx + CANONICAL_WEBHOOK_SEGMENT.length)
    );
}

/** 一次性推送地址弹窗里的一行（一个适配器） */
export interface WebhookUrlRow {
    key: "native" | "github" | "wecom" | "gitlab" | "feishu" | "multica";
    /** i18n key 后缀，调用方自行拼 `base.` 前缀 */
    labelKey: string;
    url: string;
}

/**
 * 由 create/regenerate 响应构造一次性推送地址列表（纯函数，便于单测）。
 *
 * 决策点：native 适配器优先用 `urls.native`，回退到顶层 `url`（旧契约只给 `url`）；
 * 其余适配器（github / gitlab / wecom / feishu / multica）仅在响应提供对应
 * `urls.*` 时出现；最终过滤掉空地址，故老后端不返回的适配器自动不展示。
 *
 * 展示偏好（octo-web #452 / octo-server #456）：后端返回的仍是 canonical
 * `/v1/incoming-webhooks/...`，这里统一经 {@link toShortWebhookAlias} 改写成更短的等价
 * 别名 `/v1/webhooks/...` 再展示 / 复制。两条路径服务端完全等价（同 handler / 中间件 /
 * 限流，日志 token 脱敏亦 parity），故纯属展示层变更，不改请求契约。
 */
export function buildWebhookUrlRows(
    resp: Pick<IncomingWebhookCreateResp, "url" | "urls">,
    apiURL: string,
    origin: string
): WebhookUrlRow[] {
    const abs = (rel?: string): string =>
        rel ? buildIncomingWebhookUrl(toShortWebhookAlias(rel), apiURL || "/", origin) : "";
    // 显式标注元素类型：让各 key 字面量被钉到 WebhookUrlRow["key"] 联合（否则数组字面量里
    // key 会被拓宽成 string，filter 后整体不可赋值给 WebhookUrlRow[]）。
    const rows: WebhookUrlRow[] = [
        { key: "native", labelKey: "channelWebhook.url.native", url: abs(resp.urls?.native || resp.url) },
        { key: "github", labelKey: "channelWebhook.url.github", url: abs(resp.urls?.github) },
        { key: "gitlab", labelKey: "channelWebhook.url.gitlab", url: abs(resp.urls?.gitlab) },
        { key: "wecom", labelKey: "channelWebhook.url.wecom", url: abs(resp.urls?.wecom) },
        { key: "feishu", labelKey: "channelWebhook.url.feishu", url: abs(resp.urls?.feishu) },
        { key: "multica", labelKey: "channelWebhook.url.multica", url: abs(resp.urls?.multica) },
    ];
    return rows.filter((row) => !!row.url);
}

/** 「更多适配器」示例卡片的展示行（URL 已拼成可复制的绝对地址）。 */
export interface WebhookAdapterExampleRow {
    key: string;
    title: string;
    description: string;
    /** 经短别名改写 + base 拼接后的展示绝对地址（不可复制项已被过滤） */
    url: string;
    contentType: string;
    auth: IncomingWebhookAdapterAuth;
    steps: string[];
}

/**
 * 由 create/regenerate 响应的 `adapter_examples` 构造「更多适配器」展示行（纯函数，便于单测）。
 *
 * 与 {@link buildWebhookUrlRows} 共用同一套 URL 处理：相对 `url` 先经 {@link toShortWebhookAlias}
 * 改写成短别名（octo-web #452），再用 {@link buildIncomingWebhookUrl} 拼 base。
 *
 * 健壮性（信任边界：响应是外部数据）：
 * - 缺失 / 空数组 → 返回 `[]`（老后端 #475 之前不下发该字段，调用方据此走兜底渲染）；
 * - 跳过无 `key` 或拼接后 URL 为空的条目（无可复制地址的卡片无意义）；
 * - 文案 / steps 仅采信 string，非字符串（数字 / 对象等脏数据）一律按缺省处理，
 *   绝不在 `.trim()` / `toShortWebhookAlias` 上抛错——本函数在弹窗 render 时调用，
 *   一旦抛错会连带一次性 token 弹窗整体崩掉、token 再也取不回；
 * - 文案 trim，steps 丢空行；`auth` 仅采信对象，否则兜底为 `{ type: "" }`。
 * - 不对 `key` 做白名单过滤：未知适配器同样渲染，后端新增适配器时前端无需发版。
 */
export function buildWebhookAdapterExamples(
    resp: Pick<IncomingWebhookCreateResp, "adapter_examples">,
    apiURL: string,
    origin: string
): WebhookAdapterExampleRow[] {
    const examples = resp.adapter_examples;
    if (!Array.isArray(examples) || examples.length === 0) return [];
    // 仅对 string 做 trim，其余类型按空串处理（脏数据不抛错）。
    const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    return examples
        .filter((ex): ex is IncomingWebhookAdapterExample => !!ex && typeof ex.key === "string" && ex.key.length > 0)
        .map((ex) => ({
            key: ex.key,
            title: text(ex.title),
            description: text(ex.description),
            url:
                typeof ex.url === "string" && ex.url
                    ? buildIncomingWebhookUrl(toShortWebhookAlias(ex.url), apiURL || "/", origin)
                    : "",
            contentType: typeof ex.content_type === "string" ? ex.content_type : "",
            auth: ex.auth && typeof ex.auth === "object" ? ex.auth : { type: "" },
            steps: Array.isArray(ex.steps)
                ? ex.steps.map(text).filter((s) => s.length > 0)
                : [],
        }))
        .filter((row) => !!row.url);
}

/** push 消息 payload 里的发送者展示身份（DeliveredMessagePayload.from） */
export interface WebhookMessageFrom {
    kind?: string;
    webhook_id?: string;
    name?: string;
    avatar?: string;
}

/** 判断消息发送者是否为 webhook 身份（iwh_* 永远不是群成员） */
export function isIncomingWebhookSender(fromUID?: string): boolean {
    return !!fromUID && fromUID.startsWith(INCOMING_WEBHOOK_UID_PREFIX);
}

/**
 * 从消息读取 webhook 展示身份。
 *
 * webhook 推送的消息 `FromUID = iwh_*`，拿它查群成员 / Person ChannelInfo
 * 一定落空（头像裂、名字空、还会对不存在的 channel 反复 fetchChannelInfo）。
 * 渲染层必须改读 payload 里的 `from.name` / `from.avatar`。
 *
 * payload.from 缺失（异常路径）时按 uid 前缀兜底识别，
 * 返回空身份让调用方降级到占位展示。
 *
 * 安全（信任边界）：webhook 身份必须以服务端权威信号 `iwh_*` UID 前缀为前置门控。
 * payload.from 是客户端可控字段（见 sendContentProxy.ts 注入、Convert.ts 透传），
 * 若仅凭 `from.kind === "webhook"` 就采信，普通成员即可伪造带「Webhook」徽章的
 * 管理员/告警消息。因此先校验 fromUID 为 iwh_*，再读 payload 的展示字段。
 */
export function webhookFromOfMessage(message: {
    fromUID?: string;
    content?: { contentObj?: { from?: unknown } };
}): WebhookMessageFrom | undefined {
    // 非 webhook 发送者（fromUID 不是 iwh_*）一律不采信 payload.from，杜绝身份伪造。
    if (!isIncomingWebhookSender(message?.fromUID)) {
        return undefined;
    }
    const from = message?.content?.contentObj?.from as
        | WebhookMessageFrom
        | undefined;
    if (from && typeof from === "object" && from.kind === "webhook") {
        return from;
    }
    return { kind: "webhook" };
}

/** V2 同款 Webhook 默认头像；服务端 avatar 为空时使用，避免走用户头像链路。 */
export const INCOMING_WEBHOOK_DEFAULT_AVATAR =
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
        `<svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">` +
            `<rect width="50" height="50" rx="12" fill="#6B3DD8"/>` +
            `<path d="M25 11v5" stroke="white" stroke-width="2.5" stroke-linecap="round"/>` +
            `<circle cx="25" cy="10" r="2" fill="white"/>` +
            `<rect x="14" y="17" width="22" height="20" rx="6" fill="none" stroke="white" stroke-width="2.8"/>` +
            `<circle cx="21" cy="27" r="2.2" fill="white"/>` +
            `<circle cx="29" cy="27" r="2.2" fill="white"/>` +
            `<path d="M20 33h10" stroke="white" stroke-width="2.5" stroke-linecap="round"/>` +
            `</svg>`
    );

/** webhook 发送者在消息行的展示属性（avatar / name / 徽章 / 头像是否可点） */
export interface WebhookRowDisplay {
    /**
     * payload.from.avatar（管理员自定义头像）；为空时调用方走用户头像链路兜底
     * （avatarUser(uid) / WKAvatar channel），与普通用户头像同源。
     */
    avatarUrl: string;
    /** payload.from.name 缺失（异常路径）时返回空串，绝不暴露 iwh_* uid */
    senderName: string;
    /** webhook 消息始终展示「Webhook」徽章 */
    showBadge: boolean;
    /** webhook 发送者无个人资料页，头像 / 名称一律不可点击 */
    avatarClickable: boolean;
}

/**
 * 把 webhook 身份翻译成消息行展示字段（纯函数）。
 *
 * legacy `Messages/Base` 栈与新 `bridge/ui` MessageRow 栈都消费同一份映射，
 * 避免「avatar 兜底 / name 兜底 / 徽章 / 头像不可点」这套规则在多处渲染路径
 * 各写一遍而随双栈架构发散。
 */
export function resolveWebhookRowDisplay(
    from: WebhookMessageFrom
): WebhookRowDisplay {
    return {
        // payload 自带头像（管理员设置）；为空交给调用方走用户头像链路兜底。
        avatarUrl: from.avatar || "",
        senderName: from.name || "",
        // 标记「这是自动推送、非真人」——头像/名字已与真人无异，徽章是唯一区分信号。
        showBadge: true,
        avatarClickable: false,
    };
}

/**
 * 构造 native / wecom 适配器的 curl 调用示例（纯函数，便于单测）。
 *
 * 关键：两种适配器 body 结构不同，不可互换（否则 push 返回 400）：
 *   - native：`{"content":"..."}`（content 按 markdown 渲染）；
 *   - wecom ：企业微信群机器人格式 `{"msgtype":"text","text":{"content":"..."}}`。
 *
 * #465 起 push body 不再解析 mention（@ 谁由 webhook 配置决定），故示例只发 content。
 *
 * 安全：刻意不带 `username` / `avatar_url`——这两个发送者覆盖字段仅当 webhook
 * 创建者当前为群管理员时才生效，对成员 / bot 创建的 webhook 一律忽略，默认带上反而误导。
 *
 * 注意：`url` 与 body 实参均以单引号包裹并对内部单引号做 POSIX 转义（`'` → `'\''`），
 * 故未来本地化样例文案 / 服务端 URL 含单引号也不会破坏复制出的命令。
 */
export function buildWebhookCurlExample(
    key: "native" | "wecom",
    url: string,
    sampleContent: string
): string {
    const body =
        key === "wecom"
            ? { msgtype: "text", text: { content: sampleContent } }
            : { content: sampleContent };
    // POSIX：单引号内无转义，故对内容里的 ' 以 '\'' 收尾再续接，保证复制出的命令安全可执行。
    const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    return [
        `curl -X POST ${shellQuote(url)} \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d ${shellQuote(JSON.stringify(body))}`,
    ].join("\n");
}
