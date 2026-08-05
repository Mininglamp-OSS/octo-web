/**
 * 通用异步缓存原语：TTL + 并发合流 + 代际守卫。
 *
 * 解决的问题：同一份远端数据在一次会话内被多处重复拉取。典型例子是
 * `space/{id}/members`——它被转发面板、通讯录、Chat 侧栏、docs 成员选择器
 * 以及企业模块各自调用，彼此不共享结果。
 *
 * 刻意不做的事：
 *   - 不持久化（不落 IndexedDB / localStorage）。TTL 是秒级量级，数据活不过
 *     一次刷新，持久化只会换来 schema 迁移、跨标签页一致性和把人员名册落盘的
 *     隐私面。全仓库唯一用 IndexedDB 的是 docs 离线编辑，那是真需要跨会话。
 *   - 不缓存失败。loader reject 时条目不写入，下次 get 会重新尝试。
 *   - 不读全局状态。key 由调用方给（对 Space 数据就用 spaceId），所以切 Space
 *     天然 miss，无需监听 `space-changed`，也无需在 Service 层 import WKApp。
 */

/**
 * 调用方传入的取消信号被触发时抛出的错误。
 *
 * 用 DOMException 而非 `new Error()` 改 name：仓库里已有多处消费方以
 * `err instanceof DOMException && err.name === "AbortError"` 判取消
 * （dmworkskillmarket/src/hooks/useSkills.ts、dmworkmcp 的 McpMarketListPage
 * 等），普通 Error 不会命中那些 instanceof 检查。构造方式对齐
 * dmworkmcp/src/api/mcpService.ts:920。
 *
 * 导出供 Service 层复用：axios 取消后经 APIClient 包装成 `ERR_CANCELED`，而
 * `normalizeApiError`（apiError.ts）只归类 `ECONNABORTED` / `ERR_NETWORK`，
 * 取消会退化成「未知错误」。转发 signal 的 Service 需要把它翻译回 AbortError。
 */
export function abortError(): DOMException {
    return new DOMException("Aborted", "AbortError");
}

/**
 * 把 `signal` 挂到一个已经在跑的 promise 上。
 *
 * 关键语义：signal 只中止**调用方自己的等待**，不中止底层加载。因为同一次加载
 * 可能有多个等待方合流，其中一方取消不该让其余等待方拿到 AbortError；底层请求
 * 继续跑完并正常填充缓存，后来者仍能命中。
 */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(abortError());
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (err) => {
                signal.removeEventListener("abort", onAbort);
                reject(err);
            }
        );
    });
}

export interface AsyncCacheOptions<V> {
    /** 条目默认存活时长（毫秒）。单次 get 可用 `maxAgeMs` 覆盖。 */
    ttlMs: number;
    /**
     * 每次交付前复制缓存值。**强烈建议为可变值（数组/对象）传入。**
     *
     * 不传时 `get` / `peek` 交付的是同一个引用：任一消费方就地 sort/splice 会
     * 污染之后所有读者，而且故障现场离本文件很远。数组传 `(v) => [...v]` 即可。
     */
    clone?: (value: V) => V;
    /** 时间源，仅为测试注入；默认 `Date.now`。 */
    now?: () => number;
}

export interface AsyncCacheGetOptions {
    /**
     * 本次可接受的最大陈旧时长（严格小于才算命中）；省略则用 `ttlMs`。
     *
     * 传 0 会跳过任何已完成的缓存值，但**仍会合流到正在进行的加载**——否则并发
     * 的「强制刷新」会各自打一个请求。要真正拿到一次独立的新请求，请先
     * `invalidate(key)` 再 get：invalidate 会把在飞的加载移出可合流集合。
     */
    maxAgeMs?: number;
    /** 取消本次等待（不影响底层加载与其他等待方）。 */
    signal?: AbortSignal;
}

export interface AsyncCache<V> {
    /**
     * 取值：新鲜命中直接返回；否则调 `loader`。同一 key 的并发调用只会触发一次
     * `loader`，其余调用合流到同一个 promise。
     */
    get(key: string, loader: () => Promise<V>, options?: AsyncCacheGetOptions): Promise<V>;
    /** 同步读已缓存值，不触发加载，不判新鲜度。用于渲染首帧兜底。 */
    peek(key: string): V | undefined;
    /**
     * 失效。传 key 只失效该条；不传清空全部。
     *
     * 对 in-flight 的加载同样生效：失效时被推进的代际会让那次加载的结果**不被
     * 提交**，同时将它移出可合流集合。已有等待方仍拿到该次返回值，但失效后的
     * 新调用会启动新加载。写操作后调用它，避免读到自己刚改掉的旧值。
     */
    invalidate(key?: string): void;
}

export function createAsyncCache<V>(options: AsyncCacheOptions<V>): AsyncCache<V> {
    const { clone, ttlMs } = options;
    const now = options.now ?? (() => Date.now());

    const entries = new Map<string, { value: V; at: number }>();
    const inflight = new Map<string, Promise<V>>();
    // 每个 key 一个代际计数。invalidate 时 +1，加载完成时比对——不等就丢弃写入。
    const generations = new Map<string, number>();

    const deliver = (promise: Promise<V>, signal?: AbortSignal): Promise<V> => {
        const value = withAbort(promise, signal);
        return clone ? value.then(clone) : value;
    };

    const copy = (value: V): V => clone ? clone(value) : value;

    return {
        get(key, loader, getOptions) {
            // 入口短路：已取消就不要启动加载，否则 `signal` 形同虚设。
            if (getOptions?.signal?.aborted) {
                return Promise.reject(abortError());
            }

            const maxAge = getOptions?.maxAgeMs ?? ttlMs;
            const hit = entries.get(key);
            // 严格小于：`maxAgeMs: 0` 必须总是 miss（刚写入的条目 age 也是 0）。
            if (hit && now() - hit.at < maxAge) {
                return deliver(Promise.resolve(hit.value), getOptions?.signal);
            }

            const existing = inflight.get(key);
            if (existing) {
                return deliver(existing, getOptions?.signal);
            }

            const startedAt = generations.get(key) ?? 0;
            // `tracked` 在两个回调真正执行前就已赋值（它们都是异步的），所以
            // finally 里的自引用是安全的。
            let tracked: Promise<V>;
            tracked = loader()
                .then((value) => {
                    if ((generations.get(key) ?? 0) === startedAt) {
                        entries.set(key, { value, at: now() });
                    }
                    return value;
                })
                .finally(() => {
                    // 只清自己那条，避免误删后续已经重开的加载。
                    if (inflight.get(key) === tracked) {
                        inflight.delete(key);
                    }
                });
            inflight.set(key, tracked);
            return deliver(tracked, getOptions?.signal);
        },

        peek(key) {
            const value = entries.get(key)?.value;
            return value === undefined ? undefined : copy(value);
        },

        invalidate(key) {
            if (key === undefined) {
                entries.clear();
                for (const k of generations.keys()) {
                    generations.set(k, (generations.get(k) ?? 0) + 1);
                }
                // in-flight 的 key 可能还没进 generations，补上代际推进。
                for (const k of inflight.keys()) {
                    if (!generations.has(k)) {
                        generations.set(k, 1);
                    }
                }
                // 已有等待方仍持有原 promise；这里只阻止失效后的调用继续合流。
                inflight.clear();
                return;
            }
            entries.delete(key);
            generations.set(key, (generations.get(key) ?? 0) + 1);
            inflight.delete(key);
        },
    };
}
