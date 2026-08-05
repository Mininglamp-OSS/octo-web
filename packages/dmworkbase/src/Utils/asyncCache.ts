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

/** 调用方传入的取消信号被触发时抛出的错误。名字对齐 DOMException 的约定。 */
function abortError(): Error {
    const err = new Error("Aborted");
    err.name = "AbortError";
    return err;
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

export interface AsyncCacheOptions {
    /** 条目默认存活时长（毫秒）。单次 get 可用 `maxAgeMs` 覆盖。 */
    ttlMs: number;
    /** 时间源，仅为测试注入；默认 `Date.now`。 */
    now?: () => number;
}

export interface AsyncCacheGetOptions {
    /** 本次可接受的最大陈旧时长（严格小于才算命中）；省略则用 `ttlMs`，传 0 强制绕过缓存。 */
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
     * 提交**（等待方仍拿到该次返回值，但缓存不留下已知过期的数据）。写操作后
     * 调用它，避免 TTL 窗口内读到自己刚改掉的旧值。
     */
    invalidate(key?: string): void;
}

export function createAsyncCache<V>(options: AsyncCacheOptions): AsyncCache<V> {
    const { ttlMs } = options;
    const now = options.now ?? (() => Date.now());

    const entries = new Map<string, { value: V; at: number }>();
    const inflight = new Map<string, Promise<V>>();
    // 每个 key 一个代际计数。invalidate 时 +1，加载完成时比对——不等就丢弃写入。
    const generations = new Map<string, number>();

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
                return withAbort(Promise.resolve(hit.value), getOptions?.signal);
            }

            const existing = inflight.get(key);
            if (existing) {
                return withAbort(existing, getOptions?.signal);
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
            return withAbort(tracked, getOptions?.signal);
        },

        peek(key) {
            return entries.get(key)?.value;
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
                return;
            }
            entries.delete(key);
            generations.set(key, (generations.get(key) ?? 0) + 1);
        },
    };
}
