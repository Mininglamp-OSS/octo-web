import { Button, Modal, Progress } from "@douyinfe/semi-ui";
import type { ReactNode } from "react";
import { createElement as h } from "react";
import { t } from "../i18n";
import "./saveProgressModal.css";

/**
 * 另存为进度弹窗(命令式控制器)。
 *
 * 背景:showSaveFilePicker 是浏览器原生窗口,用户点"保存"选好位置后 Promise 立即
 * resolve、原生窗口随即由系统关闭——网页无法控制其停留(见 Chromium 40175286:
 * "do the file prep work AFTER obtaining the file handle")。因此写入过程的可视化
 * 反馈必须由我们自己的 UI 承担:系统窗口关闭后立刻弹出这个居中弹窗,显示
 * 「保存文件到 + 文件名 + 进度条」,写入完成后自动关闭。
 *
 * 用法:
 *   const ctl = openSaveProgressModal(filename);
 *   ctl.setPercent(42);   // 写入中刷新
 *   ctl.done();           // 成功:置 100% 后短暂停留再关
 *   ctl.close();          // 失败/中断:直接关掉(调用方负责降级/报错提示)
 *
 * 浏览器安全限制:FileSystemFileHandle 只暴露 .name,拿不到用户选择的绝对目录路径,
 * 所以"保存文件到"显示的是文件名而非完整磁盘路径。
 */
export interface SaveProgressController {
    setPercent: (percent: number) => void;
    done: () => void;
    close: () => void;
    cancel: () => void;
}

const clampPercent = (p: number): number => {
    if (!Number.isFinite(p)) return 0;
    return Math.max(0, Math.min(100, Math.round(p)));
};

const renderBody = (filename: string, percent: number, indeterminate: boolean, onCancel: () => void, cancelDisabled: boolean): ReactNode =>
    h(
        "div",
        { className: "wk-save-progress" },
        h(
            "div",
            { className: "wk-save-progress-target", title: filename },
            h("span", { className: "wk-save-progress-label" }, `${t("base.download.savingTo")}:`),
            h("span", { className: "wk-save-progress-path" }, filename),
        ),
        h(
            "div",
            { className: "wk-save-progress-status" },
            h("span", { className: "wk-save-progress-spinner", "aria-hidden": true }),
            h(
                "span",
                null,
                indeterminate
                    ? t("base.download.saving")
                    : t("base.download.savingPercent", { values: { percent } }),
            ),
        ),
        indeterminate
            ? h("div", { className: "wk-save-progress-indeterminate", role: "progressbar", "aria-label": "save-progress" }, h("span"))
            : h(Progress, {
                percent,
                showInfo: true,
                "aria-label": "save-progress",
            }),
        h(Button, {
            type: "tertiary",
            theme: "light",
            className: "wk-save-progress-cancel",
            onClick: onCancel,
            disabled: cancelDisabled,
        }, t("base.download.cancel")),
    );

/**
 * 打开进度弹窗。indeterminate=true 表示 Content-Length 缺失(无法算百分比),
 * 用不确定态展示;调用方拿到字节流后如能算出百分比,仍可 setPercent 切到确定态。
 */
export function openSaveProgressModal(
    filename: string,
    indeterminate = false,
    onCancel: () => void = () => undefined,
): SaveProgressController {
    const displayName = filename || "download";
    let current = 0;
    let isIndeterminate = indeterminate;
    let closed = false;
    let cancelling = false;
    let completed = false;

    const cancel = () => {
        if (closed || cancelling) return;
        cancelling = true;
        onCancel();
        closed = true;
        modalRef.destroy();
    };

    const modalRef = Modal.info({
        title: t("base.download.saveModalTitle"),
        icon: null,
        content: renderBody(displayName, 0, isIndeterminate, cancel, cancelling || completed),
        footer: null,
        maskClosable: false,
        closable: false,
        centered: true,
        className: "wk-save-progress-modal",
    });

    const refresh = () => {
        if (closed) return;
        modalRef.update({
            title: t("base.download.saveModalTitle"),
            icon: null,
            content: renderBody(displayName, current, isIndeterminate, cancel, cancelling || completed),
            footer: null,
            maskClosable: false,
            closable: false,
            centered: true,
            className: "wk-save-progress-modal",
        });
    };

    return {
        setPercent: (percent: number) => {
            isIndeterminate = false;
            current = clampPercent(percent);
            refresh();
        },
        done: () => {
            if (closed) return;
            completed = true;
            isIndeterminate = false;
            current = 100;
            refresh();
            // 满条短暂停留,让用户看到 100% 再关闭。
            setTimeout(() => {
                closed = true;
                modalRef.destroy();
            }, 600);
        },
        close: () => {
            if (closed) return;
            closed = true;
            modalRef.destroy();
        },
        cancel,
    };
}
