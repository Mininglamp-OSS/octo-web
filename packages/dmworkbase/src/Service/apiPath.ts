/**
 * `apiPath` —— 携带**路由模板**的请求路径构造器(埋点 http_request path 归一的治本方案)。
 *
 * 背景:埋点采集在全局 fetch / XHR 拦截层(见 Dap.ts installHttpWrap),那里只拿得到**具体 URL**
 * (`/api/v1/spaces/8f3a/categories/12`),模板信息在调用处 `` `/spaces/${id}/categories/${cid}` ``
 * 插值时就丢了。Dap 只能在客户端反解归一,但"字面路由词"与"用户名 / vanity id / 邀请码"运行时
 * 形状无法区分——保留未知字面段就会漏隐私(见 #1320 review),塌成 :seg 又丢粒度。
 *
 * 治本:让调用处用 `apiPath` 标签模板发路径,静态段(源码字面)与插值段(变量)在标签函数里
 * 天然分开——静态段原样进模板,插值段一律占位 `:id`。于是:
 *   apiPath`/spaces/${spaceId}/categories/${categoryId}`
 *     → 具体串  /spaces/8f3a/categories/12   (照旧发给 axios)
 *     → 模板    /spaces/:id/categories/:id   (旁挂给 registry,供埋点上报)
 * 模板里永不含变量值,隐私天然安全;同一 endpoint 无论 id 怎么变都产出同一个稳定模板。
 *
 * 数据流:
 *   1) apiPath 产出具体串(相对路径),并把 concreteRel→templateRel 存进 relTemplates。
 *   2) APIClient 请求拦截器(唯一知道 baseURL 的地方)按 config.url 取出 templateRel,
 *      拼上 baseURL 前缀算出 concretePathname / templatePathname,存进 pathTemplates。
 *   3) Dap.normalizePath 先查 pathTemplates(按 seen URL 的 pathname 精确命中),命中即用模板;
 *      查不到才退回原有白名单归一(**兜底不变**,未迁移的调用点照旧安全脱敏)。
 *
 * 两个 registry 均为有界 LRU:只承载"在途 / 刚发出"的请求,读不消费(同 endpoint 并发都能命中),
 * 超量按插入序淘汰最旧。任何一环缺失都只是退回兜底归一,绝不影响业务请求本身。
 */

/** registry 上限:在途请求量级足够,超出按插入序淘汰(Map 保序)。 */
const MAX_ENTRIES = 256

/** apiPath 产出的 concreteRel(相对路径)→ templateRel(相对模板)。由请求拦截器消费。 */
const relTemplates = new Map<string, string>()
/** concretePathname(含 baseURL 前缀)→ templatePathname。由 Dap 读取。 */
const pathTemplates = new Map<string, string>()

function setBounded(map: Map<string, string>, key: string, value: string): void {
    // 覆盖写不改容量;新 key 超量时淘汰最旧(Map 迭代序即插入序)。
    if (!map.has(key) && map.size >= MAX_ENTRIES) {
        const oldest = map.keys().next().value
        if (oldest !== undefined) map.delete(oldest)
    }
    map.set(key, value)
}

/**
 * axios `combineURLs` 的等价实现:baseURL 去尾斜杠 + '/' + relativeURL 去头斜杠。
 * axios 对相对 URL 就是这样拼的(**不是**标准 URL 解析,标准解析会因 relative 的前导 '/'
 * 把 baseURL 的路径整段丢掉)。绝对 http(s) URL 忽略 baseURL。
 */
function joinURL(baseURL: string, url: string): string {
    if (/^https?:\/\//i.test(url)) return url
    if (!baseURL) return url
    return baseURL.replace(/\/+$/, '') + '/' + String(url).replace(/^\/+/, '')
}

/** 取 pathname(丢弃 query / host),两端一致以保证精确命中。解析失败退回原串。 */
function pathnameOf(url: string): string {
    try {
        return new URL(url, 'http://x').pathname
    } catch {
        return url.split('?')[0]
    }
}

/**
 * 每个插值段一律占位 `:id`(它按定义就是变量/资源标识)。刻意**不看运行时值形状**:
 * 同一 endpoint 无论 id 是数字 / uuid / 短 hex,都产出同一个稳定模板(埋点聚合的关键)。
 */
const PLACEHOLDER = ':id'

/**
 * 携带路由模板的路径标签模板。用法:`apiPath`/spaces/${spaceId}/categories/${categoryId}``。
 * 返回**具体相对路径字符串**(可直接作为 APIClient.shared.get/post/... 的第一个参数),
 * 同时把该具体路径对应的模板登记进 registry。除登记外行为与普通模板字符串完全一致。
 */
export function apiPath(strings: TemplateStringsArray, ...values: unknown[]): string {
    let concrete = ''
    let template = ''
    for (let i = 0; i < strings.length; i++) {
        concrete += strings[i]
        template += strings[i]
        if (i < values.length) {
            concrete += String(values[i] ?? '')
            template += PLACEHOLDER
        }
    }
    // 只登记形状确有差异(含插值)的;纯静态路径具体串即模板,登记无意义。
    if (concrete !== template) {
        setBounded(relTemplates, concrete, template)
    }
    return concrete
}

/**
 * 由 APIClient 请求拦截器调用:给定发往 axios 的 url 与 baseURL,若该 url 是 apiPath 产出的,
 * 取出其模板并按最终 pathname(含 baseURL 前缀)登记,供 Dap 精确命中。取出即从 relTemplates
 * 消费(一次请求一登记)。非 apiPath 路径直接返回,无副作用。
 */
export function registerRequestTemplate(url: string | undefined, baseURL: string | undefined): void {
    if (!url) return
    const templateRel = relTemplates.get(url)
    if (templateRel === undefined) return
    relTemplates.delete(url)
    const base = baseURL || ''
    const concretePathname = pathnameOf(joinURL(base, url))
    const templatePathname = pathnameOf(joinURL(base, templateRel))
    setBounded(pathTemplates, concretePathname, templatePathname)
}

/**
 * 由 Dap.normalizePath 调用:给定 seen 请求 URL 的 pathname,返回登记过的路由模板 pathname,
 * 未登记返回 undefined(调用方退回白名单归一)。**读不消费**:同一 endpoint 并发多发都能命中。
 */
export function templateForPathname(pathname: string): string | undefined {
    return pathTemplates.get(pathname)
}

/** 仅供单测:清空 registry,避免用例间串味。 */
export function __resetApiPathRegistry(): void {
    relTemplates.clear()
    pathTemplates.clear()
}
