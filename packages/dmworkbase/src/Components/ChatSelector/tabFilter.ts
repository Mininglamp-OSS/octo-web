/**
 * 会话选择器（转发 / 智能纪要共用）的四 Tab 过滤逻辑。
 *
 * 抽成与具体 item 结构无关的纯函数：调用方通过 accessors 提供「读取 id / 名称 /
 * 类型 / 父群 id / 复合 key」的方式，本模块不感知 ForwardItem 或 ChatCandidate。
 * 这样转发路径与纪要路径共享同一套 Tab 作用域 + 关键字过滤语义（概念一致：
 * 一套选择 UX，一处维护）。
 *
 * Tab 语义（对齐 dmworksummary/ChatSelectorModal）：
 *   - followed 关注：仅复合 key 命中关注集合的项（群/子区/私聊皆可）。
 *   - recent   最近：仅复合 key 命中最近集合的项，保持输入顺序（调用方已按时间排好）。
 *   - group    全部群聊：群 + 子区（子区嵌套在父群下），不含私聊。
 *   - direct   全部私聊：仅私聊。
 *
 * 关键字过滤（方案 A，与既有转发逻辑一致）：
 *   命中子区时把其父群一并带出；命中父群不强制展开其全部子区。
 *   父群仅从「当前 Tab 作用域内」带出，避免跨 Tab 泄漏不该出现的群。
 */

export type ChatSelectorTab = "followed" | "recent" | "group" | "direct"

export type ChatKind = "group" | "thread" | "direct"

export interface ChatSelectorAccessors<T> {
  /** 稳定唯一 id（转发用 channelID，纪要用 chat_id）；用于父子匹配与去重。 */
  getId(item: T): string
  /** 显示名，用于关键字匹配。 */
  getName(item: T): string
  /** 归类：群 / 子区 / 私聊。 */
  getKind(item: T): ChatKind
  /** 子区父群的 id（对应父群 entry 的 getId）；仅子区有意义，缺失返回 undefined。 */
  getParentId(item: T): string | undefined
  /** 复合 key（${type}::${id}），用于关注/最近集合匹配，防跨类型 id 碰撞。 */
  getKey(item: T): string
  /** 由父群原始 id 构造「群类型」复合 key。父群恒为群，故带出父群时须以群类型 key
   *  匹配，而非复用子区自身的 key，否则会退化成裸 id 比较、跨类型碰撞。 */
  getGroupKeyFromId(parentId: string): string
}

export interface ChatSelectorFilterOptions {
  activeTab: ChatSelectorTab
  keyword: string
  /** 关注集合（复合 key）。 */
  followedKeys: Set<string>
  /** 最近集合（复合 key）。 */
  recentKeys: Set<string>
}

/** 按 Tab 把整表收敛到当前作用域，保持传入顺序（转发列表已是「父群→子区」树序）。 */
function scopeByTab<T>(
  items: T[],
  opts: ChatSelectorFilterOptions,
  acc: ChatSelectorAccessors<T>,
): T[] {
  switch (opts.activeTab) {
    case "followed":
      return items.filter((i) => opts.followedKeys.has(acc.getKey(i)))
    case "recent":
      return items.filter((i) => opts.recentKeys.has(acc.getKey(i)))
    case "direct":
      return items.filter((i) => acc.getKind(i) === "direct")
    case "group":
    default:
      return items.filter((i) => acc.getKind(i) !== "direct")
  }
}

/**
 * 先按 Tab 收敛，再按关键字过滤（方案 A：命中子区带出父群；命中父群不展开子区）。
 * 返回结果保持传入顺序，从而保留「父群紧跟其子区」的树状排布。
 */
export function filterChatSelectorItems<T>(
  items: T[],
  opts: ChatSelectorFilterOptions,
  acc: ChatSelectorAccessors<T>,
): T[] {
  const scoped = scopeByTab(items, opts, acc)

  const kw = opts.keyword.trim().toLowerCase()
  if (!kw) return scoped

  // 命中项（以复合 key 记录，防同 id 不同类型互相牵连）
  const matched = scoped.filter((i) => acc.getName(i).toLowerCase().includes(kw))
  const matchedKeys = new Set(matched.map((i) => acc.getKey(i)))

  // 命中子区时，把其父群带出（父群本身未命中也带出），仅在当前 Tab 作用域内查找。
  // 父群恒为群，故按「群类型」复合 key 匹配，而非子区自身 key。
  const parentKeysToInclude = new Set<string>()
  for (const item of matched) {
    const parentId = acc.getParentId(item)
    if (parentId) parentKeysToInclude.add(acc.getGroupKeyFromId(parentId))
  }
  const parents =
    parentKeysToInclude.size > 0
      ? scoped.filter((i) => parentKeysToInclude.has(acc.getKey(i)) && !matchedKeys.has(acc.getKey(i)))
      : []

  const includeKeys = new Set<string>([...matchedKeys, ...parents.map((p) => acc.getKey(p))])
  // 遍历 scoped 保持顺序，只保留命中项 + 需带出的父群。
  return scoped.filter((i) => includeKeys.has(acc.getKey(i)))
}
