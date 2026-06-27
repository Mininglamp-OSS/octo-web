import React, { useEffect, useRef, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { IconAlertTriangle, IconChevronDown, IconCopy, IconTickCircle } from "@douyinfe/semi-icons";
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
    // 通用（native）一个，github / wecom 的实际地址与差异都落在各自的「调用示例」里。
    const rows = buildWebhookUrlRows(
        resp,
        WKApp.apiClient.config.apiURL || "/",
        window.location.origin
    );
    const nativeRow = rows.find((r) => r.key === "native");

    // 适配器分两层展示：native（通用）/ wecom（企微兼容）为最常用，默认展开为核心 curl；
    // 其余适配器收进「更多适配器」折叠区（优先服务端 adapter_examples 驱动，见下）。
    const CORE_ADAPTER_KEYS: ReadonlyArray<WebhookUrlRow["key"]> = [
        "native",
        "wecom",
    ];
    const coreRows = rows.filter((r) => CORE_ADAPTER_KEYS.includes(r.key));
    const extraRows = rows.filter((r) => !CORE_ADAPTER_KEYS.includes(r.key));
    const [showMore, setShowMore] = useState(false);
    // 每张适配器卡片的「接入步骤」是否展开（key→bool）。默认全收起：卡片只留
    // 名称 + 描述 + URL（80% 场景就是复制地址），冗长的分步骤按需展开，压低默认高度。
    const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({});
    const toggleSteps = (key: string) =>
        setOpenSteps((prev) => ({ ...prev, [key]: !prev[key] }));

    // 展开「更多适配器」后把折叠区滑入视野——否则新卡片出现在折叠按钮下方、可能在可视区外。
    // 可选调用兜底 jsdom（测试环境无 scrollIntoView，否则会 TypeError）。仅展开时滑、收起不动。
    const moreRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (showMore) {
            moreRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
        }
    }, [showMore]);

    // 「更多适配器」优先用服务端下发的本地化示例（octo-server #475）渲染，不再写死文案/平台列表。
    // native/wecom 仍作为顶部 + 核心 curl 卡片（请求体结构，非平台接入文案），故从服务端示例里
    // 过滤掉它们，避免与核心区重复。未知 key 不过滤——后端新增适配器时前端无需发版即可渲染。
    const serverExtraExamples = buildWebhookAdapterExamples(
        resp,
        WKApp.apiClient.config.apiURL || "/",
        window.location.origin
    ).filter((ex) => !CORE_ADAPTER_KEYS.includes(ex.key as WebhookUrlRow["key"]));
    // 兜底：老后端（#475 之前）不下发 adapter_examples，退回基于 urls 的写死渲染（现有行为）。
    const useServerExamples = serverExtraExamples.length > 0;
    const hasMore = useServerExamples || extraRows.length > 0;

    // 折叠按钮展示「更多适配器（短名…）」而非裸数量，让用户预判里面有哪些平台。
    // 短名走独立 i18n（飞书/企业微信需本地化）；未知 key（后端将来新增）回退到服务端 title。
    // 现实可折叠适配器就 4 个（github/gitlab/feishu/multica），故上限设 4：全列出、不加「等」，
    // 避免「等」透支预期；只有后端将来返回 ≥5 个时才截断收口。
    const MORE_TEASER_CAP = 4;
    const KNOWN_BRAND_KEYS = ["github", "gitlab", "feishu", "multica", "wecom"];
    const brandName = (key: string, fallback: string): string =>
        KNOWN_BRAND_KEYS.includes(key)
            ? t(`base.channelWebhook.url.brand.${key}`)
            : fallback;
    const moreNames = useServerExamples
        ? serverExtraExamples.map((ex) => brandName(ex.key, ex.title))
        : extraRows.map((r) => brandName(r.key, t(`base.${r.labelKey}`)));
    const moreNamesShown = moreNames
        .slice(0, MORE_TEASER_CAP)
        .join(t("base.channelWebhook.url.example.moreSep"));
    const moreTeaser =
        moreNames.length > MORE_TEASER_CAP
            ? t("base.channelWebhook.url.example.moreEtc", {
                  values: { names: moreNamesShown },
              })
            : moreNamesShown;

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
                    <div className="wk-webhook-url__value-wrap">
                        <code className="wk-webhook-url__value" title={row.url}>
                            {row.url}
                        </code>
                        <button
                            type="button"
                            className="wk-webhook-card__icon-btn"
                            onClick={() => void handleCopy(row.url, feedbackKey)}
                            title={t("base.channelWebhook.url.copy")}
                            aria-label={t("base.channelWebhook.url.copy")}
                        >
                            {copied ? (
                                <IconTickCircle className="wk-webhook-url__copied-icon" />
                            ) : (
                                <IconCopy />
                            )}
                        </button>
                    </div>
                    <ol className="wk-webhook-url__steps">
                        <li>{t("base.channelWebhook.url.example.github.step1")}</li>
                        <li>{t("base.channelWebhook.url.example.github.step2")}</li>
                        <li>{t("base.channelWebhook.url.example.github.step3")}</li>
                    </ol>
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
            const noteKey =
                row.key === "wecom"
                    ? "base.channelWebhook.url.example.wecom.note"
                    : "base.channelWebhook.url.example.native.note";
            return (
                <div className="wk-webhook-url__example">
                    <pre className="wk-webhook-url__example-code">{curl}</pre>
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
                <div className="wk-webhook-url__value-wrap">
                    <code className="wk-webhook-url__value" title={row.url}>
                        {row.url}
                    </code>
                    <button
                        type="button"
                        className="wk-webhook-card__icon-btn"
                        onClick={() => void handleCopy(row.url, feedbackKey)}
                        title={t("base.channelWebhook.url.copy")}
                        aria-label={t("base.channelWebhook.url.copy")}
                    >
                        {copied ? (
                            <IconTickCircle className="wk-webhook-url__copied-icon" />
                        ) : (
                            <IconCopy />
                        )}
                    </button>
                </div>
                <span className="wk-webhook-url__example-note">
                    {t(`base.channelWebhook.url.example.${row.key}.note`)}
                </span>
            </div>
        );
    };

    // 服务端驱动的「更多适配器」卡片（octo-server #475）：title/description/steps 均来自响应，
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
                <div className="wk-webhook-url__value-wrap">
                    <code className="wk-webhook-url__value" title={ex.url}>
                        {ex.url}
                    </code>
                    <button
                        type="button"
                        className="wk-webhook-card__icon-btn"
                        onClick={() => void handleCopy(ex.url, feedbackKey)}
                        title={t("base.channelWebhook.url.copy")}
                        aria-label={t("base.channelWebhook.url.copy")}
                    >
                        {copiedKey === feedbackKey ? (
                            <IconTickCircle className="wk-webhook-url__copied-icon" />
                        ) : (
                            <IconCopy />
                        )}
                    </button>
                </div>
                {ex.steps.length > 0 && (
                    <div className="wk-webhook-url__steps-block">
                        <button
                            type="button"
                            className="wk-webhook-url__steps-toggle"
                            onClick={() => toggleSteps(ex.key)}
                            aria-expanded={!!openSteps[ex.key]}
                        >
                            <IconChevronDown
                                className={`wk-webhook-url__steps-icon${
                                    openSteps[ex.key] ? " wk-webhook-url__steps-icon--open" : ""
                                }`}
                            />
                            {t("base.channelWebhook.url.example.stepsTitle")}
                        </button>
                        {openSteps[ex.key] && (
                            <ol className="wk-webhook-url__steps">
                                {ex.steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                ))}
                            </ol>
                        )}
                    </div>
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
                                    title={resp.token}
                                >
                                    {resp.token}
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
                            标签用中性的「Webhook 地址」，避免与下方示例里的「通用（native）」重复。 */}
                        <div className="wk-webhook-url__row">
                            <div className="wk-webhook-url__label">
                                {t("base.channelWebhook.url.address")}
                            </div>
                            <div className="wk-webhook-url__value-wrap">
                                <code className="wk-webhook-url__value" title={nativeRow.url}>
                                    {nativeRow.url}
                                </code>
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
                        {coreRows.map((row) => (
                            <div key={row.key} className="wk-webhook-url__example-group">
                                <div className="wk-webhook-url__label">
                                    {t(`base.${row.labelKey}`)}
                                </div>
                                {renderExample(row)}
                            </div>
                        ))}

                        {/* 新增适配器折叠区：默认收起，按需展开。优先服务端示例（#475），
                            老后端无 adapter_examples 时退回基于 urls 的写死渲染。 */}
                        {hasMore && (
                            <div className="wk-webhook-url__more" ref={moreRef}>
                                <button
                                    type="button"
                                    className="wk-webhook-url__more-toggle"
                                    onClick={() => setShowMore((v) => !v)}
                                    aria-expanded={showMore}
                                >
                                    <IconChevronDown
                                        className={`wk-webhook-url__more-icon${
                                            showMore ? " wk-webhook-url__more-icon--open" : ""
                                        }`}
                                    />
                                    {showMore
                                        ? t("base.channelWebhook.url.example.less")
                                        : t("base.channelWebhook.url.example.more", {
                                              values: { names: moreTeaser },
                                          })}
                                </button>
                                {showMore &&
                                    (useServerExamples
                                        ? serverExtraExamples.map((ex) => (
                                              <div
                                                  key={ex.key}
                                                  className="wk-webhook-url__example-group"
                                              >
                                                  <div className="wk-webhook-url__label">
                                                      {ex.title}
                                                  </div>
                                                  {renderServerExample(ex)}
                                              </div>
                                          ))
                                        : extraRows.map((row) => (
                                              <div
                                                  key={row.key}
                                                  className="wk-webhook-url__example-group"
                                              >
                                                  <div className="wk-webhook-url__label">
                                                      {t(`base.${row.labelKey}`)}
                                                  </div>
                                                  {renderExample(row)}
                                              </div>
                                          )))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </WKModal>
    );
}
