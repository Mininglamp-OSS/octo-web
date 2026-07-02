import React, { Component } from "react";
import { Button, Toast } from "@douyinfe/semi-ui";
import { I18nContext, t } from "@octo/base";
import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import type { ReplaceMode, SelectionRange } from "@octo/base/src/Components/VoiceInputButton";
import * as api from "../api/summaryApi";

interface SummaryEditorProps {
    taskId: number;
    baseResultId: number;
    initialContent: string;
    onSave: () => void;
    onCancel: () => void;
    /**
     * 编辑目标：
     *  - "team"（默认）：编辑团队/个人总结结果，走 PUT /summaries/:id/edit（editSummary）。
     *  - "personal"（need3/6）：编辑「自己的个人报告」，走 PUT /summaries/:id/personal-edit
     *    （personalEditSummary），成功后后端自动触发团队重算。
     *  - "personal_draft"（OCT-21）：提交前编辑「自己的个人报告」草稿，走
     *    PUT /summaries/:id/personal-draft（personalDraftSummary）。**不**触发团队
     *    重算、**不**写 edited_at。仅当 worker_status===2 && submitted_at IS NULL 时允许。
     */
    mode?: "team" | "personal" | "personal_draft";
}

interface SummaryEditorState {
    content: string;
    saving: boolean;
}

export default class SummaryEditor extends Component<SummaryEditorProps, SummaryEditorState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private textareaRef = React.createRef<HTMLTextAreaElement>();

    state: SummaryEditorState = {
        content: this.props.initialContent,
        saving: false,
    };

    componentDidMount() {
        window.addEventListener("beforeunload", this.handleBeforeUnload);
        this.adjustHeight();
    }

    componentWillUnmount() {
        window.removeEventListener("beforeunload", this.handleBeforeUnload);
    }

    private handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (this.hasChanges) {
            e.preventDefault();
        }
    };

    private get hasChanges(): boolean {
        return this.state.content !== this.props.initialContent;
    }

    private adjustHeight = () => {
        const el = this.textareaRef.current;
        if (el) {
            // Let CSS max-height handle the sizing instead of dynamic height
            // This prevents the textarea from growing indefinitely and causing scroll issues
            el.style.height = "auto";
            const newHeight = Math.min(el.scrollHeight, 600);
            el.style.height = newHeight + "px";
        }
    };

    private handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        this.setState({ content: e.target.value }, this.adjustHeight);
    };

    private handleSave = async () => {
        const { taskId, baseResultId, onSave, mode } = this.props;
        const { content } = this.state;

        this.setState({ saving: true });
        try {
            if (mode === "personal_draft") {
                // OCT-21：提交前编辑自己的草稿（只能改自己），不触发团队重算、不写 edited_at。
                await api.personalDraftSummary(taskId, content);
            } else if (mode === "personal") {
                // need3/6：编辑自己的个人报告（只能改自己），后端会自动触发团队重算。
                // F2：personal-edit 只传 content，不带 base_result_id。
                await api.personalEditSummary(taskId, content);
            } else {
                await api.editSummary(taskId, content, baseResultId);
            }
            Toast.success(t("summary.editor.saveSuccess"));
            onSave();
        } catch (err: unknown) {
            const error = err as Error & { status?: number };
            if (error.status === 409) {
                // v2 GLM-F4：409 文案按 mode 分发。personal_draft 走「该总结已提交，已为你刷新」，
                // 其余 mode 沿用旧文案「内容已更新，请刷新」。
                const conflictKey = mode === "personal_draft"
                    ? "summary.editor.draftAlreadySubmitted"
                    : "summary.editor.contentUpdated";
                Toast.warning(t(conflictKey));
                onSave();
            } else {
                Toast.error(error.message || t("summary.editor.saveFailed"));
                this.setState({ saving: false });
            }
        }
    };

    render() {
        const { onCancel } = this.props;
        const { content, saving } = this.state;
        const { t: translate } = this.context;

        return (
            <div className="summary-editor">
                <div style={{ position: "relative" }}>
                    <textarea
                        ref={this.textareaRef}
                        className="summary-editor-textarea"
                        value={content}
                        onChange={this.handleChange}
                        disabled={saving}
                        placeholder={translate("summary.editor.placeholder")}
                    />
                    {!saving && (
                        <VoiceInputButton
                            inputRef={this.textareaRef}
                            onTranscribed={(text: string, mode: ReplaceMode, savedRange?: SelectionRange) => {
                                if (mode === "all") {
                                    this.setState({ content: text }, this.adjustHeight);
                                } else if (mode === "selection" && savedRange) {
                                    // Note: savedRange indices are from recording start; assumes input is read-only during recording
                                    this.setState(prev => ({
                                        content: prev.content.slice(0, savedRange.from) + text + prev.content.slice(savedRange.to),
                                    }), this.adjustHeight);
                                } else {
                                    this.setState(prev => {
                                        const pos = savedRange?.from ?? prev.content.length;
                                        return { content: prev.content.slice(0, pos) + text + prev.content.slice(pos) };
                                    }, this.adjustHeight);
                                }
                            }}
                            getCurrentText={() => this.state.content}
                            showModeMenu
                            size="md"
                            className="wk-vib--textarea-corner"
                        />
                    )}
                </div>
                <div className="summary-editor-actions">
                    <Button onClick={onCancel} disabled={saving}>
                        {translate("summary.common.cancel")}
                    </Button>
                    <Button
                        theme="solid"
                        onClick={this.handleSave}
                        disabled={!this.hasChanges || saving}
                        loading={saving}
                    >
                        {translate("summary.common.save")}
                    </Button>
                </div>
            </div>
        );
    }
}
