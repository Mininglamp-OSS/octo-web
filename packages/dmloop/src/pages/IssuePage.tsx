import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Input,
  Button,
  Spin,
  Select,
  Pagination,
  DatePicker,
  Checkbox,
  Dropdown,
} from "@douyinfe/semi-ui";
import { Search, Plus, LayoutGrid, List as ListIcon, Users, ClipboardList, ArrowUp, ArrowDown, SlidersHorizontal, Filter } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type {
  Issue,
  IssueGroup,
  IssueScope,
  IssueStatus,
  IssuePriority,
  IssueSortField,
  IssueDateField,
} from "../api/types";
import { ISSUE_SORT_FIELDS, ISSUE_DATE_FIELDS } from "../api/types";
import { listIssues, searchIssues, listGroupedIssues, listMyGroupedIssues, getAgentTaskSnapshot } from "../api/issueApi";
import { listProjectOptions } from "../api/directory";
import { useAssigneeCandidates } from "../ui/useAssigneeCandidates";
import { ISSUE_STATUS_ORDER, PRIORITY_ORDER, isActiveRun } from "../ui/meta";
import IssueBoard from "../panel/IssueBoard";
import IssueGroupBoard from "../panel/IssueGroupBoard";
import IssueList from "../panel/IssueList";
import IssueDetailPage from "../panel/IssueDetailPage";
import NewLoopPage from "./NewLoopPage";
import { readView, writeView } from "../ui/viewMode";

type ViewMode = "board" | "grouped" | "list";

// scope pill → assignee_types 过滤(仅 /grouped 支持;all/involves 不按类型收窄)。
function scopeToAssigneeTypes(scope: IssueScope): ("member" | "agent" | "squad")[] | undefined {
  if (scope === "members") return ["member"];
  if (scope === "agents") return ["agent", "squad"];
  return undefined;
}

interface Filters {
  keyword: string;
  status?: IssueStatus;        // board/list 单选
  priority?: IssuePriority;    // board/list 单选
  assignee?: string;
  creator?: string;
  project?: string;            // board/list 单选
  // 分组板专属多选 + no-project(仅 /grouped 支持 statuses[]/priorities[]/project_ids[]/include_no_project)。
  // 注:无 include_no_assignee —— scope pill 用 assignee_types(类型级、顶层 AND),后端
  // include_no_assignee 只与 assignee_filters(具体 actor)配对才是「含」语义;与 assignee_types/
  // involves 的 assignee_id 腿 AND 会矛盾成空。grouped 在 scope=all 下本就显示未指派组。
  gStatuses: IssueStatus[];
  gPriorities: IssuePriority[];
  gProjectIds: string[];
  noProject: boolean;
  dateField: IssueDateField; // 时间范围筛选的列(created_at|updated_at)
  dateRange?: Date[];        // [start, end];为空则不按时间筛选
  sortBy: IssueSortField;
  sortDir: "asc" | "desc";
}

const PAGE_SIZE = 50;

// 筛选/显示字段都挂在工具栏 Dropdown 面板(z-index 1060)里,其弹层默认取 Semi 基准 1030 →
// 会被面板本体盖在下面(选项看不见也点不到)。统一抬到面板之上。
const FIELD_POPUP = { dropdownClassName: "loop-fields__dropdown", zIndex: 2000 } as const;

// 「我的回路」复用本页：defaultView="grouped" + defaultScope="involves" 即只看与我相关。
interface IssuePageProps {
  defaultScope?: IssueScope;
  defaultView?: ViewMode;
  // 视图偏好持久化 key（按页区分：回路 / 我的回路各存各的，缺省则不持久化）。
  viewKey?: string;
}

export default function IssuePage({ defaultScope, defaultView, viewKey }: IssuePageProps = {}) {
  const { t } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [groups, setGroups] = useState<IssueGroup[]>([]);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>(() => viewKey ? readView(viewKey, ["board", "grouped", "list"], defaultView ?? "board") : (defaultView ?? "board"));
  const [scope, setScope] = useState<IssueScope>(defaultScope ?? "all");
  const [f, setF] = useState<Filters>({ keyword: "", gStatuses: [], gPriorities: [], gProjectIds: [], noProject: false, sortBy: "position", sortDir: "desc", dateField: "created_at" });
  const [page, setPage] = useState(0); // 0-based，仅列表视图分页
  // 筛选/显示 面板受控可见:不用 clickToHide(它会在点击内部 Select/DatePicker/Checkbox
  // 时冒泡关闭,且这些控件的 portal 选项面板点击也会误触发关闭),改为显式
  // onVisibleChange —— 仅外部点击关闭,内部多字段交互保持面板打开。
  const [filterOpen, setFilterOpen] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const cands = useAssigneeCandidates();
  // 当前 octo 成员的后端 user_id(involves_user_id 需 UUID,非 octo uid)：
  // 复用订阅特性的身份解析——候选里 octo_uid===loginInfo.uid 的 member。未解析出则「与我相关」不可用。
  const myMemberId = useMemo(() => {
    const uid = WKApp.loginInfo.uid;
    return uid ? cands.find((c) => c.type === "member" && c.octo_uid === uid)?.id : undefined;
  }, [cands]);
  // 项目下拉复用 directory 已缓存的 /projects(避免重复请求);随 workspace 切换整页重挂而刷新。
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const seq = useRef(0); // 请求序号：只应用最新一次的响应，防并发乱序覆盖

  useEffect(() => {
    listProjectOptions().then(setProjects).catch(() => {});
  }, []);

  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    // 时间范围:三参数须同时给且 start<end。onChange 已把 dateRange 归一为 undefined|[起,止]。
    // 止端 +1 日历日 → 半开区间,既含止日当天、又保证 start<end;setDate 处理 DST。
    const dr = f.dateRange;
    const endExclusive = dr && new Date(dr[1]);
    if (endExclusive) endExclusive.setDate(endExclusive.getDate() + 1);

    // 分组板:走 /issues/grouped(按负责人);scope pill 收窄 assignee_types。
    // grouped 不吃关键词/排序,故这两项在分组视图隐藏。
    if (view === "grouped") {
      const gp = {
        // 分组板多选:空数组 → 不发(不收窄)。
        statuses: f.gStatuses.length ? f.gStatuses : undefined,
        priorities: f.gPriorities.length ? f.gPriorities : undefined,
        project_ids: f.gProjectIds.length ? f.gProjectIds : undefined,
        include_no_project: f.noProject || undefined,
        creator_id: f.creator,
        date_field: dr ? f.dateField : undefined,
        date_start: dr ? dr[0].toISOString() : undefined,
        date_end: endExclusive ? endExclusive.toISOString() : undefined,
        // ponytail: 每组取后端上限 100；超量请用筛选。
        limit: 100,
      };
      // 「与我相关」= 指派给我 ∪ 我创建 ∪ 间接关联(后端三过滤并集,fan-out 合并);
      // 其余 scope 单发一次、按 assignee_types 收窄。
      // scope=involves 需当前成员的后端 id;未解析出时**不回退成无 scope 全量**(否则「与我相关」
      // 会错显全部)。清空并结束——myMemberId 在 reload 依赖里,解析后会自动重取。
      if (scope === "involves" && !myMemberId) {
        if (my === seq.current) { setGroups([]); setLoading(false); }
        return;
      }
      const req =
        scope === "involves"
          ? listMyGroupedIssues(myMemberId!, gp) // 上方守卫已保证 myMemberId 存在
          : listGroupedIssues({ ...gp, assignee_types: scopeToAssigneeTypes(scope) });
      req
        .then((gs) => { if (my === seq.current) setGroups(gs); })
        .finally(() => { if (my === seq.current) setLoading(false); });
      return;
    }

    const paged = view === "list";
    const kw = f.keyword.trim();
    // 有关键词 → 走全文搜索端点(独立语义:后端不吃其它筛选/排序、上限 50);否则常规筛选列表。
    const req = kw
      ? searchIssues(kw, { limit: paged ? PAGE_SIZE : 50, offset: paged ? page * PAGE_SIZE : 0 })
      : listIssues({
          status: f.status,
          priority: f.priority,
          assignee_id: f.assignee,
          creator_id: f.creator,
          project_id: f.project,
          date_field: dr ? f.dateField : undefined,
          date_start: dr ? dr[0].toISOString() : undefined,
          date_end: endExclusive ? endExclusive.toISOString() : undefined,
          // 排序仅用于列表视图;看板按 status 分列 + 100 上限,叠加全局排序会把某状态整列截没,故看板固定后端默认(position)。
          sort_by: paged ? f.sortBy : undefined,
          sort_direction: paged ? f.sortDir : undefined,
          // ponytail: 看板不分页——按 status 分列需全量，取后端上限 100；超量请用筛选或列表视图。
          limit: paged ? PAGE_SIZE : 100,
          offset: paged ? page * PAGE_SIZE : 0,
        });
    req
      .then(({ issues, total }) => {
        if (my !== seq.current) return; // 有更新的请求在途，丢弃本次过期响应
        // 删除/改状态使匹配数下降时，当前 page 可能越界（offset≥total）→ 钳到最后一页并重取。
        if (paged) {
          const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
          if (page > maxPage) { setPage(maxPage); return; }
        }
        setIssues(issues);
        setTotal(total);
      })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [f, view, page, scope, myMemberId]);

  useEffect(reload, [reload]);

  // 运行中快照:视图/筛选无关(工作区级),故不进 reload 的依赖 —— 不随筛选/翻页/切视图白拉。
  // seq 守卫:agent 任务独立起停,多次刷新在途时只让最新一次落地,防旧响应覆盖新。
  const runSeq = useRef(0);
  const refreshRunning = useCallback(() => {
    const my = ++runSeq.current;
    getAgentTaskSnapshot()
      .then((tasks) => { if (my === runSeq.current) setRunning(new Set(tasks.filter((tk) => isActiveRun(tk.status) && tk.issue_id).map((tk) => tk.issue_id))); })
      .catch(() => {});
  }, []);
  // 挂载取一次 + 每 15s 轮询:无 WS 推送,agent 起停靠轮询让 running chip 最终收敛(而非只在本地 mutation 后)。
  useEffect(() => {
    refreshRunning();
    const timer = setInterval(refreshRunning, 15000);
    return () => clearInterval(timer);
  }, [refreshRunning]);

  // 变更后刷新:既重取列表,又刷新运行中快照(指派/状态变更可能起/停 agent run)。
  const onMutated = useCallback(() => { reload(); refreshRunning(); }, [reload, refreshRunning]);

  // 派单(quick-create)是异步的:agent 稍后才建 issue(dmloop 无 WS 推送,见记忆 dmloop-no-realtime-defer-ws)。
  // NewLoopPage 派单成功发 `wk:loop-issues-dispatched`,常驻的 LoopPage 据此有界补发 `wk:loop-issues-refresh`,
  // 看板收到即重取——一套机制覆盖"看板内新建"与"侧栏新建"两个入口(定时器归 LoopPage,见那里)。
  // 走 ref 读最新 onMutated:延迟刷新须用当前筛选/视图,否则会用陈旧入参覆盖(reload 的 seq 守卫只防乱序)。
  // ponytail: 真正的修法是 WS 实时推送(已记后期做),此为 stopgap;派单低频,几次补刷可接受。
  const onMutatedRef = useRef(onMutated);
  useEffect(() => { onMutatedRef.current = onMutated; }, [onMutated]);
  useEffect(() => {
    const onRefresh = () => onMutatedRef.current();
    WKApp.mittBus.on("wk:loop-issues-refresh", onRefresh);
    return () => WKApp.mittBus.off("wk:loop-issues-refresh", onRefresh);
  }, []);

  // 改任一筛选/搜索都回到第一页，避免停在越界的 offset（此规则只此一处表达）。
  const update = (p: Partial<Filters>) => { setF((prev) => ({ ...prev, ...p })); setPage(0); };
  const switchView = (v: ViewMode) => { setView(v); setPage(0); if (viewKey) writeView(viewKey, v); };

  // 点击 Issue → 跳转独立详情页（push 到右主栏，返回可 pop）。
  // key=id:issueId 变化即整体重挂载 → 详情页所有异步状态从零开始,结构性杜绝跨 issue 陈旧写入
  // (如未来点子 issue 原地切换时,慢请求无法把旧 issue 数据写进新 issue 视图)。
  const openDetail = (id: string) => {
    WKApp.routeRight.push(<IssueDetailPage key={id} issueId={id} onChanged={onMutated} />);
  };

  // 新建回路 → 唤起独立 composer 页（非弹窗，对齐 Figma）。创建成功后 pop 回列表并刷新。
  const openNewLoop = () => {
    WKApp.routeRight.push(
      <NewLoopPage
        onCreated={() => { onMutated(); WKApp.routeRight.pop(); }}
      />,
    );
  };

  const isEmpty = view === "grouped" ? groups.every((g) => g.issues.length === 0) : total === 0;

  // 状态/优先级/项目的选项列表:单选与多选两个分支共用(避免重复 map)。
  const statusOpts = ISSUE_STATUS_ORDER.map((s) => (
    <Select.Option key={s} value={s}>{t(`loop.status.${s}`)}</Select.Option>
  ));
  const priorityOpts = PRIORITY_ORDER.map((p) => (
    <Select.Option key={p} value={p}>{t(`loop.priority.${p}`)}</Select.Option>
  ));
  const projectOpts = projects.map((p) => (
    <Select.Option key={p.id} value={p.id}>{p.title}</Select.Option>
  ));

  const title = defaultScope === "involves" ? t("loop.nav.myloop") : t("loop.nav.issue");

  // 关键词走全文搜索端点(独立语义,后端不吃其它筛选/排序)。搜索激活时禁用面板内其它筛选,
  // 避免它们「看起来生效、实际被忽略」的误导(grouped 视图隐藏关键词,故 searching 恒 false)。
  const searching = view !== "grouped" && !!f.keyword.trim();

  // 「筛选」按钮上的激活计数(仅计当前视图会生效的维度)。
  const activeFilters =
    (view === "grouped"
      ? f.gStatuses.length + f.gPriorities.length + f.gProjectIds.length + (f.noProject ? 1 : 0)
      : (f.status ? 1 : 0) + (f.priority ? 1 : 0) + (f.assignee ? 1 : 0) + (f.project ? 1 : 0) + (f.keyword.trim() ? 1 : 0)) +
    (f.creator ? 1 : 0) +
    (f.dateRange ? 1 : 0);

  const clearFilters = () =>
    update({
      keyword: "", status: undefined, priority: undefined, assignee: undefined, creator: undefined, project: undefined,
      gStatuses: [], gPriorities: [], gProjectIds: [], noProject: false, dateRange: undefined,
    });

  // 「筛选」面板：把原工具栏散落的下拉收进一个面板（对齐产品设计 的筛选框）。维度按视图切换单选/多选。
  const filterPanel = (
    <div className="loop-fields loop-filter-panel">
      <div className="loop-filter-panel__head">
        <span>{t("loop.action.filter")}</span>
        {activeFilters > 0 && (
          <button type="button" className="loop-filter-panel__clear" onClick={clearFilters}>{t("loop.action.clearFilters")}</button>
        )}
      </div>
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.filter.status")}</div>
        {view === "grouped" ? (
          <Select multiple value={f.gStatuses} onChange={(v) => update({ gStatuses: (v ?? []) as IssueStatus[] })} showClear maxTagCount={2} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={t("loop.filter.status")}>{statusOpts}</Select>
        ) : (
          <Select value={f.status} onChange={(v) => update({ status: v as IssueStatus | undefined })} showClear disabled={searching} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={t("loop.filter.status")}>{statusOpts}</Select>
        )}
      </div>
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.filter.priority")}</div>
        {view === "grouped" ? (
          <Select multiple value={f.gPriorities} onChange={(v) => update({ gPriorities: (v ?? []) as IssuePriority[] })} showClear maxTagCount={2} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={t("loop.filter.priority")}>{priorityOpts}</Select>
        ) : (
          <Select value={f.priority} onChange={(v) => update({ priority: v as IssuePriority | undefined })} showClear disabled={searching} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={t("loop.filter.priority")}>{priorityOpts}</Select>
        )}
      </div>
      {/* assignee 单选仅扁平列表/看板(grouped 用 scope 按类型收窄)。 */}
      {view !== "grouped" && (
        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.filter.assignee")}</div>
          <Select value={f.assignee} onChange={(v) => update({ assignee: v as string | undefined })} showClear filter disabled={searching} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={t("loop.filter.assignee")}>
            {cands.map((c) => (<Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>))}
          </Select>
        </div>
      )}
      {/* 「与我相关」自带 creator=我 并集腿,creator 下拉对它无效 → 隐藏。 */}
      {!(view === "grouped" && scope === "involves") && (
        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.filter.creator")}</div>
          <Select value={f.creator} onChange={(v) => update({ creator: v as string | undefined })} showClear filter disabled={searching} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={t("loop.filter.creator")}>
            {cands.filter((c) => c.type === "member").map((c) => (<Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>))}
          </Select>
        </div>
      )}
      {projects.length > 0 && (
        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.filter.project")}</div>
          {view === "grouped" ? (
            <Select multiple value={f.gProjectIds} onChange={(v) => update({ gProjectIds: (v ?? []) as string[] })} showClear filter maxTagCount={1} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={t("loop.filter.project")}>{projectOpts}</Select>
          ) : (
            <Select value={f.project} onChange={(v) => update({ project: v as string | undefined })} showClear filter disabled={searching} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={t("loop.filter.project")}>{projectOpts}</Select>
          )}
        </div>
      )}
      {/* no-project:仅分组板(后端 include_no_project 仅 /grouped 支持)。 */}
      {view === "grouped" && (
        <div className="loop-fields__row">
          <Checkbox className="loop-nofilter" checked={f.noProject} onChange={(e) => update({ noProject: !!e.target.checked })}>{t("loop.filter.noProject")}</Checkbox>
        </div>
      )}
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.filter.dateRange")}</div>
        <div className="loop-fields__inline">
          <Select value={f.dateField} onChange={(v) => update({ dateField: v as IssueDateField })} disabled={searching} {...FIELD_POPUP} style={{ width: 104 }}>
            {ISSUE_DATE_FIELDS.map((d) => (<Select.Option key={d} value={d}>{t(`loop.dateField.${d}`)}</Select.Option>))}
          </Select>
          <DatePicker type="dateRange" density="compact" disabled={searching} value={f.dateRange} onChange={(d) => update({ dateRange: Array.isArray(d) && d.length === 2 && d[0] && d[1] ? (d as Date[]) : undefined })} placeholder={t("loop.filter.dateRange")} zIndex={FIELD_POPUP.zIndex} style={{ flex: 1 }} />
        </div>
      </div>
      {/* 关键词走全文搜索(独立语义,不与 grouped 组合),故分组视图隐藏。 */}
      {view !== "grouped" && (
        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.search.issue")}</div>
          <Input className="loop-search" prefix={<Search size={14} />} placeholder={t("loop.search.issue")} value={f.keyword} onChange={(v) => update({ keyword: v })} showClear style={{ width: "100%" }} />
        </div>
      )}
    </div>
  );

  // 「显示」面板：视图切换 + 列表排序。
  const showPanel = (
    <div className="loop-fields loop-show-panel">
      <div className="loop-filter-panel__head"><span>{t("loop.action.show")}</span></div>
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.view.board")}</div>
        <div className="loop-seg" role="tablist">
          {(["board", "grouped", "list"] as ViewMode[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={`loop-seg__btn${view === v ? " is-active" : ""}`} onClick={() => switchView(v)}>
              {v === "board" ? <LayoutGrid size={14} /> : v === "grouped" ? <Users size={14} /> : <ListIcon size={14} />}
              {t(`loop.view.${v}`)}
            </button>
          ))}
        </div>
      </div>
      {view === "list" && (
        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.sort.direction")}</div>
          <div className="loop-fields__inline">
            <Select value={f.sortBy} onChange={(v) => update({ sortBy: v as IssueSortField })} disabled={searching} {...FIELD_POPUP} style={{ flex: 1 }}>
              {ISSUE_SORT_FIELDS.map((s) => (<Select.Option key={s} value={s}>{t(`loop.sort.${s}`)}</Select.Option>))}
            </Select>
            <Button theme="borderless" disabled={searching || f.sortBy === "position"} icon={f.sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />} aria-label={t("loop.sort.direction")} onClick={() => update({ sortDir: f.sortDir === "asc" ? "desc" : "asc" })} />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="loop-page">
      <div className="loop-page__head loop-page__head--stack">
        <div className="loop-page__title-row">
          <h2 className="loop-page__title">{title}</h2>
        </div>
        <div className="loop-page__toolbar">
          {/* 作用域文字 tab —— grouped 视图按负责人类型收窄(all/成员/AI/与我相关)。 */}
          {view === "grouped" && (
            <div className="loop-agent-scope" role="tablist">
              {(["all", "members", "agents", "involves"] as IssueScope[]).map((s) => {
                const disabled = s === "involves" && !myMemberId;
                return (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={scope === s}
                    disabled={disabled}
                    className={`loop-agent-scope__btn${scope === s ? " is-active" : ""}`}
                    onClick={() => setScope(s)}
                  >
                    {t(`loop.scope.${s}`)}
                  </button>
                );
              })}
            </div>
          )}
          <div className="loop-page__spacer" />
          <Dropdown trigger="click" visible={filterOpen} onVisibleChange={setFilterOpen} position="bottomRight" render={filterPanel}>
            <button className={`loop-toolbtn${activeFilters > 0 ? " is-on" : ""}`}>
              <Filter size={14} />
              {t("loop.action.filter")}
              {activeFilters > 0 && <span className="loop-toolbtn__badge">{activeFilters}</span>}
            </button>
          </Dropdown>
          <Dropdown trigger="click" visible={showOpen} onVisibleChange={setShowOpen} position="bottomRight" render={showPanel}>
            <button className="loop-toolbtn">
              <SlidersHorizontal size={14} />
              {t("loop.action.show")}
            </button>
          </Dropdown>
          <Button theme="solid" icon={<Plus size={14} />} onClick={openNewLoop}>
            {t("loop.action.newIssue")}
          </Button>
        </div>
      </div>

      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center">
            <Spin />
          </div>
        ) : isEmpty ? (
          <div className="loop-empty">
            <ClipboardList size={40} className="loop-empty__icon" />
            <div className="loop-empty__title">{t("loop.empty.issueTitle")}</div>
            <div className="loop-empty__desc">{t("loop.empty.issueDesc")}</div>
            <Button theme="solid" icon={<Plus size={14} />} onClick={openNewLoop} style={{ marginTop: 12 }}>
              {t("loop.action.newIssue")}
            </Button>
          </div>
        ) : view === "board" ? (
          <IssueBoard issues={issues} onOpen={openDetail} onChanged={onMutated} running={running} />
        ) : view === "grouped" ? (
          <IssueGroupBoard groups={groups} onOpen={openDetail} running={running} />
        ) : (
          <>
            <IssueList issues={issues} onOpen={openDetail} onChanged={onMutated} running={running} />
            {total > PAGE_SIZE && (
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 4px" }}>
                <Pagination
                  total={total}
                  pageSize={PAGE_SIZE}
                  currentPage={page + 1}
                  onPageChange={(p) => setPage(p - 1)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
