import { describe, it, expect } from 'vitest';
import {
    convertDocErrorMessage,
    extractConvertDocErrorCode,
    resolveConvertDocErrorKey,
} from './convertDocError';

/**
 * 「转为在线文档」失败文案映射的契约测试。
 *
 * 回归背景（2026-08-26）：docs-backend 用 `{ "error": "<code>" }` 表达失败原因，但 host 的
 * normalizeApiError 只识别 401/403/404/429/5xx，其余一律归一化成「未知错误」——一个**非空**
 * 字符串，把 `extractErrorMsg(err) || convertFailed` 里的兜底彻底短路。用户实际看到的是
 * 「未知错误」，且这些错误全是确定性的（重试无用）。
 *
 * 下面的错误对象形状照抄真实链路：docs 模块的 toApiErrorEnvelope 会把原始 axios 错误的
 * `{ status, data }` 提升到 `err.response`，所以 `err.response.data.error` 一路可达。
 */

/** 构造与生产链路同形的错误对象。 */
function backendError(code: string, status: number): unknown {
    return {
        // host APIClient 拦截器 reject 出来的字段（归一化后的「未知错误」正是缺陷来源）。
        msg: '未知错误',
        status,
        // toApiErrorEnvelope 提升上来的原始响应。
        response: { status, data: { error: code } },
    };
}

/** 测试用 t：直接回显 key，便于断言映射到了哪一条文案而不依赖具体译文。 */
const t = (key: string): string => key;

describe('extractConvertDocErrorCode', () => {
    it('reads the backend error code off the lifted axios response', () => {
        expect(extractConvertDocErrorCode(backendError('schema_incompatible', 422)))
            .toBe('schema_incompatible');
    });

    it('returns undefined when there is no response envelope', () => {
        expect(extractConvertDocErrorCode({ msg: '未知错误' })).toBeUndefined();
        expect(extractConvertDocErrorCode(new Error('boom'))).toBeUndefined();
        expect(extractConvertDocErrorCode(null)).toBeUndefined();
        expect(extractConvertDocErrorCode(undefined)).toBeUndefined();
    });

    it('ignores a non-string / empty error field instead of guessing', () => {
        // v2 信封 `{ error: { code, message } }` 由 host 负责，这里刻意不处理：
        // 错判成错误码会翻译出与事实无关的文案。
        expect(extractConvertDocErrorCode({
            response: { status: 500, data: { error: { code: 'err.shared.internal' } } },
        })).toBeUndefined();
        expect(extractConvertDocErrorCode({
            response: { status: 422, data: { error: '   ' } },
        })).toBeUndefined();
    });
});

describe('resolveConvertDocErrorKey — 后端错误码优先', () => {
    // 逐条钉死映射：这些码都来自 docs-backend 的导入/写入路径（editDocBody + import 路由）。
    const cases: Array<[string, number, string]> = [
        ['schema_incompatible', 422, 'summary.detail.convertErrSchema'],
        ['import_failed', 422, 'summary.detail.convertErrParse'],
        ['doc_too_large', 413, 'summary.detail.convertErrTooLarge'],
        ['attachment_not_found', 422, 'summary.detail.convertErrAttachment'],
        ['base_version_stale', 412, 'summary.detail.convertErrStale'],
        ['anchor_not_found', 422, 'summary.detail.convertErrStale'],
        ['anchor_mismatch', 422, 'summary.detail.convertErrStale'],
        ['epoch_changed', 409, 'summary.detail.convertErrPermission'],
        ['forbidden', 403, 'summary.detail.convertErrPermission'],
        ['empty_upload', 400, 'summary.detail.convertErrEmpty'],
        ['invalid_utf8', 400, 'summary.detail.convertErrEncoding'],
        ['unsupported_doc_type', 409, 'summary.detail.convertErrDocType'],
    ];

    it.each(cases)('maps %s (%i) to its own message', (code, status, key) => {
        expect(resolveConvertDocErrorKey(backendError(code, status))).toBe(key);
    });

    it('never collapses distinct causes onto one message', () => {
        // 缺陷的本质是「所有原因显示同一句」。这里断言至少 schema / too-large / stale /
        // permission 四大类互不相同，防止未来有人图省事把映射合并回一条。
        const keys = [
            resolveConvertDocErrorKey(backendError('schema_incompatible', 422)),
            resolveConvertDocErrorKey(backendError('doc_too_large', 413)),
            resolveConvertDocErrorKey(backendError('base_version_stale', 412)),
            resolveConvertDocErrorKey(backendError('epoch_changed', 409)),
        ];
        expect(new Set(keys).size).toBe(4);
    });
});

describe('resolveConvertDocErrorKey — HTTP 状态码兜底', () => {
    it('falls back to the status when the code is unknown to us', () => {
        // 后端将来新增错误码时，至少还能说对大类，而不是掉回「未知错误」。
        expect(resolveConvertDocErrorKey(backendError('some_future_code', 413)))
            .toBe('summary.detail.convertErrTooLarge');
        expect(resolveConvertDocErrorKey(backendError('some_future_code', 429)))
            .toBe('summary.detail.convertErrBusy');
    });

    it('uses the host-normalized status when no axios response body exists', () => {
        // 超时/网络错误时 body 确实拿不到，但 host 归一化了 status。
        expect(resolveConvertDocErrorKey({ status: 412, msg: '未知错误' }))
            .toBe('summary.detail.convertErrStale');
    });

    it('returns undefined for an unclassifiable error', () => {
        expect(resolveConvertDocErrorKey(new Error('network down'))).toBeUndefined();
        expect(resolveConvertDocErrorKey({ msg: '未知错误' })).toBeUndefined();
    });
});

describe('convertDocErrorMessage', () => {
    it('does NOT surface the host-normalized 未知错误 for a classified failure', () => {
        // 这条就是缺陷本身的回归守卫：同一个错误对象里 msg='未知错误' 依然存在，
        // 但展示文案必须来自更具体的映射。
        const err = backendError('schema_incompatible', 422);
        const shown = convertDocErrorMessage(err, t);
        expect(shown).toBe('summary.detail.convertErrSchema');
        expect(shown).not.toBe('未知错误');
    });

    it('falls back to the generic convertFailed only when nothing is classifiable', () => {
        expect(convertDocErrorMessage(new Error('boom'), t))
            .toBe('summary.detail.convertFailed');
    });
});
