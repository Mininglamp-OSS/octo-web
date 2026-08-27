import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import TemplateSelectorModal, {
    type TemplateSelectorDataSource,
    type TemplateSelectorLabels,
} from "./TemplateSelectorModal";
import type { SummaryWorkbenchTemplateScope } from "../bridge/summaryWorkbench/protocol";
import type { TopicTemplate } from "../types/summary";
import "../index.css";

const templates: TopicTemplate[] = [
    {
        id: "project-progress",
        label: "项目进展",
        icon: "ListChecks",
        description: "归纳进展、风险和下一步",
        type: "fixed",
        pattern: "按项目归纳进展、风险和下一步。",
    },
    {
        id: "weekly-report",
        label: "团队周报",
        icon: "Calendar",
        description: "整理本周产出与下周计划",
        type: "fixed",
        pattern: "整理本周产出、阻塞与下周计划。",
    },
    {
        id: "custom-decisions",
        label: "决策记录",
        icon: "FileText",
        description: "只保留已确认的决策和负责人",
        type: "fixed",
        pattern: "只保留已确认的决策、负责人和截止时间。",
        is_custom: true,
    },
];

const labels: TemplateSelectorLabels = {
    title: "选择总结模板",
    builtInTitle: "推荐模板",
    customTitle: (count, limit) => `我的模板 ${count}/${limit}`,
    create: "新建模板",
    edit: "编辑模板",
    delete: "删除模板",
    reset: "恢复默认",
    cancel: "取消",
    save: "保存",
    clear: "不使用模板",
    loading: "正在加载模板",
    empty: "还没有可用模板",
    loadFailed: "模板加载失败",
    retry: "重试",
    limitReached: "自定义模板已达到上限",
    createTitle: "新建总结模板",
    editTitle: "编辑总结模板",
    nameLabel: "模板名称",
    descriptionLabel: "总结要求",
    namePlaceholder: "输入模板名称",
    descriptionPlaceholder: "描述希望 Agent 如何总结",
    editHint: "修改只影响你自己的模板配置。",
    deleteConfirmTitle: "删除模板",
    deleteConfirmContent: (name) => `确定删除“${name}”吗？`,
    createFailed: "模板创建失败，请重试",
    updateFailed: "模板保存失败，请重试",
    resetFailed: "模板恢复失败，请重试",
    deleteFailed: "模板删除失败，请重试",
};

function createDataSource(
    initialTemplates: TopicTemplate[]
): TemplateSelectorDataSource {
    let current = [...initialTemplates];
    return {
        async load() {
            return { templates: current, custom_template_limit: 5 };
        },
        async create(payload) {
            const created: TopicTemplate = {
                id: `custom-${current.length + 1}`,
                icon: "FileText",
                type: "fixed",
                pattern: payload.pattern ?? payload.description,
                is_custom: true,
                ...payload,
            };
            current = [...current, created];
            return created;
        },
        async updateBuiltIn(templateId, payload) {
            const updated = {
                ...current.find((item) => item.id === templateId)!,
                ...payload,
            };
            current = current.map((item) =>
                item.id === templateId ? updated : item
            );
            return updated;
        },
        async updateCustom(templateId, payload) {
            const updated = {
                ...current.find((item) => item.id === templateId)!,
                ...payload,
            };
            current = current.map((item) =>
                item.id === templateId ? updated : item
            );
            return updated;
        },
        async resetBuiltIn(templateId) {
            return current.find((item) => item.id === templateId)!;
        },
        async deleteCustom(templateId) {
            current = current.filter((item) => item.id !== templateId);
        },
    };
}

function ControlledTemplateSelector() {
    const [visible, setVisible] = useState(true);
    const [value, setValue] = useState<SummaryWorkbenchTemplateScope | null>(
        null
    );
    const [dataSource] = useState(() => createDataSource(templates));

    return (
        <div style={{ padding: "var(--wk-sp-6)" }}>
            {!visible && (
                <button type="button" onClick={() => setVisible(true)}>
                    {value?.label ?? labels.title}
                </button>
            )}
            <TemplateSelectorModal
                visible={visible}
                value={value}
                labels={labels}
                dataSource={dataSource}
                onChange={(nextValue) => {
                    setValue(nextValue);
                    setVisible(false);
                }}
                onCancel={() => setVisible(false)}
            />
        </div>
    );
}

const meta: Meta<typeof TemplateSelectorModal> = {
    title: "Summary/Workbench/TemplateSelectorModal",
    component: TemplateSelectorModal,
    parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof TemplateSelectorModal>;

export const Default: Story = {
    render: () => <ControlledTemplateSelector />,
};
