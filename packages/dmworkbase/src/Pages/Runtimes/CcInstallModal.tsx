import React, { useState } from "react"
import { t } from "../../i18n"
import { validateCcInstall as rawValidate, normalizeGatewayUrl, type CcInstallValidationResult, type UrlErrorCode, type KeyErrorCode } from "./ccInstallValidate"

// Deployment-provided default gateway (e.g. set at build time for the hosted
// product). OSS default is empty → a generic placeholder. A prefilled value is
// just a suggestion: the user can overwrite it with their own gateway.
const DEFAULT_GATEWAY_URL: string = (import.meta.env.VITE_OCTO_DEFAULT_GATEWAY_URL as string | undefined) ?? ""

export function CcInstallModal(props: { onSubmit: (gatewayUrl: string, apiKey: string) => void; onCancel: () => void }) {
    const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GATEWAY_URL)
    const [apiKey, setApiKey] = useState("")
    const [touched, setTouched] = useState(false)
    const v = rawValidate(gatewayUrl, apiKey)

    // Move error text resolution into render so it updates on locale switch
    const urlErrorText = v.urlError ? getErrorText(v.urlError) : undefined
    const keyErrorText = v.keyError ? getErrorText(v.keyError) : undefined

    const submit = () => {
        setTouched(true)
        if (!v.ok) return
        // Normalize the gateway (strip a trailing /v1) so the SDK's appended
        // /v1/messages doesn't double — matches cc-channel-octo configure.
        props.onSubmit(normalizeGatewayUrl(gatewayUrl), apiKey.trim())
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
                <div className="wk-cc-install-hint">{t("base.runtimes.ccInstall.gatewayHint")}</div>
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
                    <button type="button" className="wk-cc-install-btn cancel" onClick={props.onCancel}>{t("base.runtimes.ccInstall.cancel")}</button>
                    <button type="button" className={`wk-cc-install-btn submit${v.ok ? "" : " disabled"}`} disabled={!v.ok} onClick={submit}>{t("base.runtimes.ccInstall.submit")}</button>
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
