import React from 'react'
import { Copy, Plus, RefreshCw, Server, TriangleAlert } from 'lucide-react'
import WKButton from '../../Components/WKButton'
import WKModal from '../../Components/WKModal'
import type { HarnessRuntimeListItem, HarnessRuntimeSettingsProps } from './types'
import './index.css'

function RuntimeRow({ runtime, labels }: {
  runtime: HarnessRuntimeListItem
  labels: HarnessRuntimeSettingsProps['labels']
}) {
  return (
    <li className="wk-harness-runtime-settings__runtime">
      <span className={`wk-harness-runtime-settings__status-dot is-${runtime.status}`} aria-hidden="true" />
      <span className="wk-harness-runtime-settings__runtime-main">
        <strong>{runtime.name}</strong>
        <span>{runtime.deviceLabel}</span>
        <code title={runtime.id}>{runtime.id}</code>
      </span>
      <span className="wk-harness-runtime-settings__runtime-meta">
        <span className={`wk-harness-runtime-settings__status is-${runtime.status}`}>{labels.status[runtime.status]}</span>
        {runtime.runtimeVersion && <span>{labels.runtimeVersion}: {runtime.runtimeVersion}</span>}
        <span>{labels.lastHeartbeat}: {runtime.lastHeartbeatLabel}</span>
      </span>
    </li>
  )
}

function CopyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <WKButton type="button" size="sm" variant="secondary" icon={<Copy size={14} aria-hidden="true" />} onClick={onClick}>
      {label}
    </WKButton>
  )
}

const HarnessRuntimeSettings: React.FC<HarnessRuntimeSettingsProps> = (props) => {
  const {
    className, labels, runtimes, loading, refreshing, loadError, addOpen,
    enrollment, enrollmentLoading, enrollmentError, commandCopied, onRefresh, onOpenAdd,
    onCloseAdd, onRetryEnrollment,
    onCopyCommand,
  } = props

  return (
    <div className={`wk-harness-runtime-settings${className ? ` ${className}` : ''}`}>
      <header className="wk-harness-runtime-settings__header">
        <span className="wk-harness-runtime-settings__heading">
          <h2>{labels.title}</h2>
          <p>{labels.description}</p>
        </span>
        <span className="wk-harness-runtime-settings__actions">
          <WKButton type="button" variant="ghost" iconOnly title={labels.refresh} aria-label={labels.refresh}
            disabled={loading || refreshing} onClick={onRefresh}
            icon={<RefreshCw className={refreshing ? 'is-spinning' : ''} size={17} aria-hidden="true" />} />
          <WKButton type="button" variant="primary" icon={<Plus size={17} aria-hidden="true" />} onClick={onOpenAdd}>
            {labels.addRuntime}
          </WKButton>
        </span>
      </header>

      <section className="wk-harness-runtime-settings__content" aria-labelledby="wk-runtime-list-title">
        <h3 id="wk-runtime-list-title">{labels.runtimeList}</h3>
        {loading && <div className="wk-harness-runtime-settings__state" aria-live="polite"><span className="wk-harness-runtime-settings__spinner" aria-hidden="true" /><span>{labels.loading}</span></div>}
        {!loading && loadError && <div className="wk-harness-runtime-settings__state" role="alert"><TriangleAlert size={22} aria-hidden="true" /><strong>{labels.loadFailed}</strong><span>{loadError}</span><WKButton type="button" size="sm" variant="secondary" onClick={onRefresh}>{labels.retry}</WKButton></div>}
        {!loading && !loadError && runtimes.length === 0 && <div className="wk-harness-runtime-settings__state"><Server size={25} aria-hidden="true" /><strong>{labels.emptyTitle}</strong><span>{labels.emptyDescription}</span></div>}
        {!loading && !loadError && runtimes.length > 0 && <ul className="wk-harness-runtime-settings__list">{runtimes.map((runtime) => <RuntimeRow key={runtime.id} runtime={runtime} labels={labels} />)}</ul>}
      </section>

      <WKModal visible={addOpen} onCancel={onCloseAdd} title={labels.addTitle} size="lg"
        options={{ closable: !enrollmentLoading, maskClosable: !enrollmentLoading, closeOnEsc: !enrollmentLoading }}
        footer={enrollment
          ? <WKButton type="button" variant="primary" onClick={onCloseAdd}>{labels.done}</WKButton>
          : enrollmentError
            ? <><WKButton type="button" variant="secondary" onClick={onCloseAdd}>{labels.cancel}</WKButton><WKButton type="button" variant="primary" onClick={onRetryEnrollment}>{labels.retry}</WKButton></>
            : null}>
        {!enrollment ? (
          <div className="wk-harness-runtime-settings__state wk-harness-runtime-settings__state--modal" aria-live="polite">
            {enrollmentLoading && <><span className="wk-harness-runtime-settings__spinner" aria-hidden="true" /><span>{labels.creatingEnrollment}</span></>}
            {!enrollmentLoading && enrollmentError && <><TriangleAlert size={22} aria-hidden="true" /><strong>{labels.requestFailed}</strong><span role="alert">{enrollmentError}</span></>}
          </div>
        ) : (
          <div className="wk-harness-runtime-settings__enrollment">
            <section><header><span><strong>{labels.command}</strong><small>{labels.commandDescription}</small></span><CopyButton label={commandCopied ? labels.copied : labels.copyCommand} onClick={onCopyCommand} /></header><pre><code>{enrollment.command}</code></pre><small>{labels.expiresAt}: {enrollment.expiresAtLabel}</small></section>
          </div>
        )}
      </WKModal>
    </div>
  )
}

export default HarnessRuntimeSettings
export type * from './types'
