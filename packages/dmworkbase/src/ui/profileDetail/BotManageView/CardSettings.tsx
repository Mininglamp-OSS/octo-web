import React from "react";
import type { BotCardSettingRow } from "../../../bridge/profileDetail/botCardSettings";

/**
 * CardSettingsView —— L3「卡片消息能力」纯受控视图。
 *
 * 所有文案由 labels 注入（与 MentionFreeListView 同款），组件本身不碰 i18n，
 * 便于在 stories / 测试里直接喂假数据。
 */

export interface BotCardSettingsLabels {
  /** 行标题 / 说明，按 key 索引；未知 key 不会渲染所以无需兜底。 */
  rowTitle: Record<string, string>;
  rowDesc: Record<string, string>;
  /** 总闸关闭时的整页提示条。 */
  masterOffNotice: string;
  /** 交互型卡片依赖展示型卡片的行内提示。 */
  needsDisplayNotice: string;
  /** source → 副标题文案。 */
  sourceBot: string;
  sourceGlobal: string;
  sourceDefault: string;
  sourceEnv: string;
  reset: string;
  loading: string;
  loadFailed: string;
  reload: string;
  backendComingSoon: string;
  stayTuned: string;
  unsupported: string;
  forbidden: string;
  empty: string;
  saveFailed: string;
  saveFailedRetryable: string;
  rateLimited: string;
}

export interface CardSettingsViewProps {
  labels: BotCardSettingsLabels;
  rows: BotCardSettingRow[];
  masterEnabled: boolean;
  loading: boolean;
  /** 已有数据时的重拉不应把整页换成 spinner。 */
  hasData: boolean;
  loadErrorKind?: string;
  writeErrorKind?: string;
  onToggle: (key: string, next: boolean) => void;
  onReset: (key: string) => void;
  onReload: () => void;
}

export function CardSettingsView({
  labels,
  rows,
  masterEnabled,
  loading,
  hasData,
  loadErrorKind,
  writeErrorKind,
  onToggle,
  onReset,
  onReload,
}: CardSettingsViewProps) {
  if (loading && !hasData) {
    return (
      <div className="wk-bot-manage-mention">
        <div className="wk-bot-manage-loading">{labels.loading}</div>
      </div>
    );
  }

  if (loadErrorKind) {
    return (
      <div className="wk-bot-manage-mention">
        <CardSettingsFallback
          kind={loadErrorKind}
          labels={labels}
          onReload={onReload}
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="wk-bot-manage-mention">
        <div className="wk-bot-manage-empty">{labels.empty}</div>
      </div>
    );
  }

  return (
    <div className="wk-bot-manage-mention">
      <div className="wk-bot-manage-list" data-testid="bot-card-settings-list">
        {!masterEnabled && (
          <div
            className="wk-bot-manage-notice"
            data-testid="bot-card-settings-master-off"
          >
            {labels.masterOffNotice}
          </div>
        )}
        {writeErrorKind && (
          <div
            className="wk-bot-manage-notice wk-bot-manage-notice-error"
            data-testid="bot-card-settings-write-error"
          >
            {writeErrorMessage(writeErrorKind, labels)}
          </div>
        )}
        <div className="wk-bot-manage-group-list">
          {rows.map((row) => (
            <CardSettingRow
              key={row.key}
              row={row}
              labels={labels}
              onToggle={onToggle}
              onReset={onReset}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function writeErrorMessage(kind: string, labels: BotCardSettingsLabels): string {
  if (kind === "rateLimited") return labels.rateLimited;
  // retryable = 服务端错误（真实 500，线路状态码可能是 400）。文案必须提示重试，
  // 不能说「参数有误」引导用户去改输入。
  if (kind === "retryable") return labels.saveFailedRetryable;
  return labels.saveFailed;
}

function CardSettingsFallback({
  kind,
  labels,
  onReload,
}: {
  kind: string;
  labels: BotCardSettingsLabels;
  onReload: () => void;
}) {
  // 后端路由未部署（无 error.code 的 404）——会上线，所以给「即将上线」骨架。
  if (kind === "backendMissing") {
    return (
      <div className="wk-bot-manage-empty">
        {labels.backendComingSoon}
        <br />
        {labels.stayTuned}
      </div>
    );
  }
  // err.server.robot.not_found —— 该 bot 没有 robot 记录（含 App Bot），
  // 不是「还没上线」，给不同文案且不给重试按钮。
  if (kind === "unsupported") {
    return (
      <div className="wk-bot-manage-empty" data-testid="bot-card-settings-unsupported">
        {labels.unsupported}
      </div>
    );
  }
  if (kind === "forbidden") {
    return <div className="wk-bot-manage-empty">{labels.forbidden}</div>;
  }
  return (
    <div className="wk-bot-manage-error">
      {labels.loadFailed}
      <div className="wk-bot-manage-error-retry" onClick={onReload}>
        {labels.reload}
      </div>
    </div>
  );
}

function CardSettingRow({
  row,
  labels,
  onToggle,
  onReset,
}: {
  row: BotCardSettingRow;
  labels: BotCardSettingsLabels;
  onToggle: (key: string, next: boolean) => void;
  onReset: (key: string) => void;
}) {
  const title = labels.rowTitle[row.key] ?? row.key;
  const desc = labels.rowDesc[row.key] ?? "";
  const meta = sourceLabel(row.source, labels);

  return (
    <div className="wk-bot-manage-group-row" data-testid={`bot-card-row-${row.key}`}>
      <div className="wk-bot-manage-group-main">
        <div className="wk-bot-manage-group-name">{title}</div>
        {desc && <div className="wk-bot-manage-group-status">{desc}</div>}
        {meta && <div className="wk-bot-manage-group-status">{meta}</div>}
        {row.needsDisplay && (
          <div
            className="wk-bot-manage-row-warn"
            data-testid={`bot-card-needs-display-${row.key}`}
          >
            {labels.needsDisplayNotice}
          </div>
        )}
      </div>
      <div className="wk-bot-manage-row-actions">
        {/* 恢复默认 = DELETE 覆盖回落上一层，不是设为 false。只有存在显式覆盖
            （value !== null）且可写时才出现。 */}
        {row.overridden && row.editable && (
          <button
            type="button"
            className="wk-bot-manage-reset"
            disabled={row.pending}
            onClick={() => onReset(row.key)}
            data-testid={`bot-card-reset-${row.key}`}
          >
            {labels.reset}
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={row.checked}
          aria-label={title}
          disabled={row.disabled}
          className={`wk-bot-manage-switch ${
            row.checked ? "wk-bot-manage-switch-on" : ""
          } ${row.pending ? "wk-bot-manage-switch-loading" : ""}`}
          onClick={() => {
            if (row.disabled) return;
            onToggle(row.key, !row.checked);
          }}
          data-testid={`bot-card-switch-${row.key}`}
        >
          <span className="wk-bot-manage-switch-thumb" />
        </button>
      </div>
    </div>
  );
}

function sourceLabel(source: string, labels: BotCardSettingsLabels): string {
  switch (source) {
    case "bot":
      return labels.sourceBot;
    case "global":
      return labels.sourceGlobal;
    case "default":
      return labels.sourceDefault;
    case "env":
      return labels.sourceEnv;
    default:
      return "";
  }
}

export default CardSettingsView;
