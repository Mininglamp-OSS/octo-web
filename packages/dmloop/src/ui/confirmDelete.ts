import { Modal } from "@douyinfe/semi-ui";

/**
 * 居中的删除确认弹窗（替代表格单元格内的 Popconfirm，避免定位跑到可视区外）。
 * Semi 的 Modal.confirm 始终居中挂载到 body，操作按钮恒在可视范围内。
 */
export function confirmDelete(opts: {
  title: string;
  content?: string;
  okText: string;
  cancelText: string;
  onOk: () => void | Promise<void>;
  onCancel?: () => void;
}): void {
  Modal.confirm({
    title: opts.title,
    content: opts.content,
    okText: opts.okText,
    cancelText: opts.cancelText,
    okButtonProps: { type: "danger" },
    centered: true,
    onOk: opts.onOk,
    onCancel: opts.onCancel,
  });
}
