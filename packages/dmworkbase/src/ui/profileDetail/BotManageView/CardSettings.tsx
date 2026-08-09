import React from "react";
import type { BotCardSettingRow } from "../../../bridge/profileDetail/botCardSettings";

/**
 * CardSettingsView —— L3「卡片消息设置」纯受控视图。
 *
 * 所有文案由 labels 注入（与 MentionFreeListView 同款），组件本身不碰 i18n，
 * 便于在 stories / 测试里直接喂假数据。
 */

export interface BotCardSettingsLabels {
  /** 行标题 / 说明，按 key 索引；未知 key 不会渲染所以无需兜底。 */
  rowTitle: Record<string, string>;
  rowDesc: Record<string, string>;
  /** 部署级总闸的只读状态条文案。 */
  masterLabel: string;
  masterOn: string;
  masterOffValue: string;
  /** 说明总闸为何不可点。 */
  masterReadonly: string;
  /** 总闸关闭时补充的影响说明。 */
  masterOffNotice: string;
  /** 交互型卡片依赖展示型卡片的行内提示。 */
  needsDisplayNotice: string;
  /**
   * source → 副标题文案。`global` 与 `default` 共用 sourceDefault，
   * 见 sourceLabel 的说明。
   */
  sourceBot: string;
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
  /**
   * 限流提示。
   *
   * 是函数而不是常量字符串，因为服务端在 429 上会给 `retry_after`（秒），有就报出
   * 具体等待时间。而且**文案不能把成因归给本页** —— 服务端确认这个令牌桶是整个进程
   * 所有认证路由共用的（约 60 个挂载点：发消息、会话同步、搜索、上传……），不是这三个
   * 端点专属，所以这里收到 429 时起因很可能压根不在这个页面。
   */
  rateLimited: (retryAfterSeconds?: number) => string;
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
  /** 429 时服务端给的等待秒数，透传给限流文案。 */
  writeErrorRetryAfterSeconds?: number;
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
  writeErrorRetryAfterSeconds,
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
        <MasterStatus labels={labels} masterEnabled={masterEnabled} />
        {writeErrorKind && (
          <div
            className="wk-bot-manage-notice wk-bot-manage-notice-error"
            // 写入失败是异步出现的，没有 live region 的话读屏用户不会被告知
            // ——「点了开关、静默弹回」对他们完全不可感知。
            role="alert"
            aria-live="assertive"
            data-testid="bot-card-settings-write-error"
          >
            {writeErrorMessage(
              writeErrorKind,
              labels,
              writeErrorRetryAfterSeconds,
            )}
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

/**
 * 部署级总闸的只读状态条。
 *
 * 常显（不只在关闭时出现）：它是三个子开关的上游门禁，藏起来的话用户没法自解释
 * 「我的开关为什么是灰的」，开启时也无从确认卡片能力整体可用。
 *
 * 刻意**不做成开关**：`bot.card_enabled` 派生自部署环境变量，服务端 `editable:false`
 * 且写它会 400（做成只读是为了防止库里写着「开」而环境是「关」，让清单和发卡门禁
 * 互相矛盾）。渲染成一个永远点不动的 switch 会是个骗人的控件，所以用状态条 + 一句
 * 「由服务端部署配置决定」说明。
 */
function MasterStatus({
  labels,
  masterEnabled,
}: {
  labels: BotCardSettingsLabels;
  masterEnabled: boolean;
}) {
  return (
    <div
      className={`wk-bot-manage-master ${
        masterEnabled ? "" : "wk-bot-manage-master-off"
      }`}
      data-testid={
        masterEnabled
          ? "bot-card-settings-master-on"
          : "bot-card-settings-master-off"
      }
    >
      <div className="wk-bot-manage-master-head">
        <span className="wk-bot-manage-master-label">{labels.masterLabel}</span>
        <span className="wk-bot-manage-master-value">
          {masterEnabled ? labels.masterOn : labels.masterOffValue}
        </span>
      </div>
      <div className="wk-bot-manage-master-hint">{labels.masterReadonly}</div>
      {/* 分成两个节点而不是拼字符串：句读在中英文里不同，拼接会出现半角句点混进
          中文文案的情况。 */}
      {!masterEnabled && (
        <div className="wk-bot-manage-master-warn">{labels.masterOffNotice}</div>
      )}
    </div>
  );
}

function writeErrorMessage(
  kind: string,
  labels: BotCardSettingsLabels,
  retryAfterSeconds?: number,
): string {
  if (kind === "rateLimited") return labels.rateLimited(retryAfterSeconds);
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
  // err.server.robot.not_found —— 该 bot 没有可用的 robot 记录（App Bot、被禁用的
  // 普通 Bot 都属于这一类）。**正常情况下到不了这里**：`bot_creator_uid` 与属主守卫
  // 读同一张表同一个 status 谓词，缺失时 isOwner 为假、整个 Bot 管理入口就不渲染。
  // 保留这条分支是纵深防御 —— 万一 `users/:uid` 失败而走了 channelInfo 兜底、拿到
  // 语义不同的 creator，至少给一句能读懂的话而不是「加载失败 + 重试」。
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
      {/* 用 button 而不是 div onClick：div 无法用键盘触达，也不进 tab 序。 */}
      <button
        type="button"
        className="wk-bot-manage-error-retry"
        onClick={onReload}
      >
        {labels.reload}
      </button>
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
  // 「取消自定义」只在存在显式覆盖（value !== null）且可写时出现。
  const showReset = row.overridden && row.editable;

  return (
    <div
      className="wk-bot-manage-group-row wk-bot-manage-card-row"
      data-testid={`bot-card-row-${row.key}`}
    >
      <div className="wk-bot-manage-group-main">
        <div className="wk-bot-manage-card-title">{title}</div>
        {/* 描述 / 状态用可换行的专用类，不复用 group-status —— 那个类是为群名设计的
            单行 + ellipsis，英文长句会被截在词中间（"…other con…"）。 */}
        {desc && <div className="wk-bot-manage-card-desc">{desc}</div>}
        {(meta || showReset) && (
          <div className="wk-bot-manage-card-meta">
            {meta && <span>{meta}</span>}
            {/* 「取消自定义」放在状态文字旁而不是右侧和开关同行：英文标签
                （Remove customization）比中文长一倍，和开关抢宽度会把开关顶到边缘；
                而且它作用的对象就是前面那句「已自定义」，放一起语义也更连贯。 */}
            {showReset && (
              <button
                type="button"
                className="wk-bot-manage-reset"
                // row.disabled 涵盖总闸关闭 / 只读 / 正在取消自定义。总闸关闭时
                // 一并禁用：整组开关都灰了、状态条也说了「下方设置都不生效」，
                // 旁边留一个能点的删除动作会让页面对「能不能编辑」给出两个说法。
                // 按钮保留可见（而不是隐藏），因为「这里有个覆盖」本身是信息。
                disabled={row.pending || row.disabled}
                onClick={() => onReset(row.key)}
                data-testid={`bot-card-reset-${row.key}`}
              >
                {labels.reset}
              </button>
            )}
          </div>
        )}
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

/**
 * source → 副标题文案。
 *
 * `global`（服务端全局默认）和 `default`（代码默认）**刻意合并成同一句文案**。
 * 两者对属主没有任何可操作性差异 —— 都是「这项我没设过，跟着上层走」，而"全局设置"
 * 和"系统默认"的区别是服务端的分层实现细节，摊到用户面前只会引出"这俩有啥区别"。
 * 需要额外解释才能懂的文案就是失败的文案。
 *
 * 分层信息没有丢：VM 仍原样保留 `source`，将来若真要区分（比如显示"取消自定义后会
 * 变成 X"）随时能拿到。
 */
function sourceLabel(source: string, labels: BotCardSettingsLabels): string {
  switch (source) {
    case "bot":
      return labels.sourceBot;
    case "global":
    case "default":
      return labels.sourceDefault;
    case "env":
      return labels.sourceEnv;
    default:
      return "";
  }
}

export default CardSettingsView;
