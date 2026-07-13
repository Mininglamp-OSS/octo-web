import React, { useEffect, useRef, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import {
    IconAlertTriangle,
    IconCopy,
    IconEyeClosed,
    IconEyeOpened,
    IconTickCircle,
} from "@douyinfe/semi-icons";
import WKModal from "../WKModal";
import WKButton from "../WKButton";
import WKApp from "../../App";
import { useI18n } from "../../i18n";
import { copyToClipboard } from "../../Utils/clipboard";
import {
    IncomingWebhookCreateResp,
    buildWebhookUrlRows,
    buildWebhookCurlExample,
    buildWebhookAdapterExamples,
    WebhookUrlRow,
    WebhookAdapterExampleRow,
} from "../../Service/IncomingWebhook";
import "./index.css";

export interface WebhookUrlModalProps {
    /** create / regenerate 的响应（token 与 URL 仅此一次出现） */
    resp: IncomingWebhookCreateResp;
    onClose: () => void;
}

/**
 * 一次性推送 URL 展示弹窗 —— 本功能的核心安全交互。
 *
 * token 只在 create / regenerate 响应里出现一次，关闭本弹窗后无法再次查看，
 * 因此：遮罩点击不关闭（防手滑），三种适配器地址各带复制按钮，顶部红字警示。
 */
export default function WebhookUrlModal({ resp, onClose }: WebhookUrlModalProps) {
    const { t } = useI18n();
    // 同 WebhookEditModal：条件挂载 + 路由滑入动画下，挂载即 visible=true 会让
    // 首次显示与动画竞争（要点两次）。挂载先 false、effect 翻 true 走正常过渡。
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        setVisible(true);
    }, []);

    // 行构造（native 回退 url、按适配器过滤空地址）抽到纯函数 buildWebhookUrlRows，已单测。
    // 三种适配器其实共享同一个 webhook，仅推送路径后缀 / 调用方式不同：URL 框只展示
    // 通用地址展示一个，github / wecom 的实际地址与差异都落在各自的「调用示例」里。
    const rows = buildWebhookUrlRows(
        resp,
        WKApp.apiClient.config.apiURL || "/",
        window.location.origin
    );
    const nativeRow = rows.find((r) => r.key === "native");

    // 调用示例改成分段 Tab：native 作为首个通用示例，其余适配器同级切换。
    // 页面始终只保留一个详情内容区，避免展开平台卡片导致弹窗高度跳动。
    const CORE_ADAPTER_KEYS: ReadonlyArray<WebhookUrlRow["key"]> = ["native"];
    const [activeAdapterKey, setActiveAdapterKey] = useState<string>("native");
    const [showWebhookUrl, setShowWebhookUrl] = useState(false);

    // 适配器 Tab 优先用服务端下发的本地化示例（octo-server #475）渲染，不再写死文案/平台列表。
    // native 仍作为顶部核心 curl；wecom 作为平台入口，但详情继续用前端企微 curl
    // （请求体结构不同，不能被服务端通用步骤替代）。未知 key 不过滤——后端新增适配器时
    // 前端无需发版即可渲染。
    const adapterExamples = buildWebhookAdapterExamples(
        resp,
        WKApp.apiClient.config.apiURL || "/",
        window.location.origin
    );
    // 兜底：老后端（#475 之前）不下发 adapter_examples 时，继续基于 urls 渲染写死示例。
    // wecom 即使后端下发示例也保持前端 curl：企微兼容体结构不同，不能被通用步骤替代。
    const serverExampleByKey = new Map(
        adapterExamples
            .filter(
                (ex) =>
                    !CORE_ADAPTER_KEYS.includes(ex.key as WebhookUrlRow["key"]) &&
                    ex.key !== "wecom"
            )
            .map((ex) => [ex.key, ex])
    );
    const KNOWN_BRAND_KEYS = ["github", "gitlab", "feishu", "multica", "wecom"];
    const brandName = (key: string, fallback: string): string =>
        KNOWN_BRAND_KEYS.includes(key)
            ? t(`base.channelWebhook.url.brand.${key}`)
            : fallback;
    const adapterOrder = ["native", "github", "gitlab", "feishu", "multica", "wecom"];
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const tabKeys = [
        ...adapterOrder.filter(
            (key) => rowByKey.has(key as WebhookUrlRow["key"]) || serverExampleByKey.has(key)
        ),
        ...[
            ...Array.from(rowByKey.keys()),
            ...Array.from(serverExampleByKey.keys()),
        ].filter((key) => !adapterOrder.includes(key)),
    ].filter((key, index, arr) => arr.indexOf(key) === index);
    const adapterTabs = tabKeys.map((key) => {
        const row = rowByKey.get(key as WebhookUrlRow["key"]);
        const serverExample = serverExampleByKey.get(key);
        const fallbackTitle = row ? t(`base.${row.labelKey}`) : serverExample?.title || key;
        return {
            key,
            brand:
                key === "native"
                    ? t("base.channelWebhook.url.native")
                    : brandName(key, fallbackTitle),
            title: serverExample?.title || fallbackTitle,
            row,
            serverExample,
        };
    });
    const activeTab =
        adapterTabs.find((tab) => tab.key === activeAdapterKey) || adapterTabs[0];
    const focusAdapterTab = (index: number) => {
        requestAnimationFrame(() => {
            const tabs = document.querySelectorAll<HTMLButtonElement>(
                ".wk-webhook-url__tab"
            );
            tabs[index]?.focus();
        });
    };
    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const currentIndex = adapterTabs.findIndex((tab) => tab.key === activeTab?.key);
        if (currentIndex < 0) return;
        let nextIndex = currentIndex;
        if (event.key === "ArrowRight") {
            nextIndex = (currentIndex + 1) % adapterTabs.length;
        } else if (event.key === "ArrowLeft") {
            nextIndex = (currentIndex - 1 + adapterTabs.length) % adapterTabs.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = adapterTabs.length - 1;
        } else {
            return;
        }
        event.preventDefault();
        setActiveAdapterKey(adapterTabs[nextIndex].key);
        focusAdapterTab(nextIndex);
    };
    // 遮罩：secret 是 token，而 token 是推送 URL 的某个路径段——native 为末段
    // （/v1/webhooks/{id}/{token}），适配器 URL 形如 …/{id}/{token}/{adapter} 时为中间段，
    // 也可能是传入的裸 token 值本身。按「秘密段」整体替换：用已知的 resp.token 做字面量
    // 替换，把 token 整体换成固定长度掩码，绝不暴露其任何前缀/后缀。
    // （旧版首12+末6 的按位置遮罩会泄露 token 尾部 6 字符——token 恰是 URL 末段/裸值尾部，
    //  显著缩小猜测空间，见 #594 review。）token 缺失或不在串内时整体遮罩兜底。
    const maskValue = (value: string): string => {
        if (resp.token && value.includes(resp.token)) {
            return value.split(resp.token).join("••••••••");
        }
        return "••••••••";
    };
    // native 推送地址本身是 tokenized 的（/v1/webhooks/{id}/{token}），token 即路径段，
    // 所以「地址」就是一次性 secret。眼睛 toggle 必须统一治理整个弹窗内所有含 token 的
    // 地址/凭证展示——顶部行、各适配器示例 code、curl <pre>、token 行——否则遮罩形同虚设
    // （录屏/肩窥时 secret 仍从示例块或 tooltip 泄露）。复制动作始终取完整值：「复制去用」
    // 是核心功能，不能复制出遮罩串。
    const displayUrl = (value: string): string =>
        showWebhookUrl ? value : maskValue(value);
    // title 属性会把完整值塞进 DOM，并在 hover 时以原生 tooltip 明文弹出，绕过视觉遮罩。
    // 遮罩态下一律不带 title。
    const secretTitle = (value: string): string | undefined =>
        showWebhookUrl ? value : undefined;

    // 复制成功的即时反馈：记录最近一次复制的目标 key，按钮图标短暂变 ✓。
    // 一次性弹窗里「复制是否真成功」是核心焦虑点，按钮本身给反馈比一闪而过的 toast 更可靠。
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        return () => {
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        };
    }, []);

    const handleCopy = async (text: string, feedbackKey: string) => {
        try {
            const ok = await copyToClipboard(text);
            if (ok) {
                Toast.success(t("base.channelWebhook.toast.copied"));
                setCopiedKey(feedbackKey);
                if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
                copiedTimerRef.current = setTimeout(() => setCopiedKey(null), 1500);
            } else {
                Toast.error(t("base.channelWebhook.toast.copyFailed"));
            }
        } catch {
            Toast.error(t("base.channelWebhook.toast.copyFailed"));
        }
    };

    // 调用示例：native / wecom 是可复制的 curl（body 结构不同，由纯函数区分）；
    // github 不是 curl，而是「把 Payload URL 贴到仓库 Webhook 设置」的地址 + 步骤。
    const renderExample = (row: WebhookUrlRow) => {
        // 单点定义本行的复制反馈 key，下方 copied 判定与各分支 handleCopy 复用，
        // 避免同一字面量多处拼接漂移导致 ✓ 反馈失效。
        const feedbackKey = `example:${row.key}`;
        const copied = copiedKey === feedbackKey;
        if (row.key === "github") {
            // GitHub 用法是把这个带 /github 后缀的地址填进仓库 Webhook 设置，
            // 所以单独给一行可复制的 Payload URL，而不是 curl。
            return (
                <div className="wk-webhook-url__example">
                    <span className="wk-webhook-url__example-note">
                        {t("base.channelWebhook.url.example.github.intro")}
                    </span>
                    <div className="wk-webhook-url__value-block">
                        <code className="wk-webhook-url__value" title={secretTitle(row.url)}>
                            {displayUrl(row.url)}
                        </code>
                    </div>
                    <button
                        type="button"
                        className="wk-webhook-url__copy-action"
                        onClick={() => void handleCopy(row.url, feedbackKey)}
                    >
                        {copied ? (
                            <IconTickCircle className="wk-webhook-url__copied-icon" />
                        ) : (
                            <IconCopy />
                        )}
                        {copied
                            ? t("base.channelWebhook.toast.copied")
                            : t("base.channelWebhook.url.copy")}
                    </button>
                    <details className="wk-webhook-url__steps-details">
                        <summary className="wk-webhook-url__steps-summary">
                            {t("base.channelWebhook.url.example.stepsTitle")}
                        </summary>
                        <ol className="wk-webhook-url__steps">
                            <li>{t("base.channelWebhook.url.example.github.step1")}</li>
                            <li>{t("base.channelWebhook.url.example.github.step2")}</li>
                            <li>{t("base.channelWebhook.url.example.github.step3")}</li>
                        </ol>
                    </details>
                </div>
            );
        }
        // native / wecom 是可复制的 curl（body 结构不同，由纯函数区分）。
        // content 渲染差异：native 按 markdown（样例带 **加粗** + 链接）；
        // wecom 用企微 text 类型（纯文本不渲染 markdown），样例保持纯文本。
        // 注：#465 起 push body 不再解析 mention，@ 谁由 webhook 配置（mention_uids /
        // allow_mention_*）决定，故这里不再给「带 @」的推送示例。
        if (row.key === "native" || row.key === "wecom") {
            const sampleKey =
                row.key === "wecom"
                    ? "base.channelWebhook.url.example.wecom.sample"
                    : "base.channelWebhook.url.example.native.sample";
            const curl = buildWebhookCurlExample(row.key, row.url, t(sampleKey));
            // 遮罩态下 <pre> 里的 URL 同样是 token，必须隐藏；用遮罩后的 URL 重新构建展示串，
            // 复制仍取含完整 URL 的 curl。
            const displayCurl = showWebhookUrl
                ? curl
                : buildWebhookCurlExample(row.key, maskValue(row.url), t(sampleKey));
            const noteKey =
                row.key === "wecom"
                    ? "base.channelWebhook.url.example.wecom.note"
                    : "base.channelWebhook.url.example.native.note";
            return (
                <div className="wk-webhook-url__example">
                    <pre className="wk-webhook-url__example-code">{displayCurl}</pre>
                    <span className="wk-webhook-url__example-note">{t(noteKey)}</span>
                    <button
                        type="button"
                        className="wk-webhook-url__example-copy"
                        onClick={() => void handleCopy(curl, feedbackKey)}
                    >
                        {copied ? (
                            <IconTickCircle className="wk-webhook-url__copied-icon" />
                        ) : (
                            <IconCopy />
                        )}
                        {copied
                            ? t("base.channelWebhook.toast.copied")
                            : t("base.channelWebhook.url.example.copy")}
                    </button>
                </div>
            );
        }
        // gitlab / feishu / multica：用法是把这个地址登记到对应平台的 Webhook 设置
        // （或替换现有兼容机器人 URL），不是 curl —— 展示可复制地址 + 各自说明即可。
        return (
            <div className="wk-webhook-url__example">
                <div className="wk-webhook-url__value-block">
                    <code className="wk-webhook-url__value" title={secretTitle(row.url)}>
                        {displayUrl(row.url)}
                    </code>
                </div>
                <span className="wk-webhook-url__example-note">
                    {t(`base.channelWebhook.url.example.${row.key}.note`)}
                </span>
                <button
                    type="button"
                    className="wk-webhook-url__copy-action"
                    onClick={() => void handleCopy(row.url, feedbackKey)}
                >
                    {copied ? (
                        <IconTickCircle className="wk-webhook-url__copied-icon" />
                    ) : (
                        <IconCopy />
                    )}
                    {copied
                        ? t("base.channelWebhook.toast.copied")
                        : t("base.channelWebhook.url.copy")}
                </button>
            </div>
        );
    };

    // 服务端驱动的适配器详情（octo-server #475）：title/description/steps 均来自响应，
    // 不写死。用法是把地址登记到对应平台的 Webhook 设置（非 curl），故展示「可复制地址 +
    // 说明 + 分步骤 + 鉴权提示」。未知 key 也走这套通用渲染。
    const renderServerExample = (ex: WebhookAdapterExampleRow) => {
        const feedbackKey = `example:${ex.key}`;
        const tokenFeedbackKey = `authtoken:${ex.key}`;
        // 形如 GitLab：URL 带 token 之外，还需在平台 Secret token 处填本次响应的 token。
        const needsHeaderToken =
            ex.auth?.type === "url_token_and_header" && !!ex.auth.header;
        return (
            <div className="wk-webhook-url__example">
                {ex.description && (
                    <span className="wk-webhook-url__example-note">{ex.description}</span>
                )}
                <div className="wk-webhook-url__value-block">
                    <code className="wk-webhook-url__value" title={secretTitle(ex.url)}>
                        {displayUrl(ex.url)}
                    </code>
                </div>
                <button
                    type="button"
                    className="wk-webhook-url__copy-action"
                    onClick={() => void handleCopy(ex.url, feedbackKey)}
                >
                    {copiedKey === feedbackKey ? (
                        <IconTickCircle className="wk-webhook-url__copied-icon" />
                    ) : (
                        <IconCopy />
                    )}
                    {copiedKey === feedbackKey
                        ? t("base.channelWebhook.toast.copied")
                        : t("base.channelWebhook.url.copy")}
                </button>
                {ex.steps.length > 0 && (
                    <details className="wk-webhook-url__steps-details">
                        <summary className="wk-webhook-url__steps-summary">
                            {t("base.channelWebhook.url.example.stepsTitle")}
                        </summary>
                        <ol className="wk-webhook-url__steps">
                            {ex.steps.map((step, i) => (
                                <li key={i}>{step}</li>
                            ))}
                        </ol>
                    </details>
                )}
                {needsHeaderToken && (
                    <div className="wk-webhook-url__auth-hint">
                        <span className="wk-webhook-url__example-note">
                            {t("base.channelWebhook.url.example.auth.headerHint", {
                                values: { header: ex.auth.header },
                            })}
                        </span>
                        {/* value_source=token：header 值就是本次响应的明文 token，单独给一行可复制。 */}
                        {ex.auth.value_source === "token" && resp.token && (
                            <div className="wk-webhook-url__value-wrap">
                                <code
                                    className="wk-webhook-url__value"
                                    title={secretTitle(resp.token)}
                                >
                                    {displayUrl(resp.token)}
                                </code>
                                <button
                                    type="button"
                                    className="wk-webhook-card__icon-btn"
                                    onClick={() =>
                                        void handleCopy(resp.token, tokenFeedbackKey)
                                    }
                                    title={t("base.channelWebhook.url.copy")}
                                    aria-label={t("base.channelWebhook.url.copy")}
                                >
                                    {copiedKey === tokenFeedbackKey ? (
                                        <IconTickCircle className="wk-webhook-url__copied-icon" />
                                    ) : (
                                        <IconCopy />
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <WKModal
            visible={visible}
            title={t("base.channelWebhook.url.title")}
            onCancel={onClose}
            size="lg"
            options={{ closeOnEsc: false, maskClosable: false }}
            footer={
                <WKButton variant="primary" onClick={onClose}>
                    {t("base.channelWebhook.url.done")}
                </WKButton>
            }
            className="wk-webhook-modal"
        >
            <div className="wk-webhook-url">
                {rows.length === 0 || !nativeRow ? (
                    // 退化态：服务端契约里 url 非可选，理论不可达；仍兜底提示而非
                    // 展示「立即复制」警示却无可复制项。
                    <div className="wk-webhook-url__warning">
                        <IconAlertTriangle className="wk-webhook-url__warning-icon" />
                        <span>{t("base.channelWebhook.url.empty")}</span>
                    </div>
                ) : (
                    <>
                        <div className="wk-webhook-url__warning">
                            <IconAlertTriangle className="wk-webhook-url__warning-icon" />
                            <span>{t("base.channelWebhook.url.onceWarning")}</span>
                        </div>

                        {/* 唯一的 URL 框：这个 webhook 的推送地址（即 native 地址）。
                            标签用中性的「Webhook 地址」，避免与下方通用示例重复。 */}
                        <div className="wk-webhook-url__row">
                            <div className="wk-webhook-url__label">
                                {t("base.channelWebhook.url.address")}
                            </div>
                            <div className="wk-webhook-url__secret-row">
                                <button
                                    type="button"
                                    className="wk-webhook-url__secret-copy"
                                    onClick={() => void handleCopy(nativeRow.url, "url:native")}
                                    title={secretTitle(nativeRow.url)}
                                    aria-label={t("base.channelWebhook.url.copy")}
                                >
                                    <code className="wk-webhook-url__value">
                                        {showWebhookUrl
                                            ? nativeRow.url
                                            : maskValue(nativeRow.url)}
                                    </code>
                                </button>
                                <button
                                    type="button"
                                    className="wk-webhook-card__icon-btn"
                                    onClick={() => setShowWebhookUrl((v) => !v)}
                                    title={
                                        showWebhookUrl
                                            ? t("base.channelWebhook.url.hide")
                                            : t("base.channelWebhook.url.show")
                                    }
                                    aria-label={
                                        showWebhookUrl
                                            ? t("base.channelWebhook.url.hide")
                                            : t("base.channelWebhook.url.show")
                                    }
                                >
                                    {showWebhookUrl ? <IconEyeClosed /> : <IconEyeOpened />}
                                </button>
                                <button
                                    type="button"
                                    className="wk-webhook-card__icon-btn"
                                    onClick={() => void handleCopy(nativeRow.url, "url:native")}
                                    title={t("base.channelWebhook.url.copy")}
                                    aria-label={t("base.channelWebhook.url.copy")}
                                >
                                    {copiedKey === "url:native" ? (
                                        <IconTickCircle className="wk-webhook-url__copied-icon" />
                                    ) : (
                                        <IconCopy />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* 调用方式：既有适配器默认展开，差异（路径后缀 + body + 用法）都落在这里 */}
                        <div className="wk-webhook-url__examples-title">
                            {t("base.channelWebhook.url.example.title")}
                        </div>
                        {adapterTabs.length > 0 && activeTab && (
                            <div className="wk-webhook-url__adapter-tabs">
                                <div
                                    className="wk-webhook-url__tablist"
                                    role="tablist"
                                    aria-label={t("base.channelWebhook.url.example.title")}
                                    onKeyDown={handleTabKeyDown}
                                >
                                    {adapterTabs.map((tab) => {
                                        const selected = tab.key === activeTab.key;
                                        return (
                                            <button
                                                key={tab.key}
                                                type="button"
                                                role="tab"
                                                aria-selected={selected}
                                                tabIndex={selected ? 0 : -1}
                                                className={`wk-webhook-url__tab${
                                                    selected ? " wk-webhook-url__tab--active" : ""
                                                }`}
                                                onClick={() => setActiveAdapterKey(tab.key)}
                                            >
                                                {tab.brand}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div
                                    className="wk-webhook-url__example-group"
                                    role="tabpanel"
                                    aria-label={activeTab.title}
                                >
                                    {activeTab.serverExample
                                        ? renderServerExample(activeTab.serverExample)
                                        : activeTab.row
                                          ? renderExample(activeTab.row)
                                          : null}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </WKModal>
    );
}
