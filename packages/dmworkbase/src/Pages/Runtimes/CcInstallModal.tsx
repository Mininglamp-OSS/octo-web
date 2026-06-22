import React, { useState } from "react"
import { t } from "../../i18n"
import { validateCcInstall as rawValidate, type CcInstallValidationResult, type UrlErrorCode, type KeyErrorCode } from "./ccInstallValidate"

export function CcInstallModal(props: { onSubmit: (gatewayUrl: string, apiKey: string) => void; onCancel: () => void }) {
    const [gatewayUrl, setGatewayUrl] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [touched, setTouched] = useState(false)
    const v = rawValidate(gatewayUrl, apiKey)

    // Move error text resolution into render so it updates on locale switch
    const urlErrorText = v.urlError ? getErrorText(v.urlError) : undefined
    const keyErrorText = v.keyError ? getErrorText(v.keyError) : undefined

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
                {touched && urlErrorText && <div className="wk-cc-install-err">{urlErrorText}</div>}
                <label className="wk-cc-install-label">{t("base.runtimes.ccInstall.apiKey")}</label>
                <input
                    className="wk-cc-install-input"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                />
                {touched && keyErrorText && <div className="wk-cc-install-err">{keyErrorText}</div>}
                <div className="wk-cc-install-actions">
                    <span className="wk-cc-install-btn cancel" onClick={props.onCancel}>{t("base.runtimes.ccInstall.cancel")}</span>
                    <span className={`wk-cc-install-btn submit${v.ok ? "" : " disabled"}`} onClick={submit}>{t("base.runtimes.ccInstall.submit")}</span>
                </div>
            </div>
        </div>
    )
}

function getErrorText(code: UrlErrorCode | KeyErrorCode): string {
    switch (code) {
        case "url_required": return t("base.runtimes.ccInstall.urlRequired")
        case "url_invalid": return t("base.runtimes.ccInstall.urlInvalid")
        case "key_required": return t("base.runtimes.ccInstall.keyRequired")
        default: return String(code)
    }
}
