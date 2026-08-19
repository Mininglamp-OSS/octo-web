// DocumentPreviewEntry — the drop-in "port" for document AI 速览.
//
// A fully self-contained capability: renders a trigger button and, on click, a
// portal-mounted side panel that streams an ephemeral quick-glance of the document
// (backend never persists it — not a Summary deliverable). Everything is inside
// @dmwork/summary; the host (the detached docs module) only needs to render this
// one component in its header:
//
//     import { DocumentPreviewEntry } from '@dmwork/summary/preview'
//     <DocumentPreviewEntry docId={docId} spaceId={space} />
//
// The host does NOT need to know about the summary service, SSE, i18n, or state
// handling — all of it lives here. See ./README.md for the integration contract.

import React, { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { t } from '@octo/base';
import { streamDocumentPreview } from '../api/summaryApi';
import { ensurePreviewI18n } from './i18n';
import './DocumentPreviewEntry.css';

ensurePreviewI18n();

export interface DocumentPreviewEntryProps {
    /** The document to glance. Required. */
    docId: string;
    /** Viewer's current space; falls back to WKApp.shared.currentSpaceId. */
    spaceId?: string;
    /** Optional pinned version; omit for the latest. */
    version?: string;
    /**
     * Optional bot 升级出口: called with docId when the user clicks "问 Bot 追问"
     * (only shown after a completed glance). Omit to hide the action.
     */
    onAskBot?: (docId: string) => void;
    /** Extra className for the default trigger button. */
    className?: string;
    /**
     * Optional custom trigger. Receives `open()` and the current open state, so the
     * host can render its own header button instead of the default ✨AI速览 one.
     */
    renderTrigger?: (open: () => void, active: boolean) => ReactNode;
}

type PreviewStatus = 'loading' | 'streaming' | 'done' | 'error' | 'empty';

function classifyError(message: string): { status: PreviewStatus; text: string } {
    // Empty-doc comes back as a pre-stream 400 whose message contains "没有可总结内容".
    if (message.includes('没有可总结内容')) {
        return { status: 'empty', text: t('summaryPreview.empty') };
    }
    if (message.includes('不可访问') || message.includes('权限') || message.includes('403')) {
        return { status: 'error', text: t('summaryPreview.errorForbidden') };
    }
    if (message.includes('超时') || message.includes('timeout') || message.includes('暂不可用')) {
        return { status: 'error', text: t('summaryPreview.errorTimeout') };
    }
    return { status: 'error', text: t('summaryPreview.errorGeneric') };
}

const REMARK_PLUGINS = [remarkGfm];

function DocumentPreviewPanel(props: {
    docId: string;
    spaceId?: string;
    version?: string;
    onClose: () => void;
    onAskBot?: (docId: string) => void;
}) {
    const { docId, spaceId, version, onClose, onAskBot } = props;
    const [status, setStatus] = useState<PreviewStatus>('loading');
    const [text, setText] = useState('');
    const [errorText, setErrorText] = useState('');
    const [reloadKey, setReloadKey] = useState(0);
    const handleRef = useRef<{ close: () => void } | null>(null);

    useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        setText('');
        setErrorText('');
        let acc = '';

        const handle = streamDocumentPreview(
            { documentId: docId, version, spaceId },
            {
                onDelta: (chunk) => {
                    if (cancelled) return;
                    acc += chunk;
                    setText(acc);
                    setStatus((s) => (s === 'loading' ? 'streaming' : s));
                },
                onDone: () => {
                    if (cancelled) return;
                    setStatus(acc.trim() ? 'done' : 'empty');
                },
                onError: (err) => {
                    if (cancelled) return;
                    const { status: st, text: msg } = classifyError(err.message || '');
                    // Keep partial content rather than wiping it on a late error.
                    if (acc.trim() && st === 'error') {
                        setStatus('done');
                        return;
                    }
                    setErrorText(msg);
                    setStatus(st);
                },
            },
        );
        handleRef.current = handle;
        return () => {
            cancelled = true;
            handle.close();
        };
    }, [docId, version, spaceId, reloadKey]);

    const busy = status === 'loading' || status === 'streaming';
    const stop = () => {
        handleRef.current?.close();
        setStatus((s) => (s === 'loading' || s === 'streaming' ? 'done' : s));
    };

    return (
        <div className="dm-doc-preview-overlay" role="presentation" onMouseDown={onClose}>
            <aside
                className="dm-doc-preview-drawer"
                role="complementary"
                aria-label={t('summaryPreview.title')}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <header className="dm-doc-preview-head">
                    <span className="dm-doc-preview-title">✨ {t('summaryPreview.title')}</span>
                    <div className="dm-doc-preview-head-actions">
                        {busy && (
                            <button type="button" className="dm-doc-preview-btn" onClick={stop}>
                                {t('summaryPreview.stop')}
                            </button>
                        )}
                        <button
                            type="button"
                            className="dm-doc-preview-btn"
                            onClick={onClose}
                            aria-label="close"
                        >
                            ✕
                        </button>
                    </div>
                </header>

                <div className="dm-doc-preview-body">
                    {status === 'loading' && (
                        <div className="dm-doc-preview-hint">{t('summaryPreview.loading')}</div>
                    )}

                    {(status === 'streaming' || status === 'done') && (
                        <div className="dm-doc-preview-md">
                            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={[rehypeSanitize]}>
                                {text}
                            </ReactMarkdown>
                            {status === 'streaming' && <span className="dm-doc-preview-caret">▍</span>}
                        </div>
                    )}

                    {status === 'empty' && (
                        <div className="dm-doc-preview-hint">{t('summaryPreview.empty')}</div>
                    )}

                    {status === 'error' && (
                        <div className="dm-doc-preview-error">
                            <div>{errorText}</div>
                            <button
                                type="button"
                                className="dm-doc-preview-btn"
                                onClick={() => setReloadKey((k) => k + 1)}
                            >
                                {t('summaryPreview.retry')}
                            </button>
                        </div>
                    )}
                </div>

                {status === 'done' && onAskBot && (
                    <footer className="dm-doc-preview-foot">
                        <button
                            type="button"
                            className="dm-doc-preview-btn dm-doc-preview-askbot"
                            onClick={() => onAskBot(docId)}
                        >
                            💬 {t('summaryPreview.askBot')}
                        </button>
                    </footer>
                )}
            </aside>
        </div>
    );
}

export function DocumentPreviewEntry(props: DocumentPreviewEntryProps) {
    const { docId, spaceId, version, onAskBot, className, renderTrigger } = props;
    const [open, setOpen] = useState(false);
    const openPanel = () => setOpen(true);

    return (
        <>
            {renderTrigger ? (
                renderTrigger(openPanel, open)
            ) : (
                <button
                    type="button"
                    className={`dm-doc-preview-trigger${className ? ' ' + className : ''}${open ? ' is-active' : ''}`}
                    title={t('summaryPreview.button')}
                    aria-pressed={open}
                    onClick={openPanel}
                >
                    ✨ {t('summaryPreview.button')}
                </button>
            )}
            {open &&
                createPortal(
                    <DocumentPreviewPanel
                        docId={docId}
                        spaceId={spaceId}
                        version={version}
                        onClose={() => setOpen(false)}
                        onAskBot={onAskBot}
                    />,
                    document.body,
                )}
        </>
    );
}
