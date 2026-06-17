import React from "react"
import { Popover, Toast } from "@douyinfe/semi-ui"
import { IconHelpCircleStroked, IconCopy } from "@douyinfe/semi-icons"
import { t } from "../../i18n"
import { copyToClipboard } from "../../Utils/clipboard"
import { getInstallGuide, buildInstallCopyText } from "./installGuide"
import { providerLabels } from "./botsApi"
import WKApp from "../../App"

// 「Octo 插件版本」右侧的问号入口: 点击就地展开安装指导 Popover.
// 该 provider 无安装指导时不渲染 (与 octoPlugin 字段的 hasGuide 守卫一致).
export function InstallGuidePopover({ provider }: { provider: string }) {
    // 安装指引里的 apiUrl 自动填为真实 server_url(同 daemon onboarding 那段),
    // 拿到前保留 <OCTO_API_URL> 占位。展开 Popover 时懒加载;失败不锁死,下次展开重试。
    const [apiUrl, setApiUrl] = React.useState<string | undefined>(undefined)
    const inFlight = React.useRef(false)
    const mounted = React.useRef(true)
    React.useEffect(() => () => { mounted.current = false }, [])

    const guide = getInstallGuide(provider, apiUrl)
    if (!guide) return null
    const providerLabel = providerLabels[provider] || provider

    const onVisibleChange = (visible: boolean) => {
        // 已拿到地址或正在请求则不重复;失败时 inFlight 复位,下次展开会重试。
        if (!visible || apiUrl || inFlight.current) return
        inFlight.current = true
        WKApp.apiClient
            .get("/runtime-onboarding", { param: { space_id: WKApp.shared.currentSpaceId } })
            .then((resp: { server_url?: string }) => {
                if (mounted.current && resp?.server_url) setApiUrl(resp.server_url)
            })
            .catch(() => {
                /* 拿不到就保留占位, 不打扰用户; inFlight 复位后下次展开重试 */
            })
            .finally(() => {
                inFlight.current = false
            })
    }

    // 复用 Utils/clipboard 的 copyToClipboard, 失败走 clipboardUnsupported 文案.
    const copy = async (text: string, label: string) => {
        const ok = await copyToClipboard(text)
        if (ok) {
            Toast.success({ content: t("base.runtimes.common.copied", { values: { text: label } }), duration: 2 })
        } else {
            Toast.warning({ content: t("base.runtimes.common.clipboardUnsupported"), duration: 2 })
        }
    }

    const content = (
        <div className="wk-rt-guide">
            <div className="wk-rt-guide__head">
                <span className="wk-rt-guide__title">
                    {t("base.runtimes.install.title", { values: { provider: providerLabel } })}
                </span>
                <button
                    type="button"
                    className="wk-rt-guide__copyall"
                    onClick={() => copy(buildInstallCopyText(provider, t, apiUrl), t("base.runtimes.install.copyAllLabel"))}
                >
                    {t("base.runtimes.install.copyAll")}
                </button>
            </div>
            <p className="wk-rt-guide__intro">{t(guide.introKey)}</p>
            <div className="wk-rt-guide__steps">
                {guide.steps.map((step, i) => (
                    <div className="wk-rt-guide__step" key={i}>
                        <div className="wk-rt-guide__step-head">
                            <span className="wk-rt-guide__step-idx">{i + 1}</span>
                            <span className="wk-rt-guide__step-title">{t(step.titleKey)}</span>
                        </div>
                        {step.noteKey && (
                            <p className="wk-rt-guide__step-note">{t(step.noteKey)}</p>
                        )}
                        {step.command && (
                            <div className="wk-rt-guide__cmd">
                                <pre className="wk-rt-guide__cmd-text">{step.command}</pre>
                                <button
                                    type="button"
                                    className="wk-rt-guide__cmd-copy"
                                    onClick={() => copy(step.command!, t(step.titleKey))}
                                    aria-label={t("base.runtimes.install.copyStep")}
                                >
                                    <IconCopy size="small" />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )

    return (
        <Popover content={content} trigger="click" position="bottomLeft" showArrow onVisibleChange={onVisibleChange}>
            <button
                type="button"
                className="wk-rt-guide__trigger"
                aria-label={t("base.runtimes.install.entry")}
            >
                <IconHelpCircleStroked size="small" />
            </button>
        </Popover>
    )
}
