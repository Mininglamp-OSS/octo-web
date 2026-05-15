import React, { useState, useCallback, useRef, useEffect } from "react";
import { Modal, DatePicker, Spin } from "@douyinfe/semi-ui";
import { WKApp } from "@octo/base";
import type { CreateMatterReq, ExtractMessage } from "../../bridge/types";
import MemberPicker from "../MemberPicker";
import { Toast } from "../../utils/toast";
import "./index.css";

export interface SmartCreateModalProps {
  visible: boolean;
  /** 是否为空白新建（true = 手动填写，false = 从消息智能预填） */
  blank?: boolean;
  /** 智能创建时选中的消息数量 */
  count?: number;
  /** AI 提取中状态 */
  loading?: boolean;
  /** AI 提取完成后传入的初始值 */
  initialValues?: { title?: string; description?: string; deadline?: string };
  /** 智能总结所用的消息列表 */
  sourceMsgs?: ExtractMessage[];
  /** 用户主动关闭/取消弹窗 */
  onClose: () => void;
  /** 确认成功后关闭弹窗（不触发孤儿清理）。未传时等同于 onClose */
  onConfirmSuccess?: () => void;
  /** 创建/编辑事项 */
  onConfirm: (req: CreateMatterReq) => Promise<void>;
  /** 当前频道（用于 MemberPicker 获取成员列表） */
  channel?: { channelId: string; channelType: number; name?: string };
}

// 本地日期格式化
function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromLocalDateString(s: string): Date {
  const [yyyy, mm, dd] = s.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function getLocalTZOffset(): string {
  const off = new Date().getTimezoneOffset();
  const sign = off <= 0 ? "+" : "-";
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const m = String(Math.abs(off) % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

/**
 * SmartCreateModal — 新建事项 / 智能创建事项弹窗
 *
 * 对齐原型 v19 + 复用项目已有组件（Semi Modal / DatePicker / MemberPicker）。
 * 4 字段：标题 / 主要目标(description) / 负责人 / Deadline，全部必填。
 */
export default function SmartCreateModal({
  visible,
  blank = true,
  count,
  loading = false,
  initialValues,
  sourceMsgs,
  onClose,
  onConfirmSuccess,
  onConfirm,
  channel,
}: SmartCreateModalProps) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [assigneeUids, setAssigneeUids] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦标题输入框，设置默认负责人
  useEffect(() => {
    if (visible) {
      // 设置当前用户为默认负责人
      const currentUid = WKApp.loginInfo.uid;
      if (currentUid && assigneeUids.length === 0) {
        setAssigneeUids([currentUid]);
      }
      setTimeout(() => {
        if (!loading) {
          titleInputRef.current?.focus();
        }
      }, 100);
    } else {
      // 关闭时重置
      setTitle("");
      setBrief("");
      setAssigneeUids([]);
      setDeadline("");
      setSubmitting(false);
    }
  }, [visible, loading]);

  useEffect(() => {
    if (visible && initialValues && !loading) {
      if (initialValues.title) setTitle(initialValues.title);
      if (initialValues.description) setBrief(initialValues.description);
      if (initialValues.deadline) setDeadline(initialValues.deadline);
    }
  }, [visible, initialValues, loading]);

  const canCreate =
    title.trim() && brief.trim() && assigneeUids.length > 0 && deadline;

  const handleConfirm = useCallback(async () => {
    if (!canCreate || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm({
        title: title.trim(),
        description: brief.trim() || undefined,
        assignee_ids: assigneeUids,
        deadline: deadline ? `${deadline}T23:59:59${getLocalTZOffset()}` : undefined,
        source_channel_id: channel?.channelId,
        source_channel_type: channel?.channelType,
        source_msgs: sourceMsgs,
      });
      (onConfirmSuccess ?? onClose)();
    } catch (e: any) {
      // 失败不关闭，让用户重试
      const msg = e?.message === "assignee reconciliation failed"
        ? undefined  // assignee 失败已在 onConfirm 内 toast
        : "操作失败，请重试";
      if (msg) Toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    canCreate,
    submitting,
    title,
    brief,
    assigneeUids,
    deadline,
    channel,
    sourceMsgs,
    onConfirm,
    onConfirmSuccess,
    onClose,
  ]);

  // Enter 键确认（Esc 由 Semi Modal 原生处理，无需重复）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && canCreate) {
        e.preventDefault();
        handleConfirm();
      }
    },
    [handleConfirm, canCreate],
  );

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={520}
      closable={!submitting}
      maskClosable={false}
      centered
      className="wk-smart-create-modal"
      bodyStyle={{ overflow: "visible", padding: 0 }}
      style={{ overflow: "visible" }}
    >
      <div className="wk-smart-create-modal__content" onKeyDown={handleKeyDown}>
        {/* Header */}
        <div className="wk-smart-create-modal__head">
          <h3 className="wk-smart-create-modal__title">
            {!blank && (
              <svg
                className="wk-smart-create-modal__spark"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3v4m0 14v-4m9-5h-4M3 12h4m12.3-5.3-2.8 2.8M7.5 16.5l-2.8 2.8m14.6 0-2.8-2.8M7.5 7.5 4.7 4.7" />
              </svg>
            )}
            {blank ? "新建事项" : "智能创建事项"}
          </h3>
        </div>

        {loading ? (
          <div
            style={{
              padding: "60px 0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <Spin size="large" />
            <div style={{ color: "var(--semi-color-text-2)", fontSize: 14 }}>
              AI 正在努力提取事项信息...
            </div>
          </div>
        ) : (
          <>
            {/* 标题 */}
            <div className="wk-smart-create-modal__field">
              <label className="wk-smart-create-modal__label">
                标题 <span className="wk-smart-create-modal__req">*</span>
              </label>
              <input
                ref={titleInputRef}
                type="text"
                className="wk-smart-create-modal__input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="事件标题"
              />
            </div>

            {/* 主要目标 */}
            <div className="wk-smart-create-modal__field">
              <label className="wk-smart-create-modal__label">
                主要目标 <span className="wk-smart-create-modal__req">*</span>
              </label>
              <textarea
                className="wk-smart-create-modal__textarea"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="一句话说清这件事"
                rows={3}
              />
            </div>

            {/* 负责人 */}
            <div className="wk-smart-create-modal__field">
              <label className="wk-smart-create-modal__label">
                负责人 <span className="wk-smart-create-modal__req">*</span>
              </label>
              <MemberPicker
                mode="controlled"
                value={assigneeUids}
                onChange={setAssigneeUids}
                channel={channel}
                placeholder="选择负责人（可多选）..."
              />
            </div>

            {/* Deadline */}
            <div className="wk-smart-create-modal__field">
              <label className="wk-smart-create-modal__label">
                Deadline <span className="wk-smart-create-modal__req">*</span>
              </label>
              <DatePicker
                className="wk-smart-create-modal__datepicker"
                style={{ width: "100%" }}
                value={deadline ? fromLocalDateString(deadline) : undefined}
                onChange={(date) => {
                  if (!date) {
                    setDeadline("");
                    return;
                  }
                  const d =
                    date instanceof Date
                      ? date
                      : fromLocalDateString(String(date));
                  setDeadline(toLocalDateString(d));
                }}
                disabledDate={(date) =>
                  !!date && date < new Date(new Date().setHours(0, 0, 0, 0))
                }
                placeholder="选择截止日期"
                density="compact"
              />
            </div>

            <div className="wk-smart-create-modal__footer-sep" />
            <div className="wk-smart-create-modal__actions">
              <button
                type="button"
                className="wk-smart-create-modal__btn wk-smart-create-modal__btn--confirm"
                onClick={handleConfirm}
                disabled={!canCreate || submitting}
              >
                {submitting ? "提交中..." : "确认事项"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export { SmartCreateModal };
