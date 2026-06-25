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
    WebhookUrlRow,
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

    // 适配器分两层展示：native（通用）/ wecom（企微兼容）为最常用，默认展开；
    // github/gitlab/feishu/multica 收进「更多适配器」折叠区默认隐藏，压低默认高度。
    const CORE_ADAPTER_KEYS: ReadonlyArray<WebhookUrlRow["key"]> = [
        "native",
        "wecom",
    ];
    const coreRows = rows.filter((r) => CORE_ADAPTER_KEYS.includes(r.key));
    const extraRows = rows.filter((r) => !CORE_ADAPTER_KEYS.includes(r.key));
    const [showMore, setShowMore] = useState(false);

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
        if (row.key === "native" || row.key === "wecom") {
            // 复用的 curl 卡片：代码块 + 说明 + 复制按钮（带 ✓ 反馈）。
            const renderCurlBlock = (
                curl: string,
                noteText: string,
                fbKey: string
            ) => {
                const blockCopied = copiedKey === fbKey;
                return (
                    <div className="wk-webhook-url__example">
                        <pre className="wk-webhook-url__example-code">{curl}</pre>
                        <span className="wk-webhook-url__example-note">{noteText}</span>
                        <button
                            type="button"
                            className="wk-webhook-url__example-copy"
                            onClick={() => void handleCopy(curl, fbKey)}
                        >
                            {blockCopied ? (
                                <IconTickCircle className="wk-webhook-url__copied-icon" />
                            ) : (
                                <IconCopy />
                            )}
                            {blockCopied
                                ? t("base.channelWebhook.toast.copied")
                                : t("base.channelWebhook.url.example.copy")}
                        </button>
                    </div>
                );
            };

            if (row.key === "wecom") {
                const wecomCurl = buildWebhookCurlExample(
                    "wecom",
                    row.url,
                    t("base.channelWebhook.url.example.wecom.sample")
                );
                return renderCurlBlock(
                    wecomCurl,
                    t("base.channelWebhook.url.example.wecom.note"),
                    feedbackKey
                );
            }

            // native：基础推送示例 + 单独一条「@提及」示例。仅 native 端点解析 mention
            // （契约 §B），故 @ 示例只挂在 native 这一组下。
            const basicCurl = buildWebhookCurlExample(
                "native",
                row.url,
                t("base.channelWebhook.url.example.native.sample")
            );
            // 用 uids 定向 @（占位 UID 需替换）+ render:true 让后端自动补 @昵称气泡；
            // @所有人/@所有AI 走 mention.all / mention.bots，由说明文案引导，避免默认
            // 例子里塞入需能力位放行才生效的广播位造成误解。
            const mentionCurl = buildWebhookCurlExample(
                "native",
                row.url,
                t("base.channelWebhook.url.example.native.mentionSample"),
                { uids: ["uid_xxxxxxxx"], render: true }
            );
            return (
                <>
                    {renderCurlBlock(
                        basicCurl,
                        t("base.channelWebhook.url.example.native.note"),
                        feedbackKey
                    )}
                    <div className="wk-webhook-url__label">
                        {t("base.channelWebhook.url.example.native.mentionTitle")}
                    </div>
                    {renderCurlBlock(
                        mentionCurl,
                        t("base.channelWebhook.url.example.native.mentionNote"),
                        `mention:${row.key}`
                    )}
                </>
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

                        {/* 新增适配器（gitlab/feishu/multica）折叠区：默认收起，按需展开 */}
                        {extraRows.length > 0 && (
                            <div className="wk-webhook-url__more">
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
                                              values: { count: extraRows.length },
                                          })}
                                </button>
                                {showMore &&
                                    extraRows.map((row) => (
                                        <div
                                            key={row.key}
                                            className="wk-webhook-url__example-group"
                                        >
                                            <div className="wk-webhook-url__label">
                                                {t(`base.${row.labelKey}`)}
                                            </div>
                                            {renderExample(row)}
                                        </div>
                                    ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </WKModal>
    );
}
