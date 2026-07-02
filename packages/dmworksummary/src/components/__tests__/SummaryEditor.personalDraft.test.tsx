import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// OCT-21 Stage 4 (v2 GLM-F4 + F1 wiring) — SummaryEditor.handleSave in
// mode="personal_draft":
//   - success path  -> calls api.personalDraftSummary(taskId, content) + onSave()
//   - 409 conflict   -> calls onSave() and shows the NEW i18n toast key
//                       "summary.editor.draftAlreadySubmitted" (NOT the generic
//                       "summary.editor.contentUpdated" used by other modes).
//
// @octo/base is aliased to the dmworkBase mock by vitest.config.ts, so `t`/`Toast`
// context resolve. The mock t(key) returns the key string for un-mapped summary
// keys, so asserting the Toast was called with the key proves the per-mode i18n
// dispatch picked the right key.

const Toast = vi.hoisted(() => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
}));

vi.mock('@douyinfe/semi-ui', () => ({
    Toast,
    Button: ({ children, onClick, disabled }: any) => (
        <button onClick={onClick} disabled={disabled}>{children}</button>
    ),
}));

vi.mock('@octo/base/src/Components/VoiceInputButton', () => ({
    default: () => null,
}));

const api = vi.hoisted(() => ({
    personalDraftSummary: vi.fn(),
    personalEditSummary: vi.fn(),
    editSummary: vi.fn(),
}));
vi.mock('../../api/summaryApi', () => api);

import SummaryEditor from '../SummaryEditor';

function renderEditor(onSave: () => void, mode: 'team' | 'personal' | 'personal_draft' = 'personal_draft') {
    render(
        <SummaryEditor
            taskId={42}
            baseResultId={0}
            initialContent="orig"
            onSave={onSave}
            onCancel={() => {}}
            mode={mode}
        />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    // content !== initialContent -> hasChanges true -> Save enabled.
    fireEvent.change(textarea, { target: { value: 'my draft body [1]' } });
    const saveBtn = screen.getByText('保存').closest('button') as HTMLButtonElement;
    return { textarea, saveBtn };
}

describe('SummaryEditor mode="personal_draft" (v2 GLM-F4 + F1 wiring)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('success path routes to personalDraftSummary, then onSave + success toast', async () => {
        api.personalDraftSummary.mockResolvedValue(undefined);
        const onSave = vi.fn();
        const { saveBtn } = renderEditor(onSave);
        expect(saveBtn.disabled).toBe(false);

        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(api.personalDraftSummary).toHaveBeenCalledWith(42, 'my draft body [1]');
        });
        expect(api.personalEditSummary).not.toHaveBeenCalled();
        expect(api.editSummary).not.toHaveBeenCalled();
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        // dmworkBase mock t() resolves the real zh-CN string, so assert the
        // translation (saveSuccess -> "保存成功").
        expect(Toast.success).toHaveBeenCalledWith('保存成功');
    });

    it('409 conflict closes editor (onSave) and shows the draftAlreadySubmitted toast key', async () => {
        const conflict = new Error('已提交') as Error & { status?: number };
        conflict.status = 409;
        api.personalDraftSummary.mockRejectedValue(conflict);
        const onSave = vi.fn();
        const { saveBtn } = renderEditor(onSave);

        fireEvent.click(saveBtn);

        // GLM-F4: draft mode picks the NEW key draftAlreadySubmitted
        // ("该总结已提交，已为你刷新"), NOT the generic contentUpdated
        // ("内容已更新，请刷新"). The mock t() resolves real zh-CN strings.
        await waitFor(() => {
            expect(Toast.warning).toHaveBeenCalledWith('该总结已提交，已为你刷新');
        });
        expect(Toast.warning).not.toHaveBeenCalledWith('内容已更新，请刷新');
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(Toast.error).not.toHaveBeenCalled();
    });

    it('non-409 error keeps editor open (no onSave) and shows an error toast', async () => {
        const boom = new Error('boom') as Error & { status?: number };
        boom.status = 500;
        api.personalDraftSummary.mockRejectedValue(boom);
        const onSave = vi.fn();
        const { saveBtn } = renderEditor(onSave);

        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(Toast.error).toHaveBeenCalled();
        });
        expect(onSave).not.toHaveBeenCalled();
        expect(Toast.warning).not.toHaveBeenCalled();
    });
});
