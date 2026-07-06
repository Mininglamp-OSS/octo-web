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
        const { taskId, baseResultId, onSave } = this.props;
        const { content } = this.state;

        this.setState({ saving: true });
        try {
            await api.editSummary(taskId, content, baseResultId);
            Toast.success(t("summary.editor.saveSuccess"));
            onSave();
        } catch (err: unknown) {
            const error = err as Error & { status?: number };
            if (error.status === 409) {
                Toast.warning(t("summary.editor.contentUpdated"));
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
