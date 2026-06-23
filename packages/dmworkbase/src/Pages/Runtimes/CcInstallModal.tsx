import React, { useState, useRef } from "react"
import { t } from "../../i18n"
import { validateCcInstall as rawValidate, normalizeGatewayUrl, type UrlErrorCode, type KeyErrorCode } from "./ccInstallValidate"
import { fetchLlmModels } from "./ccInstallApi"

// Deployment-provided default gateway (e.g. set at build time for the hosted
// product). OSS default is empty. Shown as the input PLACEHOLDER (grey hint) —
// a suggestion, not a prefilled value; the user's typed value overrides it.
const DEFAULT_GATEWAY_URL: string = (import.meta.env.VITE_OCTO_DEFAULT_GATEWAY_URL as string | undefined) ?? ""

// Per-instance unique datalist id. React 17 (this monorepo's pinned version)
// has no useId, so use a module-level counter seeded once per mount.
let ccInstallModalSeq = 0

export function CcInstallModal(props: { onSubmit: (gatewayUrl: string, apiKey: string, model: string) => void; onCancel: () => void }) {
    const [gatewayUrl, setGatewayUrl] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [model, setModel] = useState("")
    const [models, setModels] = useState<string[]>([])
    const [loadingModels, setLoadingModels] = useState(false)
    const [modelsError, setModelsError] = useState(false)
    const [touched, setTouched] = useState(false)
    // Per-instance id base so two modals (e.g. a future multi-pane layout) can't
    // have their <input list=…> / <label htmlFor=…> resolve to the wrong control
    // by document order. Seeded once per mount (useState initializer runs only on
    // first render). React 17 (this monorepo's pinned version) has no useId.
    const [idBase] = useState(() => `cc-install-${++ccInstallModalSeq}`)
    const gatewayId = `${idBase}-gateway`
    const keyId = `${idBase}-key`
    const modelId = `${idBase}-model`
    const modelListId = `${idBase}-model-options`
    // Monotonic token: only the most recent loadModels() may publish its result,
    // so a slow earlier fetch can't overwrite the list for newer gateway/key input.
    const fetchSeq = useRef(0)
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
        const seq = ++fetchSeq.current
        setLoadingModels(true)
        setModelsError(false)
        try {
            const list = await fetchLlmModels(normalizeGatewayUrl(effectiveGatewayUrl), apiKey.trim())
            if (seq !== fetchSeq.current) return // a newer fetch superseded this one
            setModels(list)
            // An empty list is a SUCCESSFUL response with no models — not a
            // failure. Leave the dropdown empty and let the user type a name;
            // only a thrown error (below) is a real fetch failure.
        } catch {
            if (seq !== fetchSeq.current) return
            // Drop any previously-fetched list so a stale gateway's models don't
            // linger after a failed refetch against a different gateway/key.
            setModels([])
            setModelsError(true)
        } finally {
            if (seq === fetchSeq.current) setLoadingModels(false)
        }
    }

    // A fetched model list belongs to the (gateway, key) pair it was fetched
    // with; editing either invalidates it. Always bump the token — even mid-fetch
    // when the list is still empty — so an in-flight request for the old
    // gateway/key can't republish after the edit. Because the superseded fetch's
    // `finally` will then skip its `setLoadingModels(false)` (its seq no longer
    // matches), clear the loading flag here so the button re-enables for the new
    // input; then drop any shown list.
    const invalidateModels = () => {
        fetchSeq.current++
        setLoadingModels(false)
        if (models.length > 0) setModels([])
        if (modelsError) setModelsError(false)
    }
    const onGatewayChange = (value: string) => {
        setGatewayUrl(value)
        invalidateModels()
    }
    const onApiKeyChange = (value: string) => {
        setApiKey(value)
        invalidateModels()
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
                    <label className="wk-cc-install-label" htmlFor={gatewayId}>{t("base.runtimes.ccInstall.gatewayUrl")}</label>
                    <input
                        id={gatewayId}
                        className="wk-cc-install-input"
                        type="url"
                        name="cc-gateway-url"
                        placeholder={DEFAULT_GATEWAY_URL || "https://"}
                        value={gatewayUrl}
                        onChange={e => onGatewayChange(e.target.value)}
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
                    <label className="wk-cc-install-label" htmlFor={keyId}>{t("base.runtimes.ccInstall.apiKey")}</label>
                    <input
                        id={keyId}
                        className="wk-cc-install-input"
                        type="password"
                        name="cc-api-key"
                        value={apiKey}
                        onChange={e => onApiKeyChange(e.target.value)}
                        autoComplete="new-password"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                    />
                    {touched && keyErrorText && <div className="wk-cc-install-err">{keyErrorText}</div>}
                </div>
                <div className="wk-cc-install-field">
                    <label className="wk-cc-install-label" htmlFor={modelId}>{t("base.runtimes.ccInstall.modelLabel")}</label>
                    <div className="wk-cc-install-model-row">
                        <input
                            id={modelId}
                            className="wk-cc-install-input"
                            list={modelListId}
                            name="cc-model"
                            placeholder={t("base.runtimes.ccInstall.modelPlaceholder")}
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            autoComplete="off"
                        />
                        <datalist id={modelListId}>
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
