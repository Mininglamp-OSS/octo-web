import React from "react";
import { Button } from "@douyinfe/semi-ui";
import { Copy, FileText } from "lucide-react";
import { t, isDocsConvertAvailable } from "@octo/base";

/**
 * 总结结果下方的「复制 / 转为在线文档」操作行（octo-smart-summary#195）。
 *
 * 抽成组件而不是在 SummaryDetailPage 里复制粘贴，是为了让三条渲染路径
 * （renderCompleted / renderPersonalSummary / renderTeamSummary）共享同一套：
 *  - 空内容门控：内容为空时整行不渲染，避免出现点了没反应的死按钮；
 *  - docs 开关门控：转文档按钮走 isDocsConvertAvailable()，在没有 docs 能力的
 *    形态下直接不渲染，而不是渲染出来再靠报错兜底；
 *  - 独立 loading：每个挂载点自己持有 busy 态，不会出现「转个人总结时团队总结
 *    的按钮也跟着转圈」。
 *
 * 可见性还有一条由调用方负责：正在编辑（SummaryEditor）或正在预览历史版本时
 * 整行都不该出现，否则按钮导出的是屏幕上没显示的那份内容。
 */
export interface SummaryResultActionsProps {
    /** 要复制 / 转文档的正文；空或全空白时整行不渲染。 */
    content?: string | null;
    /** 生成文档时使用的标题。 */
    title?: string;
    /** 复制按钮文案 key（默认 summary.detail.copy）。 */
    copyLabelKey?: string;
    /** 转文档按钮文案 key（默认 summary.detail.convertToDoc）。 */
    convertLabelKey?: string;
    onCopy: (content: string) => void | Promise<void>;
    onConvert: (content: string, title?: string) => void | Promise<void>;
    copying?: boolean;
    converting?: boolean;
    /** 供测试/埋点定位。 */
    testid?: string;
}

const SummaryResultActions: React.FC<SummaryResultActionsProps> = ({
    content,
    title,
    copyLabelKey = "summary.detail.copy",
    convertLabelKey = "summary.detail.convertToDoc",
    onCopy,
    onConvert,
    copying = false,
    converting = false,
    testid,
}) => {
    const text = content?.trim();
    if (!text) return null;

    // docs 模块已从 OSS host 拆出（#1363）：端口没注册或 docs_on 关闭时，
    // 转文档必然失败，直接不渲染这个按钮。复制不依赖 docs，始终可用。
    const canConvert = isDocsConvertAvailable();

    return (
        <div
            className="summary-detail-result-actions"
            data-testid={testid}
        >
            <Button
                size="small"
                theme="borderless"
                icon={<Copy size={14} />}
                loading={copying}
                onClick={() => onCopy(content as string)}
            >
                {t(copyLabelKey)}
            </Button>
            {canConvert && (
                <Button
                    size="small"
                    theme="borderless"
                    icon={<FileText size={14} />}
                    loading={converting}
                    onClick={() => onConvert(content as string, title)}
                >
                    {t(convertLabelKey)}
                </Button>
            )}
        </div>
    );
};

export default SummaryResultActions;
