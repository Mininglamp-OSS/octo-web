import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Modal, DatePicker, Spin } from "@douyinfe/semi-ui";
import { WKApp, useI18n } from "@octo/base";
import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
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
  /** 用户关闭弹窗时表单有修改（dirty），触发孤儿清理等逻辑。未传时等同于 onClose */
  onDirtyClose?: () => void;
  /** 确认成功后关闭弹窗（不触发孤儿清理）。未传时等同于 onClose */
  onConfirmSuccess?: () => void;
  /** 创建/编辑事项 */
  onConfirm: (req: CreateMatterReq) => Promise<void>;
  /** 当前频道（用于 MemberPicker 获取成员列表） */
  channel?: { channelId: string; channelType: number; name?: string };
  /** 预填充标题（用于 dirty 检测基准） */
  prefillTitle?: string;
  /** 预填充负责人（用于 dirty 检测基准） */
  prefillAssigneeUids?: string[];
  /** 控制按钮文案：true 显示「发送并创建事项」，且标题只读 */
  sendOnConfirm?: boolean;
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
 * 对齐 Figma 设计稿 node 1411:10562。
 * 4 字段：事项名称 / 主要目标(description) / 负责人 / Deadline，全部必填。
 */
export default function SmartCreateModal({
  visible,
  blank = true,
  count,
  loading = false,
  initialValues,
  sourceMsgs,
  onClose,
  onDirtyClose,
  onConfirmSuccess,
  onConfirm,
  channel,
  prefillTitle = "",
  prefillAssigneeUids = [],
  sendOnConfirm = false,
}: SmartCreateModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [assigneeUids, setAssigneeUids] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);

  // 稳定化初始负责人引用，用于打开时初始化和 dirty 检测。
  // 空白新建沿用 SmartCreateModal 原行为：默认负责人为当前用户；该默认值不应被视为 dirty。
  const prefillAssigneeUidsKey = prefillAssigneeUids.join(",");
  const initialAssigneeUids = useMemo(() => {
    if (prefillAssigneeUids.length > 0) return prefillAssigneeUids;
    const currentUid = WKApp.loginInfo.uid;
    return currentUid ? [currentUid] : [];
  }, [prefillAssigneeUidsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 打开时重置表单、聚焦标题输入框
  useEffect(() => {
    if (visible) {
      // 使用 prefill 值或默认值初始化
      setTitle(prefillTitle);
      setBrief("");
      setDeadline("");
      setSubmitting(false);
      setAssigneeUids(initialAssigneeUids);

      setTimeout(() => {
        if (!loading) {
          titleInputRef.current?.focus();
        }
      }, 100);
    }
  }, [visible, loading, prefillTitle, initialAssigneeUids]);

  // AI 提取完成后填充 initialValues
  useEffect(() => {
    if (visible && initialValues && !loading) {
      if (initialValues.title) setTitle(initialValues.title);
      if (initialValues.description) setBrief(initialValues.description);
      if (initialValues.deadline) setDeadline(initialValues.deadline);
    }
  }, [visible, initialValues, loading]);

  // ─── dirty 检测：表单是否有修改 ───────────────────────────
  const isDirty = useMemo(() => {
    if (title.trim() !== prefillTitle.trim()) return true;
    if (assigneeUids.length !== initialAssigneeUids.length) return true;
    const prefillSet = new Set(initialAssigneeUids);
    if (assigneeUids.some((uid) => !prefillSet.has(uid))) return true;
    if (deadline) return true;
    if (brief.trim()) return true;
    return false;
  }, [title, assigneeUids, deadline, brief, prefillTitle, initialAssigneeUids]);

  // ─── 关闭处理：dirty 时走 onDirtyClose ─────────────────────
  const handleClose = useCallback(() => {
    if (isDirty && onDirtyClose) {
      onDirtyClose();
    } else {
      onClose();
    }
  }, [isDirty, onClose, onDirtyClose]);

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
        source_name: channel?.name,
        source_msgs: sourceMsgs,
      });
      (onConfirmSuccess ?? onClose)();
    } catch (e: unknown) {
      const msg = (e as Error)?.message === "assignee reconciliation failed"
        ? undefined
        : t("todo.toast.operationFailed");
      if (msg) Toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    canCreate, submitting, title, brief, assigneeUids,
    deadline, channel, sourceMsgs, onConfirm, onConfirmSuccess, onClose, t,
  ]);

  // 键盘快捷键：Escape 关闭，Enter 确认
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      } else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "TEXTAREA") return;
        // 标题输入框以外的 input 不触发
        if (tag === "INPUT" && e.target !== titleInputRef.current) return;
        if (canCreate) {
          e.preventDefault();
          handleConfirm();
        }
      }
    },
    [handleConfirm, handleClose, canCreate],
  );

  return (
    <Modal
      visible={visible}
      onCancel={handleClose}
      footer={null}
      width={480}
      closable={false}
      maskClosable={false}
      centered
      className="wk-smart-create-modal"
      bodyStyle={{ overflow: "visible", padding: 0 }}
      style={{ overflow: "visible" }}
    >
      <div className="wk-smart-create-modal__content" onKeyDown={handleKeyDown}>
        {/* ─── Header ─── */}
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
            {blank ? t("todo.create.title") : t("todo.create.smartTitle")}
          </h3>
          <button
            type="button"
            className="wk-smart-create-modal__close-btn"
            onClick={handleClose}
            aria-label={t("todo.common.close")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
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
              {t("todo.create.aiExtracting")}
            </div>
          </div>
        ) : (
          <>
            {/* ─── Fields ─── */}
            <div className="wk-smart-create-modal__fields">
              {/* 事项名称 */}
              <div className="wk-smart-create-modal__field">
                <label className="wk-smart-create-modal__label">
                  {t("todo.field.title")}<span className="wk-smart-create-modal__req">*</span>
                </label>
                <div className="wk-smart-create-modal__input-wrap">
                  <input
                    ref={titleInputRef}
                    type="text"
                    className={`wk-smart-create-modal__input${sendOnConfirm ? " wk-smart-create-modal__input--readonly" : ""}`}
                    value={title}
                    onChange={sendOnConfirm ? () => {} : (e) => setTitle(e.target.value)}
                    readOnly={sendOnConfirm}
                    placeholder={t("todo.common.inputPlaceholder")}
                  />
                  {!sendOnConfirm && (
                    <VoiceInputButton
                      inputRef={titleInputRef}
                      onTranscribed={(text, mode, savedRange) => {
                        if (mode === "all") {
                          setTitle(text);
                        } else if (mode === "selection" && savedRange) {
                          setTitle(prev => prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to));
                        } else {
                          setTitle(prev => {
                            const pos = savedRange?.from ?? prev.length;
                            return prev.slice(0, pos) + text + prev.slice(pos);
                          });
                        }
                      }}
                      getCurrentText={() => title}
                      size="sm"
                    />
                  )}
                </div>
              </div>

              {/* 主要目标 */}
              <div className="wk-smart-create-modal__field">
                <label className="wk-smart-create-modal__label">
                  {t("todo.field.goal")}<span className="wk-smart-create-modal__req">*</span>
                </label>
                <div className="wk-smart-create-modal__textarea-wrap">
                  <textarea
                    ref={briefRef}
                    className="wk-smart-create-modal__textarea"
                    value={brief}
                    onChange={(e) => setBrief(e.target.value.slice(0, 200))}
                    placeholder={t("todo.field.goalPlaceholder")}
                    rows={3}
                    maxLength={200}
                  />
                  <span className="wk-smart-create-modal__char-count">
                    {brief.length}/200
                  </span>
                  <VoiceInputButton
                    inputRef={briefRef}
                    onTranscribed={(text, mode, savedRange) => {
                      if (mode === "all") {
                        setBrief(text.slice(0, 200));
                      } else if (mode === "selection" && savedRange) {
                        setBrief(prev => {
                          const result = prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to);
                          return result.slice(0, 200);
                        });
                      } else {
                        setBrief(prev => {
                          const pos = savedRange?.from ?? prev.length;
                          const result = prev.slice(0, pos) + text + prev.slice(pos);
                          return result.slice(0, 200);
                        });
                      }
                    }}
                    getCurrentText={() => brief}
                    showModeMenu
                    size="sm"
                    className="wk-vib--textarea-corner"
                  />
                </div>
              </div>

              {/* 负责人 */}
              <div className="wk-smart-create-modal__field">
                <label className="wk-smart-create-modal__label">
                  {t("todo.field.assignee")}<span className="wk-smart-create-modal__req">*</span>
                </label>
                <MemberPicker
                  mode="controlled"
                  value={assigneeUids}
                  onChange={setAssigneeUids}
                  channel={channel}
                  placeholder={t("todo.common.selectPlaceholder")}
                />
              </div>

              {/* Deadline */}
              <div className="wk-smart-create-modal__field">
                <label className="wk-smart-create-modal__label">
                  {t("todo.field.deadline")}<span className="wk-smart-create-modal__req">*</span>
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
                  placeholder={t("todo.common.selectPlaceholder")}
                  density="compact"
                />
              </div>
            </div>

            {/* ─── Footer ─── */}
            <div className="wk-smart-create-modal__actions">
              <button
                type="button"
                className="wk-smart-create-modal__btn wk-smart-create-modal__btn--cancel"
                onClick={handleClose}
              >
                {t("todo.common.cancel")}
              </button>
              <button
                type="button"
                className="wk-smart-create-modal__btn wk-smart-create-modal__btn--confirm"
                onClick={handleConfirm}
                disabled={!canCreate || submitting}
              >
                {submitting
                  ? t("todo.state.submitting")
                  : sendOnConfirm
                    ? t("todo.create.sendAndCreate")
                    : t("todo.common.confirm")}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export { SmartCreateModal };
