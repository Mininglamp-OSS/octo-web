// 直接依赖 Service 层的 APIClient 单例,而不是 `../App` 的 WKApp —— App 会静态构造
// DefaultEmojiService.shared,若再 import App 就形成 App↔Service 循环依赖(仓库刻意避免的
// 反模式,见 APIClientConfig 回调注入 #1038)。APIClient 不 import App,故无环。
import APIClient from "./APIClient"

export class Emoji {
    key!: string
    name!: string
    image!: string
    constructor(key: string, name: string, image: string) {
        this.key = key
        this.name = name
        this.image = image
    }
}

export interface EmojiService {
    getImage(name: string): string
    getAllEmoji(): Array<Emoji>
    emojiRegExp(): RegExp
    // 是否自定义表情（[xxx] token）。可选：旧 mock 未实现时调用方自行回退。
    isCustomEmoji?(key: string): boolean
    // 启动时拉取服务端表情清单（manifest）。可选：离线/失败时回退到内置兜底。
    load?(): Promise<void>
    // 订阅"清单发生变化"。manifest 异步到达且自定义集合确有变化时触发,返回取消订阅函数。
    // 供已渲染消息 / 表情选择器据此重渲染一次(消除首屏竞态下的裸 token / 旧选择器)。
    onChange?(listener: () => void): () => void
}

// 服务端表情清单契约：GET /v1/common/emojis → { version, list:[{key,name,url}] }。
// key 是消息正文 token（如 "[使命必达]"），是 wire 格式，不随下发改变。
interface EmojiManifestItem {
    key: string
    name: string
    url: string
}
interface EmojiManifest {
    version: number
    list: EmojiManifestItem[]
}

// localStorage 缓存键：存整份 manifest，供下次秒开 / 离线首屏使用。HTTP 层的
// ETag / Cache-Control(max-age + must-revalidate) 由浏览器对该 GET 自动 revalidate，
// 故此处无需手写 If-None-Match，只做"上次结果"的本地落地。
const EMOJI_MANIFEST_CACHE_KEY = "emoji_manifest_v1"

// 内置自定义表情的**本地兜底**：服务端 manifest 拉取失败/离线/或某条目未下发 url 时，
// 复用客户端已打包的本地 PNG（apps/*/public/emoji/custom_*.png）。
//   key  = 消息正文 token
//   name = 人类可读标签（选择器 title / 无障碍）
//   base = public/emoji 下的文件名（不含扩展名）
const BUILTIN_CUSTOM_EMOJIS: Array<{ key: string; name: string; base: string }> = [
    { key: "[使命必达]", name: "使命必达", base: "custom_mission" },
    { key: "[崇尚行动]", name: "崇尚行动", base: "custom_action" },
    { key: "[有品位]", name: "有品位", base: "custom_taste" },
    { key: "[尚方宝剑]", name: "尚方宝剑", base: "custom_shangfang" },
]
const BUILTIN_BASE_BY_KEY = new Map(BUILTIN_CUSTOM_EMOJIS.map((e) => [e.key, e.base]))

export class DefaultEmojiService implements EmojiService {
    private constructor() {
        // 首屏即用：优先上次缓存的 manifest，否则内置兜底。随后 load() 会刷新。
        this.customItems = this.loadCachedManifest() ?? this.builtinManifestItems()
        this.currentSig = this.sig(this.customItems)
        this.rebuild()
    }
    public static shared = new DefaultEmojiService()

    // Unicode 标准表情：本地、不变、各端一致，不走服务端下发。token → public/emoji 文件名。
    private unicodeMap = new Map<string, string>([
        ["😀", "0_0"],
        ["😃", "0_1"],
        ["😄", "0_2"],
        ["😁", "0_3"],
        ["😆", "0_4"],
        ["😅", "0_5"],
        ["😂", "0_6"],
        ["🤣", "0_7"],
        ["🥲", "0_8"],
        ["☺️", "0_9"],
        ["😊", "0_10"],
        ["😇", "0_11"],
        ["🙂", "0_12"],
        ["🙃", "0_13"],
        ["😉", "0_14"],
        ["😌", "0_15"],
        ["😍", "0_16"],
        ["🥰", "0_17"],
        ["😘", "0_18"],
        ["😗", "0_19"],
        ["😙", "0_20"],
        ["😚", "0_21"],
        ["😋", "0_22"],
        ["😛", "0_23"],
        ["😝", "0_24"],
        ["😜", "0_25"],
        ["🤪", "0_26"],
        ["🤨", "0_27"],
        ["🧐", "0_28"],
        ["🤓", "0_29"],
        ["😎", "0_30"],
        ["🥸", "0_31"],
        ["🤩", "0_32"],
        ["🥳", "0_33"],
        ["😏", "0_34"],
        ["😒", "0_35"],
        ["😞", "0_36"],
        ["😔", "0_37"],
        ["😟", "0_38"],
        ["😕", "0_39"],
        ["🙁", "0_40"],
        ["☹️", "0_41"],
        ["😣", "0_42"],
        ["😖", "0_43"],
        ["😫", "0_44"],
        ["😩", "0_45"],
        ["🥺", "0_46"],
        ["😢", "0_47"],
        ["😭", "0_48"],
        ["😤", "0_49"],
        ["😠", "0_50"],
        ["😡", "0_51"],
        ["🤬", "0_52"],
        ["🤯", "0_53"],
        ["😳", "0_54"],
        ["🥵", "0_55"],
        ["🥶", "0_56"],
        ["😱", "0_57"],
        ["😨", "0_58"],
        ["😰", "0_59"],
        ["😥", "0_60"],
        ["😓", "0_61"],
        ["🤗", "0_62"],
        ["🤔", "0_63"],
        ["🤭", "0_64"],
        ["🤫", "0_65"],
        ["🤥", "0_66"],
        ["😶", "0_67"],
        ["😐", "0_68"],
        ["😑", "0_69"],
        ["😬", "0_70"],
        ["🙄", "0_71"],
        ["😯", "0_72"],
        ["😦", "0_73"],
        ["😧", "0_74"],
        ["😮", "0_75"],
        ["😲", "0_76"],
        ["🥱", "0_77"],
        ["😴", "0_78"],
        ["🤤", "0_79"],
        ["😪", "0_80"],
        ["😵", "0_81"],
        ["🤐", "0_82"],
        ["🥴", "0_83"],
        ["🤢", "0_84"],
        ["🤮", "0_85"],
        ["🤧", "0_86"],
        ["😷", "0_87"],
        ["🤒", "0_88"],
        ["🤕", "0_89"],
        ["🤑", "0_90"],
        ["🤠", "0_91"],
        ["😈", "0_92"],
        ["👿", "0_93"],
        ["👹", "0_94"],
        ["👺", "0_95"],
        ["🤡", "0_96"],
        ["💩", "0_97"],
        ["👻", "0_98"],
        ["💀", "0_99"],
        ["☠️", "0_100"],
        ["👽", "0_101"],
        ["👾", "0_102"],
        ["🤖", "0_103"],
        ["🎃", "0_104"],
        ["😺", "0_105"],
        ["😸", "0_106"],
        ["😹", "0_107"],
        ["😻", "0_108"],
        ["😼", "0_109"],
        ["😽", "0_110"],
        ["🙀", "0_111"],
        ["😿", "0_112"],
        ["😾", "0_113"],
        ["👋", "0_114"],
        ["🤚", "0_115"],
        ["🖐", "0_116"],
        ["✋", "0_117"],
        ["🖖", "0_118"],
        ["👌", "0_119"],
        ["🤌", "0_120"],
        ["🤏", "0_121"],
        ["✌️", "0_122"],
        ["🤞", "0_123"],
        ["🤟", "0_124"],
        ["🤘", "0_125"],
        ["🤙", "0_126"],
        ["👈", "0_127"],
        ["👉", "0_128"],
        ["👆", "0_129"],
        ["🖕", "0_130"],
        ["👇", "0_131"],
        ["☝️", "0_132"],
        ["👍", "0_133"],
        ["👎", "0_134"],
        ["✊", "0_135"],
        ["👊", "0_136"],
        ["🤛", "0_137"],
        ["🤜", "0_138"],
        ["👏", "0_139"],
        ["🙌", "0_140"],
        ["👐", "0_141"],
        ["🤲", "0_142"],
        ["🤝", "0_143"],
        ["🙏", "0_144"],
        ["✍️", "0_145"],
        ["💪", "0_146"],
        ["🦾", "0_147"],
        ["🦶", "0_148"],
        ["👂", "0_149"],
        ["👃", "0_150"],
        ["💋", "0_151"],
    ])

    // 当前生效的自定义表情集合：来自服务端 manifest（load 后）或本地兜底（首屏/离线）。
    private customItems: EmojiManifestItem[]

    // 重建产物（rebuild 时刷新）：
    private resolvedImage = new Map<string, string>() // token → 可直接用于 <img src> 的地址
    private customKeySet = new Set<string>() // 哪些 token 是自定义表情（供放大渲染/降级判断）
    private emojiKeys?: string[]
    private _cachedRegExp: RegExp | null = null

    // 变更订阅:manifest 异步到达且自定义集合确有变化时通知(用 currentSig 去重,避免无谓重渲染)。
    private changeListeners = new Set<() => void>()
    private currentSig = ""

    emojiRegExp(): RegExp {
        if (this._cachedRegExp) {
            return this._cachedRegExp
        }
        if (!this.emojiKeys) {
            this.emojiKeys = Array.from(this.resolvedImage.keys())
        }
        // 转义自定义表情 key（如 [崇尚行动]）里的正则特殊字符。
        const escapedKeys = this.emojiKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        this._cachedRegExp = new RegExp(`(${escapedKeys.join("|")})`)
        return this._cachedRegExp
    }

    getImage(emojiName: string): string {
        return this.resolvedImage.get(emojiName) ?? ""
    }

    getAllEmoji(): Emoji[] {
        const emojis: Emoji[] = []
        // 自定义在前（与历史顺序一致：custom token 原本排在 map 前列），再接 Unicode。
        for (const item of this.customItems) {
            emojis.push(new Emoji(item.key, item.name, this.customImage(item)))
        }
        for (const [token, base] of this.unicodeMap) {
            if (this.customKeySet.has(token)) {
                continue
            }
            emojis.push(new Emoji(token, base, this.localImage(base)))
        }
        return emojis
    }

    isCustomEmoji(key: string): boolean {
        return this.customKeySet.has(key)
    }

    // 启动时拉取 manifest（fire-and-forget）。成功则刷新清单并落地缓存；失败保持兜底，
    // 保证首屏与降级。token 仍是 [xxx]，不变。
    async load(): Promise<void> {
        try {
            const manifest = (await APIClient.shared.get("common/emojis")) as EmojiManifest
            // 只要 list 是数组就应用(允许服务端下发空列表 = 清空自定义表情);非数组/缺失则保留兜底。
            if (manifest && Array.isArray(manifest.list)) {
                this.applyManifest(manifest)
                this.saveCachedManifest(manifest)
            }
        } catch (e) {
            // 离线/失败：保留构造时的缓存或内置兜底。
            console.warn("[EmojiService] load manifest failed, using fallback", e)
        }
    }

    private applyManifest(manifest: EmojiManifest) {
        const items = this.sanitizeItems(manifest.list)
        const next = this.sig(items)
        const changed = next !== this.currentSig
        this.customItems = items
        this.currentSig = next
        this.rebuild()
        if (changed) {
            this.emitChange()
        }
    }

    onChange(listener: () => void): () => void {
        this.changeListeners.add(listener)
        return () => {
            this.changeListeners.delete(listener)
        }
    }

    private emitChange() {
        for (const l of this.changeListeners) {
            try {
                l()
            } catch (e) {
                console.warn("[EmojiService] onChange listener threw", e)
            }
        }
    }

    // 自定义集合的内容签名,用于判断 applyManifest 是否真的改变了清单(去重通知)。
    private sig(items: EmojiManifestItem[]): string {
        return items.map((i) => `${i.key}${i.name}${i.url}`).join("")
    }

    // 规范化并过滤清单条目。服务端数据视为不可信(#480 类):丢弃 key 非字符串/为空/纯空白的条目
    // —— 空 key 会让 emojiRegExp() 产生空分支 `(…|)`,在消费端(parseEmoji / getTextBlockEmojis
    // 的 slice 推进循环)造成零宽匹配、永不前进 → 渲染死循环(DoS)。
    private sanitizeItems(list: unknown): EmojiManifestItem[] {
        if (!Array.isArray(list)) {
            return []
        }
        const out: EmojiManifestItem[] = []
        for (const it of list) {
            const key = it && typeof (it as EmojiManifestItem).key === "string" ? (it as EmojiManifestItem).key : ""
            if (!key || !key.trim()) {
                continue
            }
            out.push({
                key,
                name: it && typeof (it as EmojiManifestItem).name === "string" ? (it as EmojiManifestItem).name : "",
                url: it && typeof (it as EmojiManifestItem).url === "string" ? (it as EmojiManifestItem).url : "",
            })
        }
        return out
    }

    // 重建 token→图 映射、自定义 key 集合，并失效正则缓存。
    private rebuild() {
        const resolved = new Map<string, string>()
        const customKeys = new Set<string>()
        for (const item of this.customItems) {
            resolved.set(item.key, this.customImage(item))
            customKeys.add(item.key)
        }
        for (const [token, base] of this.unicodeMap) {
            if (!resolved.has(token)) {
                resolved.set(token, this.localImage(base))
            }
        }
        this.resolvedImage = resolved
        this.customKeySet = customKeys
        this.emojiKeys = undefined
        this._cachedRegExp = null
    }

    private builtinManifestItems(): EmojiManifestItem[] {
        return BUILTIN_CUSTOM_EMOJIS.map((e) => ({ key: e.key, name: e.name, url: "" }))
    }

    private localImage(base: string): string {
        return `./emoji/${base}.png`
    }

    // 自定义表情最终图片地址：优先 manifest 下发的 url（绝对 url 原样用，相对 url 拼到 API
    // v1 base 上）；url 为空则回退到内置本地 PNG。
    private customImage(item: EmojiManifestItem): string {
        const u = this.resolveUrl(item.url)
        if (u) {
            return u
        }
        const base = BUILTIN_BASE_BY_KEY.get(item.key)
        return base ? this.localImage(base) : ""
    }

    private resolveUrl(url: string): string {
        if (!url) {
            return ""
        }
        // 白名单收紧:仅放行 http(s)/协议相对 与图片 data URI。服务端数据不可信,不放行任意
        // scheme;其余一律按相对路径拼到 API base(即便是诡异 scheme 也只会变成无害的相对路径)。
        if (/^(https?:)?\/\//i.test(url)) {
            return url
        }
        if (/^data:image\//i.test(url)) {
            return url
        }
        // 相对 url 拼到 API v1 base（如 "/api/v1/" 或 "https://host/v1/"）。
        let base = ""
        try {
            base = (APIClient.shared?.config?.apiURL as string) || ""
        } catch {
            base = ""
        }
        if (base && !base.endsWith("/")) {
            base += "/"
        }
        return base + url.replace(/^\/+/, "")
    }

    private loadCachedManifest(): EmojiManifestItem[] | null {
        try {
            const raw = localStorage.getItem(EMOJI_MANIFEST_CACHE_KEY)
            if (!raw) {
                return null
            }
            const m = JSON.parse(raw) as EmojiManifest
            const items = this.sanitizeItems(m?.list)
            if (items.length > 0) {
                return items
            }
        } catch {
            // 损坏/不可用：忽略，走内置兜底。
        }
        return null
    }

    private saveCachedManifest(manifest: EmojiManifest) {
        try {
            localStorage.setItem(
                EMOJI_MANIFEST_CACHE_KEY,
                JSON.stringify({ version: manifest.version ?? 0, list: manifest.list }),
            )
        } catch {
            // 配额/隐私模式不可写：忽略，缓存只是优化。
        }
    }
}
