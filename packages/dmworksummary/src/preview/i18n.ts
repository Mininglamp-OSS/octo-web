// Self-contained i18n for the document AI 速览 port. Registers its OWN namespace
// so the component works even when the host (e.g. the detached docs module) has
// not loaded the full SummaryModule. Idempotent.

import { i18n } from '@octo/base';

const zhCN = {
    button: 'AI速览',
    title: 'AI速览',
    loading: '正在读取文档…',
    stop: '停止',
    retry: '重试',
    askBot: '问 Bot 追问',
    empty: '这份文档暂无足够内容可速览',
    errorForbidden: '你没有权限查看这份文档',
    errorTimeout: '文档服务响应超时，请稍后重试',
    errorGeneric: '文档速览生成失败，请重试',
};

const enUS = {
    button: 'AI Glance',
    title: 'AI Glance',
    loading: 'Reading the document…',
    stop: 'Stop',
    retry: 'Retry',
    askBot: 'Ask the Bot',
    empty: 'This document has too little content to glance',
    errorForbidden: "You don't have access to this document",
    errorTimeout: 'The document service timed out, please retry',
    errorGeneric: 'Failed to generate the glance, please retry',
};

let registered = false;

export function ensurePreviewI18n(): void {
    if (registered) return;
    registered = true;
    i18n.registerNamespace('summaryPreview', {
        'zh-CN': zhCN,
        'en-US': enUS,
    });
}
