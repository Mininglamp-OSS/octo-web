/**
 * 版本检测工具
 *
 * 工作原理：
 *   - 当前版本：构建时由 CI 通过 VITE_APP_VERSION 注入，Vite 编译期替换为 import.meta.env.VITE_APP_VERSION
 *   - 服务端版本：定期 fetch /version.json 获取
 *   - 两者不一致时调用 onNewVersion 回调
 *
 * 异常情况处理：
 *   - VITE_APP_VERSION 未设置（本地开发）→ import.meta.env.VITE_APP_VERSION 为 undefined → 直接跳过，不检测
 *   - /version.json 404 或网络错误 → 指数退避重试，不影响正常使用
 *   - /version.json 格式非法 / 无 version 字段 → 视为无效，跳过此次检测
 *   - 页面切到后台时暂停轮询，切回来时立即检查
 *   - 已通知过后停止轮询
 */

interface VersionCheckOptions {
    /** 正常轮询间隔，默认 10 分钟 */
    interval?: number
    /** 最大退避间隔，默认 60 分钟 */
    maxBackoff?: number
    /** 检测到新版本时的回调，force=true 表示需要强制刷新 */
    onNewVersion: (force: boolean, serverVersion: string) => void
}

export function startVersionCheck(options: VersionCheckOptions): () => void {
    const { interval = 10 * 60 * 1000, maxBackoff = 60 * 60 * 1000, onNewVersion } = options

    // 当前版本未注入（本地开发或老构建）→ 跳过检测
    const currentVersion = import.meta.env.VITE_APP_VERSION as string | undefined
    if (!currentVersion || currentVersion === 'dev') {
        return () => {}
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    let backoff = interval
    let stopped = false
    let notified = false
    let checking = false

    const check = async () => {
        if (stopped || notified || checking) return
        checking = true

        try {
            const res = await fetch('/version.json?_=' + Date.now(), {
                cache: 'no-store',
                signal: AbortSignal.timeout(5000),
            })

            // 接口不存在（404）或服务器错误 → 退避，不报错
            if (!res.ok) {
                backoff = Math.min(backoff * 2, maxBackoff)
                schedule()
                return
            }

            let data: unknown
            try {
                data = await res.json()
            } catch {
                // JSON 解析失败 → 跳过此次
                backoff = Math.min(backoff * 2, maxBackoff)
                schedule()
                return
            }

            // version 字段缺失或非字符串 → 跳过此次
            if (
                typeof data !== 'object' ||
                data === null ||
                !('version' in data) ||
                typeof (data as Record<string, unknown>).version !== 'string'
            ) {
                backoff = Math.min(backoff * 2, maxBackoff)
                schedule()
                return
            }

            const serverVersion = (data as { version: string; force?: boolean }).version
            const force = (data as { version: string; force?: boolean }).force ?? false

            // version 为空字符串 → 跳过
            if (!serverVersion) {
                backoff = Math.min(backoff * 2, maxBackoff)
                schedule()
                return
            }

            // 成功拿到有效数据，重置退避
            backoff = interval

            if (serverVersion !== currentVersion) {
                if (notified) return  // 防止并发 check() 重复触发
                notified = true
                onNewVersion(force, serverVersion)
                return // 已通知，停止轮询
            }
        } catch {
            // 网络超时 / AbortError 等 → 指数退避
            backoff = Math.min(backoff * 2, maxBackoff)
        } finally {
            checking = false
        }

        schedule()
    }

    const schedule = () => {
        if (stopped) return
        timer = setTimeout(check, backoff)
    }

    // 页面切回时立即检查一次（用户长时间切出去再回来）
    const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
            if (timer) clearTimeout(timer)
            check()
        } else {
            if (timer) clearTimeout(timer)
        }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    check()  // 启动时立即检查一次，之后按 interval 轮询

    return () => {
        stopped = true
        if (timer) clearTimeout(timer)
        document.removeEventListener('visibilitychange', handleVisibility)
    }
}

/**
 * 一次性版本检查（不启动轮询）
 * 供 NavSettingsPanel 等按需触发的场景使用
 * 返回 serverVersion（有新版本时）或 null（无新版本 / 检测失败）
 */
export async function checkVersionOnce(): Promise<string | null> {
    const currentVersion = import.meta.env.VITE_APP_VERSION as string | undefined
    if (!currentVersion || currentVersion === 'dev') return null

    try {
        const res = await fetch('/version.json?_=' + Date.now(), {
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) return null
        const data = await res.json()
        if (typeof data?.version !== 'string' || !data.version) return null
        return data.version !== currentVersion ? data.version : null
    } catch {
        return null
    }
}
