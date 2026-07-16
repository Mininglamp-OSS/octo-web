import React, { useEffect, useMemo, useState } from "react";
import { WKModal, WKButton, t } from "@octo/base";
import { Toast, Spin } from "@douyinfe/semi-ui";
import { deleteMcp, fetchMcpDetail } from "../api/mcpService";
import { buildQuickStartTabs } from "../api/quickStartTemplates";
import type { McpDetail, McpQuickStart } from "../types/mcp";
import { IconGlyph } from "../utils/icon";

interface McpDetailModalProps {
  /** The id of the MCP to show; null closes the modal. */
  mcpId: string | null;
  onClose: () => void;
  /** When true, show Edit + Delete buttons in the footer. Passed by the
   *  parent when the detail was opened from a context that guarantees the
   *  caller owns the record (the "我的" tab). */
  canManage?: boolean;
  /** Fired when the user clicks Edit — parent opens the edit modal. */
  onEdit?: (detail: McpDetail) => void;
  /** Fired after a successful delete — parent refreshes the list. */
  onDeleted?: (id: string) => void;
}

/**
 * The ⚡快速接入 block. Three tabs (提示词 / 命令行 / JSON) are all generated
 * from the structured `quickStart` payload; the token position always renders
 * as the `<把这里换成你的 Token>` placeholder. Default tab = 提示词.
 */
const QuickAccess: React.FC<{ quickStart: McpQuickStart }> = ({
  quickStart,
}) => {
  const tabs = useMemo(() => buildQuickStartTabs(quickStart), [quickStart]);
  const [active, setActive] = useState(tabs[0]?.key ?? "prompt");
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];

  const handleCopy = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.content);
      Toast.success(t("mcp.detail.copied"));
    } catch {
      Toast.error(t("mcp.detail.copyFailed"));
    }
  };

  return (
    <div className="wk-mcp-qa">
      <div className="wk-mcp-qa__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={
              tab.key === active
                ? "wk-mcp-qa__tab wk-mcp-qa__tab--active"
                : "wk-mcp-qa__tab"
            }
            onClick={() => setActive(tab.key)}
          >
            {t(`mcp.detail.qsTab.${tab.labelKey}`)}
          </button>
        ))}
      </div>
      <div className="wk-mcp-code">
        <div className="wk-mcp-code__copy">
          <WKButton size="sm" variant="ghost" onClick={handleCopy}>
            {t("mcp.detail.copy")}
          </WKButton>
        </div>
        <pre className="wk-mcp-code__pre">{current?.content}</pre>
      </div>
      <div className="wk-mcp-qa__hint">{t("mcp.detail.tokenHint")}</div>
    </div>
  );
};

/**
 * Centered detail modal for an MCP server.
 * Section order (per product spec):
 * ⚡快速接入 → 🔧工具清单 → 💬使用示例 → ❓常见问题 → ⚠️注意事项.
 */
const McpDetailModal: React.FC<McpDetailModalProps> = ({
  mcpId,
  onClose,
  canManage,
  onEdit,
  onDeleted,
}) => {
  const [detail, setDetail] = useState<McpDetail | null>(null);
  const [loading, setLoading] = useState(false);
  /** 就地内联删除确认：footer 切换成「确认删除 / 取消」而非再叠一层弹窗。 */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!mcpId) {
      setDetail(null);
      return;
    }
    // 每次打开新的详情都重置内联确认态，避免残留上一次的确认条。
    setConfirmingDelete(false);
    setDeleting(false);
    let cancelled = false;
    setLoading(true);
    fetchMcpDetail(mcpId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          Toast.error(
            err instanceof Error ? err.message : t("mcp.common.loadFailed")
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mcpId]);

  const handleEdit = () => {
    if (!detail || !onEdit) return;
    onEdit(detail);
  };

  /** 就地内联确认删除：第一次点「删除」只把 footer 切成确认态，不弹新窗，
   *  从根本上避免 modal 套 modal（详情 WKModal 上再叠一层 wkConfirm 遮罩）。
   *  第二次点「确认删除」才真正发起网络请求，成功后通知父组件并关闭详情。 */
  const handleDeleteClick = () => {
    if (!detail) return;
    setConfirmingDelete(true);
  };

  const handleCancelDelete = () => {
    if (deleting) return;
    setConfirmingDelete(false);
  };

  const handleConfirmDelete = async () => {
    if (!detail || deleting) return;
    setDeleting(true);
    try {
      await deleteMcp(detail.id);
      Toast.success(t("mcp.delete.success"));
      onDeleted?.(detail.id);
      onClose();
    } catch (err: unknown) {
      Toast.error(err instanceof Error ? err.message : t("mcp.delete.failed"));
      // 失败时保持在确认态，让用户可以重试或取消。
    } finally {
      setDeleting(false);
    }
  };

  const showActions = canManage && !!detail;

  const handleModalCancel = () => {
    if (deleting) return;
    setConfirmingDelete(false);
    onClose();
  };

  return (
    <WKModal
      visible={!!mcpId}
      onCancel={handleModalCancel}
      width={900}
      className="wk-mcp-detail-modal"
      bodyStyle={{ height: "70vh", overflowY: "auto" }}
      title={detail ? detail.name : t("mcp.detail.title")}
      footer={
        showActions ? (
          confirmingDelete ? (
            <div className="wk-mcp-detail-actions wk-mcp-detail-actions--confirm">
              <span className="wk-mcp-detail-actions__hint">
                {t("mcp.delete.confirmBody")}
              </span>
              <WKButton
                variant="secondary"
                disabled={deleting}
                onClick={handleCancelDelete}
              >
                {t("mcp.delete.cancel")}
              </WKButton>
              <WKButton
                variant="danger"
                loading={deleting}
                onClick={handleConfirmDelete}
              >
                {t("mcp.delete.ok")}
              </WKButton>
            </div>
          ) : (
            <div className="wk-mcp-detail-actions">
              <WKButton variant="danger" onClick={handleDeleteClick}>
                {t("mcp.detail.delete")}
              </WKButton>
              <WKButton variant="primary" onClick={handleEdit}>
                {t("mcp.detail.edit")}
              </WKButton>
            </div>
          )
        ) : null
      }
    >
      {loading || !detail ? (
        <div className="wk-mcp__state">
          <Spin />
        </div>
      ) : (
        <div className="wk-mcp-detail">
          <div className="wk-mcp-detail__meta">
            <div className="wk-mcp-detail__icon">
              <IconGlyph
                icon={detail.icon}
                className="wk-mcp-detail__icon-img"
                alt={detail.name}
              />
            </div>
            <div className="wk-mcp-detail__meta-main">
              <div className="wk-mcp-card__tags">
                {detail.tags.map((tag) => (
                  <span key={tag} className="wk-mcp-tag wk-mcp-tag--accent">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="wk-mcp-detail__toolcount">
                {detail.creatorName ? `@${detail.creatorName} · ` : ""}
                {t("mcp.card.toolCount", {
                  values: { count: detail.toolCount },
                })}
              </div>
            </div>
          </div>

          {/* 1. ⚡快速接入 */}
          <section className="wk-mcp-section">
            <h4 className="wk-mcp-section__title">
              ⚡ {t("mcp.detail.quickAccess")}
            </h4>
            <QuickAccess quickStart={detail.quickStart} />
          </section>

          {/* 2. 🔧工具清单 */}
          <section className="wk-mcp-section">
            <h4 className="wk-mcp-section__title">
              🔧 {t("mcp.detail.tools")}
            </h4>
            <div className="wk-mcp-tools">
              {detail.tools.map((tool) => (
                <div className="wk-mcp-tool" key={tool.name}>
                  <div className="wk-mcp-tool__name">{tool.name}</div>
                  <div className="wk-mcp-tool__desc">{tool.description}</div>
                </div>
              ))}
            </div>
          </section>

          {/* 3. 💬使用示例 — 多条 */}
          {detail.usageExamples.length > 0 && (
            <section className="wk-mcp-section">
              <h4 className="wk-mcp-section__title">
                💬 {t("mcp.detail.example")}
              </h4>
              <div className="wk-mcp-examples">
                {detail.usageExamples.map((ex, i) => (
                  <div className="wk-mcp-example" key={i}>
                    {ex}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. ❓常见问题 */}
          {detail.faqs.length > 0 && (
            <section className="wk-mcp-section">
              <h4 className="wk-mcp-section__title">
                ❓ {t("mcp.detail.faq")}
              </h4>
              <div className="wk-mcp-faq">
                {detail.faqs.map((faq) => (
                  <div className="wk-mcp-faq__item" key={faq.question}>
                    <div className="wk-mcp-faq__q">{faq.question}</div>
                    <div className="wk-mcp-faq__a">{faq.answer}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 5. ⚠️注意事项 */}
          {detail.notes.length > 0 && (
            <section className="wk-mcp-section">
              <h4 className="wk-mcp-section__title">
                ⚠️ {t("mcp.detail.notes")}
              </h4>
              <div className="wk-mcp-notes">
                {detail.notes.map((note, i) => (
                  <div className="wk-mcp-notes__item" key={i}>
                    {note}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </WKModal>
  );
};

export default McpDetailModal;
