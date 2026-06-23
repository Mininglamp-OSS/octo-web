import React, { useState } from "react"
import { t } from "../../i18n"
import { validateCcInstall as rawValidate, normalizeGatewayUrl, type CcInstallValidationResult, type UrlErrorCode, type KeyErrorCode } from "./ccInstallValidate"
import { fetchLlmModels } from "./ccInstallApi"

// Deployment-provided default gateway (e.g. set at build time for the hosted
// product). OSS default is empty. Shown as the input PLACEHOLDER (grey hint) —
// a suggestion, not a prefilled value; the user's typed value overrides it.
const DEFAULT_GATEWAY_URL: string = (import.meta.env.VITE_OCTO_DEFAULT_GATEWAY_URL as string | undefined) ?? ""

export function CcInstallModal(props: { onSubmit: (gatewayUrl: string, apiKey: string, model: string) => void; onCancel: () => void }) {
    const [gatewayUrl, setGatewayUrl] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [model, setModel] = useState("")
    const [models, setModels] = useState<string[]>([])
    const [loadingModels, setLoadingModels] = useState(false)
    const [modelsError, setModelsError] = useState(false)
    const [touched, setTouched] = useState(false)
    // The grey placeholder default is also the value USED when the field is left
    // empty — so the user can just fill the key and proceed without retyping the
    // suggested gateway. A typed value overrides it.
    const effectiveGatewayUrl = gatewayUrl.trim() || DEFAULT_GATEWAY_URL
    const v = rawValidate(effectiveGatewayUrl, apiKey)

    // Move error text resolution into render so it updates on locale switch
    const urlErrorText = v.urlError ? getErrorText(v.urlError) : undefined
    const keyErrorText = v.keyError ? getErrorText(v.keyError) : undefined

    // Model is optional; the dropdown is populated from the gateway on demand. A
    // valid url + key are required to ask the gateway for its model list.
    const canFetchModels = !v.urlError && !!apiKey.trim() && !loadingModels
    const loadModels = async () => {
        setLoadingModels(true)
        setModelsError(false)
        try {
            const list = await fetchLlmModels(normalizeGatewayUrl(effectiveGatewayUrl), apiKey.trim())
            setModels(list)
            // An empty list is a SUCCESSFUL response with no models — not a
            // failure. Leave the dropdown empty and let the user type a name;
            // only a thrown error (below) is a real fetch failure.
        } catch {
            setModelsError(true)
        } finally {
            setLoadingModels(false)
        }
    }

    const submit = () => {
        setTouched(true)
        if (!v.ok) return
        // Normalize the gateway (strip a trailing /v1) so the SDK's appended
        // /v1/messages doesn't double — matches cc-channel-octo configure. Model
        // is optional (empty → gateway/SDK default).
        props.onSubmit(normalizeGatewayUrl(effectiveGatewayUrl), apiKey.trim(), model.trim())
    }

    return (
        <div className="wk-cc-install-mask" onClick={props.onCancel}>
            <div className="wk-cc-install-modal" onClick={e => e.stopPropagation()}>
                <div className="wk-cc-install-title">{t("base.runtimes.ccInstall.title")}</div>
                <div className="wk-cc-install-field">
                    <label className="wk-cc-install-label" htmlFor="cc-install-gateway">{t("base.runtimes.ccInstall.gatewayUrl")}</label>
                    <input
                        id="cc-install-gateway"
                        className="wk-cc-install-input"
                        type="url"
                        name="cc-gateway-url"
                        placeholder={DEFAULT_GATEWAY_URL || "https://"}
                        value={gatewayUrl}
                        onChange={e => setGatewayUrl(e.target.value)}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                    />
                    {touched && urlErrorText && <div className="wk-cc-install-err">{urlErrorText}</div>}
                </div>
                <div className="wk-cc-install-field">
                    <label className="wk-cc-install-label" htmlFor="cc-install-key">{t("base.runtimes.ccInstall.apiKey")}</label>
                    <input
                        id="cc-install-key"
                        className="wk-cc-install-input"
                        type="password"
                        name="cc-api-key"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        autoComplete="new-password"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                    />
                    {touched && keyErrorText && <div className="wk-cc-install-err">{keyErrorText}</div>}
                </div>
                <div className="wk-cc-install-field">
                    <label className="wk-cc-install-label" htmlFor="cc-install-model">{t("base.runtimes.ccInstall.modelLabel")}</label>
                    <div className="wk-cc-install-model-row">
                        <input
                            id="cc-install-model"
                            className="wk-cc-install-input"
                            list="cc-install-model-options"
                            name="cc-model"
                            placeholder={t("base.runtimes.ccInstall.modelPlaceholder")}
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            autoComplete="off"
                        />
                        <datalist id="cc-install-model-options">
                            {models.map((m: string) => <option key={m} value={m} />)}
                        </datalist>
                        <button
                            type="button"
                            className="wk-cc-install-btn"
                            disabled={!canFetchModels}
                            onClick={loadModels}
                        >
                            {t("base.runtimes.ccInstall.fetchModels")}
                        </button>
                    </div>
                    {modelsError && <div className="wk-cc-install-hint">{t("base.runtimes.ccInstall.fetchModelsFailed")}</div>}
                </div>
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
