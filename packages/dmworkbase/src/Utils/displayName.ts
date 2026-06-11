/**
 * displayName - 展示名解析工具
 *
 * dmwork-web GH #1121：接入 OCTO 实名认证后，所有需要展示用户
 * 名称的位置都应该经过本工具，以统一处理「真实姓名覆盖昵称」的优先级。
 *
 * 优先级（从高到低）：
 *   1. `real_name`     —— 仅当 `realname_verified === true` 时生效（已实名认证）
 *   2. `remark`        —— 查看者本地给对方设置的备注名（好友备注）
 *   3. `name`          —— 用户自设的昵称（默认）
 *
 * 实名优先：经过 OCTO 实名认证的真实姓名是最可信的身份信号，应当压过
 * 本地备注与自设昵称，统一对齐外部混合身份群场景下「认准真人」的诉求。
 *
 * 字段来源：
 *   - `users/{uid}` profile API 返回扁平字段 realname_verified / real_name
 *   - 前端 Convert.userToChannelInfo 会把它们 spread 到 `channelInfo.orgData`
 *     并同步计算 `orgData.displayName` 供消费方直接读取
 *
 * 备注：
 *   - 实名认证状态除了作为名称优先级信号外，现在还会在**聊天气泡作者名旁 +
 *     群成员列表每行 + 个人资料页**展示迷你 ✓ 图标（`<RealnameVerifiedBadge
 *     variant="icon" />`）。2026-05-10 Epic dmwork-web#1169 解除了
 *     GH #1121 原先「UI 层面不在每个展示点加 ✓ 勾」的硬约束：实名
 *     比例只有约 20%，在外部群混合身份场景下它是差异化信号而非噪音。
 *   - 当前仍不展示徽章的位置（Phase B）：@mention 联想下拉 / 联系人列表 /
 *     已读列表 / 会话列表（见 Epic dmwork-web#1169 "不在范围"）。
 *   - 任何新的名称展示点（聊天气泡 / 群成员 / @mention / 已读列表 ...）
 *     都应当消费 `orgData.displayName` 或本工具，而非直接读 `user.name`，
 *     并使用 `isRealnameVerified()` 判断是否渲染徽章。
 */
export interface DisplayNameUser {
    name?: string | null;
    real_name?: string | null;
    realname_verified?: boolean | number | string | null;
    remark?: string | null;
}

function nonEmpty(v: string | null | undefined): v is string {
    return typeof v === "string" && v.length > 0;
}

/**
 * 归一化 realname_verified 到严格 boolean。
 *
 * 后端序列化偏差（不同节点 / 老接口）可能把 tinyint(1) 投射成
 * 字符串 `"1"` 或 `"true"`；如果只比较 `=== true` / `=== 1`，这些场景会
 * 被误判为「未实名」，导致徽章不渲染 / real_name 降级。这里把所有形如
 * truthy 的实名值统一收敛到 true。
 *
 * 接受：true, 1, "1", "true"（大小写敏感，后端约定只会给小写；如果
 * 后续发现 "True" 等变体再加 toLowerCase，保持当前实现贴合实际载荷）。
 */
function normalizeVerified(v: boolean | number | string | null | undefined): boolean {
    return v === true || v === 1 || v === "1" || v === "true";
}

export function displayName(user: DisplayNameUser | null | undefined): string {
    if (!user) return "";
    // realname_verified 兼容 bool / 1 / 0 / "1" / "true"
    const verified = normalizeVerified(user.realname_verified);
    if (verified && nonEmpty(user.real_name)) return user.real_name;
    if (nonEmpty(user.remark)) return user.remark;
    return nonEmpty(user.name) ? user.name : "";
}

/**
 * 判断某个 profile 是否已完成实名认证。
 * orgData 场景通常用 realname_verified === 1；以后端决定值的真假逻辑为准。
 *
 * 兼容字符串 `"1"` / `"true"`（后端不同节点序列化偏差），避免
 * 因类型不一致导致徽章不渲染。
 */
export function isRealnameVerified(user: DisplayNameUser | null | undefined): boolean {
    if (!user) return false;
    return normalizeVerified(user.realname_verified);
}

/**
 * 从群成员（Subscriber）对象里提取展示名。
 *
 * Subscriber 的 `name` / `remark` 是平铺字段，`real_name` / `realname_verified`
 * 在 orgData 里（后端 enrich）。本函数把两边的字段合并后交给 displayName
 * 统一按 real_name(verified) → remark → name 的优先级返回。
 *
 * 用于群消息发送者名字的主路径（比 Person ChannelInfo 命中率高得多，
 * 特别是仅在群里出现、没开过 1v1 的用户）。
 */
export interface SubscriberLike {
    name?: string | null;
    remark?: string | null;
    orgData?: { real_name?: string | null; realname_verified?: boolean | number | string | null } | null;
}

export function subscriberDisplayName(sub: SubscriberLike | null | undefined): string {
    if (!sub) return "";
    return displayName({
        name: sub.name,
        remark: sub.remark,
        real_name: sub.orgData?.real_name,
        realname_verified: sub.orgData?.realname_verified,
    });
}

export interface PersonalRemarkChannelInfoLike {
    title?: string | null;
    orgData?: {
        displayName?: string | null;
        remark?: string | null;
    } | null;
}

/**
 * 从 Person ChannelInfo 中提取“个人备注”展示名。
 *
 * 群消息默认优先读 subscriber，避免群内陌生成员频繁单查 Person
 * channelInfo；但当用户已经给对方设置了个人备注时，个人备注应覆盖群成员名。
 */
export function personalRemarkDisplayName(
    channelInfo: PersonalRemarkChannelInfoLike | null | undefined
): string {
    const remark = channelInfo?.orgData?.remark;
    if (typeof remark !== "string" || remark.trim() === "") {
        return "";
    }
    return channelInfo?.orgData?.displayName || remark;
}
