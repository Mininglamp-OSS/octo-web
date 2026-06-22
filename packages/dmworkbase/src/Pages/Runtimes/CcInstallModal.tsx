import React, { useState } from "react"
import { t } from "../../i18n"

export function validateCcInstall(gatewayUrl: string, apiKey: string): { ok: boolean; urlError?: string; keyError?: string } {
    let urlError: string | undefined
    let keyError: string | undefined
    if (!gatewayUrl.trim()) {
        urlError = t("base.runtimes.ccInstall.urlRequired")
    } else if (!/^https?:\/\/.+/i.test(gatewayUrl.trim())) {
        urlError = t("base.runtimes.ccInstall.urlInvalid")
    }
    if (!apiKey.trim()) {
        keyError = t("base.runtimes.ccInstall.keyRequired")
    }
    return { ok: !urlError && !keyError, urlError, keyError }
}

export function CcInstallModal(props: { onSubmit: (gatewayUrl: string, apiKey: string) => void; onCancel: () => void }) {
    const [gatewayUrl, setGatewayUrl] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [touched, setTouched] = useState(false)
    const v = validateCcInstall(gatewayUrl, apiKey)

    const submit = () => {
        setTouched(true)
        if (!v.ok) return
        props.onSubmit(gatewayUrl.trim(), apiKey.trim())
    }

    return (
        <div className="wk-cc-install-mask" onClick={props.onCancel}>
            <div className="wk-cc-install-modal" onClick={e => e.stopPropagation()}>
                <div className="wk-cc-install-title">{t("base.runtimes.ccInstall.title")}</div>
                <label className="wk-cc-install-label">{t("base.runtimes.ccInstall.gatewayUrl")}</label>
                <input
                    className="wk-cc-install-input"
                    type="url"
                    placeholder="https://"
                    value={gatewayUrl}
                    onChange={e => setGatewayUrl(e.target.value)}
                />
                {touched && v.urlError && <div className="wk-cc-install-err">{v.urlError}</div>}
                <label className="wk-cc-install-label">{t("base.runtimes.ccInstall.apiKey")}</label>
                <input
                    className="wk-cc-install-input"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                />
                {touched && v.keyError && <div className="wk-cc-install-err">{v.keyError}</div>}
                <div className="wk-cc-install-actions">
                    <span className="wk-cc-install-btn cancel" onClick={props.onCancel}>{t("base.runtimes.ccInstall.cancel")}</span>
                    <span className={`wk-cc-install-btn submit${v.ok ? "" : " disabled"}`} onClick={submit}>{t("base.runtimes.ccInstall.submit")}</span>
                </div>
            </div>
        </div>
    )
}
