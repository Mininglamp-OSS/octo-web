/**
 * 群入站 Webhook（Incoming Webhook）类型与纯工具函数。
 *
 * 对应 octo-server 用户管理面 `/v1/groups/{group_no}/incoming-webhooks*`
 * （#250 iwh 身份 / #254 软删除 / #297 平台适配器 / #340 开放给成员与 bot）。
 *
 * 注意：本文件刻意不依赖 WKApp / WKSDK，保持纯函数可单测；
 * 需要运行时配置（apiURL / origin）的调用方自行传入。
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
}

/** 三种适配器的推送 URL（服务端返回相对路径，自带 /v1 前缀） */
export interface IncomingWebhookUrls {
    native?: string;
    github?: string;
    wecom?: string;
}

/** 创建 / 重置 token 的响应。明文 token 与推送 URL 仅此一次返回。 */
export interface IncomingWebhookCreateResp extends IncomingWebhook {
    token: string;
    url: string;
    urls?: IncomingWebhookUrls;
}

/** 创建 / 更新请求体。留空字段不要传（成员传 avatar 会被服务端 400 拒绝）。 */
export interface IncomingWebhookUpsertReq {
    name?: string;
    avatar?: string;
    status?: number;
}

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
 * 构造 webhook 新建 / 编辑请求体（纯函数，便于单测钉死易错边界）。
 *
 * 规则（与服务端契约对齐）：
 * - 名称 / 头像先 trim；
 * - 头像仅 `isManager` 才发（普通成员带 avatar 会被服务端 400 拒绝）；
 * - 编辑态只发「有值且与原值不同」的字段，无任何变化时返回 `null`
 *   —— 调用方据此直接关闭弹窗、不发请求；
 * - 新建态名称有值才发（留空由服务端自动命名），始终返回对象（可为空 `{}`）。
 */
export function buildWebhookUpsertReq(opts: {
    isEdit: boolean;
    isManager: boolean;
    name: string;
    avatar: string;
    webhook?: Pick<IncomingWebhook, "name" | "avatar">;
}): IncomingWebhookUpsertReq | null {
    const trimmedName = opts.name.trim();
    const trimmedAvatar = opts.avatar.trim();
    const req: IncomingWebhookUpsertReq = {};

    if (opts.isEdit && opts.webhook) {
        if (trimmedName && trimmedName !== opts.webhook.name) {
            req.name = trimmedName;
        }
        if (opts.isManager && trimmedAvatar !== (opts.webhook.avatar || "")) {
            req.avatar = trimmedAvatar;
        }
        // 无任何变化 → 不发请求
        return Object.keys(req).length === 0 ? null : req;
    }

    if (trimmedName) req.name = trimmedName;
    if (opts.isManager && trimmedAvatar) req.avatar = trimmedAvatar;
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

/** 一次性推送地址弹窗里的一行（一个适配器） */
export interface WebhookUrlRow {
    key: "native" | "github" | "wecom";
    /** i18n key 后缀，调用方自行拼 `base.` 前缀 */
    labelKey: string;
    url: string;
}

/**
 * 由 create/regenerate 响应构造一次性推送地址列表（纯函数，便于单测）。
 *
 * 决策点：native 适配器优先用 `urls.native`，回退到顶层 `url`（旧契约只给 `url`）；
 * github / wecom 仅在响应提供对应 `urls.*` 时出现；最终过滤掉空地址。
 */
export function buildWebhookUrlRows(
    resp: Pick<IncomingWebhookCreateResp, "url" | "urls">,
    apiURL: string,
    origin: string
): WebhookUrlRow[] {
    const abs = (rel?: string): string =>
        rel ? buildIncomingWebhookUrl(rel, apiURL || "/", origin) : "";
    return [
        { key: "native", labelKey: "channelWebhook.url.native", url: abs(resp.urls?.native || resp.url) },
        { key: "github", labelKey: "channelWebhook.url.github", url: abs(resp.urls?.github) },
        { key: "wecom", labelKey: "channelWebhook.url.wecom", url: abs(resp.urls?.wecom) },
    ].filter((row) => !!row.url);
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

/**
 * webhook 消息 / 列表项的占位头像（内联 SVG，灰底链接节点图形）。
 * 服务端不给 iwh_* 提供头像接口，空 avatar 时用它避免 broken-image。
 */
export const INCOMING_WEBHOOK_DEFAULT_AVATAR =
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
        `<svg width="50" height="50" xmlns="http://www.w3.org/2000/svg">` +
            `<rect width="50" height="50" rx="12" fill="#E8EAF0"/>` +
            `<path d="M20 30 L30 20 M27 17 a5 5 0 0 1 7 7 l-2.5 2.5 M23 33 a5 5 0 0 1 -7 -7 l2.5 -2.5" ` +
            `stroke="#7A8299" stroke-width="2.6" stroke-linecap="round" fill="none"/>` +
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
