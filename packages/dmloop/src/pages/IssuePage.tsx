import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Input,
  Spin,
  Select,
  Pagination,
  DatePicker,
  Checkbox,
  Dropdown,
  Toast,
} from "@douyinfe/semi-ui";
import LoopButton from "../ui/LoopButton";
import { Search, Plus, LayoutGrid, List as ListIcon, Users, ClipboardList, SlidersHorizontal, Filter } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type {
  Issue,
  IssueGroup,
  IssueScope,
  IssueStatus,
  IssuePriority,
  IssueDateField,
  IssueLabel,
} from "../api/types";
import { ISSUE_DATE_FIELDS } from "../api/types";
import { listIssues, searchIssues, listGroupedIssues, listMyGroupedIssues, getAgentTaskSnapshot } from "../api/issueApi";
import { groupIssuesByAssignee } from "../api/issueGrouping";
import { listProjectOptions } from "../api/directory";
import { listLabels } from "../api/labelApi";
import { useAssigneeCandidates } from "../ui/useAssigneeCandidates";
import { ISSUE_STATUS_ORDER, PRIORITY_ORDER, isActiveRun } from "../ui/meta";
import IssueBoard from "../panel/IssueBoard";
import IssueGroupBoard from "../panel/IssueGroupBoard";
import IssueList from "../panel/IssueList";
import IssueDetailPage from "../panel/IssueDetailPage";
import CreateIssueModal from "../ui/CreateIssueModal";
import { readView, writeView } from "../ui/viewMode";

type ViewMode = "board" | "grouped" | "list";

// scope pill → assignee_types 过滤(看板/列表/分组统一走后端 assignee_types)。
// all / involves 不按类型收窄(involves 走用户关系并集,见 reload)。
function scopeToAssigneeTypes(scope: IssueScope): ("member" | "agent" | "squad")[] | undefined {
  if (scope === "members") return ["member"];
  if (scope === "agents") return ["agent", "squad"];
  return undefined;
}

// 统一筛选:全维度数组多选 + 正交的「无负责人 / 无项目」布尔,同一套应用到看板/列表/分组
// 三视图。keyword 走独立全文搜索端点,故与其它维度不并存于同一请求。
interface Filters {
  keyword: string;
  statuses: IssueStatus[];
  priorities: IssuePriority[];
  assigneeIds: string[];
  noAssignee: boolean;
  creatorIds: string[];
  projectIds: string[];
  noProject: boolean;
  labelIds: string[];
  dateField: IssueDateField; // 时间范围筛选的列(created_at|updated_at)
  dateRange?: Date[];        // [start, end];为空则不按时间筛选
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
  // 「我的回路」= involves:只有分组视图能表达「指派/创建/关联」三路并集(listMyGroupedIssues 扇出),
  // 看板/列表无对应查询会退化成显示全工作区 → 该页锁死分组、不给切视图。
  const isMyLoop = defaultScope === "involves";
  const [issues, setIssues] = useState<Issue[]>([]);
  const [groups, setGroups] = useState<IssueGroup[]>([]);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>(() => isMyLoop ? "grouped" : (viewKey ? readView(viewKey, ["board", "grouped", "list"], defaultView ?? "board") : (defaultView ?? "board")));
  const [scope, setScope] = useState<IssueScope>(defaultScope ?? "all");
  const [f, setF] = useState<Filters>({ keyword: "", statuses: [], priorities: [], assigneeIds: [], noAssignee: false, creatorIds: [], projectIds: [], noProject: false, labelIds: [], dateField: "created_at" });
  const [page, setPage] = useState(0); // 0-based，仅列表视图分页
  // 「无负责人」仅在 scope=全部 时有效(与 assignee_types 组合恒空)。单一来源:发送/勾选态/计数共用,防漂移。
  const noAssigneeActive = scope === "all" && f.noAssignee;
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
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const seq = useRef(0); // 请求序号：只应用最新一次的响应，防并发乱序覆盖

  useEffect(() => {
    listProjectOptions().then(setProjects).catch(() => {});
    listLabels().then(setLabels).catch(() => {});
  }, []);

  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    // 请求失败(网络/权限/500):清空结果集 + 提示。不保留旧行——否则旧数据会残留在新筛选态下,
    // 且列表勾选态仍指向陈旧行,可能被批量删改误作用。seq 守卫:仅最新一次在途请求可清。
    const onErr = () => {
      if (my !== seq.current) return;
      setIssues([]); setGroups([]); setTotal(0);
      Toast.error(t("loop.toast.loadFailed"));
    };
    // 时间范围:三参数须同时给且 start<end。onChange 已把 dateRange 归一为 undefined|[起,止]。
    // 止端 +1 日历日 → 半开区间,既含止日当天、又保证 start<end;setDate 处理 DST。
    const dr = f.dateRange;
    const endExclusive = dr && new Date(dr[1]);
    if (endExclusive) endExclusive.setDate(endExclusive.getDate() + 1);

    // 统一多选筛选:同一套数组/布尔应用到三视图(空数组/未选 → 不发)。keyword 走独立
    // 全文搜索端点(不吃其它筛选),故不并入 common。
    const common = {
      statuses: f.statuses.length ? f.statuses : undefined,
      priorities: f.priorities.length ? f.priorities : undefined,
      assignee_ids: f.assigneeIds.length ? f.assigneeIds : undefined,
      // 无负责人仅在 scope=全部 时生效:成员/AI 用 assignee_types 收窄(顶层 AND),
      // 未指派项 assignee_type 为空、不满足类型谓词,二者组合恒空 → 只在 all 下发,面板亦禁用。
      include_no_assignee: noAssigneeActive || undefined,
      creator_ids: f.creatorIds.length ? f.creatorIds : undefined,
      project_ids: f.projectIds.length ? f.projectIds : undefined,
      include_no_project: f.noProject || undefined,
      label_ids: f.labelIds.length ? f.labelIds : undefined,
      date_field: dr ? f.dateField : undefined,
      date_start: dr ? dr[0].toISOString() : undefined,
      date_end: endExclusive ? endExclusive.toISOString() : undefined,
    };

    // 分组板:走 /issues/grouped(按负责人)。
    if (view === "grouped") {
      const gkw = f.keyword.trim();
      // 关键词(仅主看板,非「我的回路」)→ 全文搜索平铺结果,前端按负责人分组呈现。搜索端点
      // 独立语义(不吃 scope/其它筛选,上限 50),故与常规分组拉取分道;「我的回路」隐藏关键词、不入此路。
      if (gkw && !isMyLoop) {
        searchIssues(gkw, { limit: 50 })
          .then(({ issues }) => { if (my === seq.current) setGroups(groupIssuesByAssignee(issues)); })
          .catch(onErr)
          .finally(() => { if (my === seq.current) setLoading(false); });
        return;
      }
      // 「与我相关」(仅「我的回路」页)= 指派给我 ∪ 我创建 ∪ 间接关联的并集扇出;需当前成员
      // 后端 id,未解析出则清空并等待(不回退成无 scope 全量)。myMemberId 在依赖里,解析后自动重取。
      if (scope === "involves") {
        if (!myMemberId) {
          if (my === seq.current) { setGroups([]); setLoading(false); }
          return;
        }
        listMyGroupedIssues(myMemberId, { ...common, limit: 100 })
          .then((gs) => { if (my === seq.current) setGroups(gs); })
          .catch(onErr)
          .finally(() => { if (my === seq.current) setLoading(false); });
        return;
      }
      // ponytail: 每组取后端上限 100；超量请用筛选。
      listGroupedIssues({ ...common, assignee_types: scopeToAssigneeTypes(scope), limit: 100 })
        .then((gs) => { if (my === seq.current) setGroups(gs); })
        .catch(onErr)
        .finally(() => { if (my === seq.current) setLoading(false); });
      return;
    }

    const paged = view === "list";
    const kw = f.keyword.trim();
    // 有关键词 → 走全文搜索端点(独立语义:后端不吃其它筛选/排序、上限 50);否则常规筛选列表。
    const req = kw
      ? searchIssues(kw, { limit: paged ? PAGE_SIZE : 50, offset: paged ? page * PAGE_SIZE : 0 })
      : listIssues({
          ...common,
          assignee_types: scopeToAssigneeTypes(scope),
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
      .catch(onErr)
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [f, view, page, scope, myMemberId, noAssigneeActive]);

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
  // 订阅 `wk:loop-issues-refresh` 重取列表:由 LoopPage 在「点击 loop 导航」与「新建回路成功」时补发,
  // 覆盖"已停在 issue tab(同 key 不重挂)"的场景。走 ref 读最新 onMutated:刷新须用当前筛选/视图,
  // 否则会用陈旧入参覆盖(reload 的 seq 守卫只防乱序)。
  const onMutatedRef = useRef(onMutated);
  useEffect(() => { onMutatedRef.current = onMutated; }, [onMutated]);
  useEffect(() => {
    const onRefresh = () => onMutatedRef.current();
    WKApp.mittBus.on("wk:loop-issues-refresh", onRefresh);
    return () => WKApp.mittBus.off("wk:loop-issues-refresh", onRefresh);
  }, []);

  // 改任一筛选/搜索都回到第一页，避免停在越界的 offset（此规则只此一处表达）。
  const update = (p: Partial<Filters>) => { setF((prev) => ({ ...prev, ...p })); setPage(0); };
  const switchView = (v: ViewMode) => { setView(v); setPage(0); if (viewKey) writeView(viewKey, v); setShowOpen(false); };

  // 点击 Issue → 跳转独立详情页（push 到右主栏，返回可 pop）。
  // key=id:issueId 变化即整体重挂载 → 详情页所有异步状态从零开始,结构性杜绝跨 issue 陈旧写入
  // (如未来点子 issue 原地切换时,慢请求无法把旧 issue 数据写进新 issue 视图)。
  const openDetail = (id: string) => {
    WKApp.routeRight.push(<IssueDetailPage key={id} issueId={id} onChanged={onMutated} />);
  };

  const [createOpen, setCreateOpen] = useState(false);

  // 新建回路 → 唤起统一建单弹窗(不再拉起独立 AI 页)。创建成功后刷新列表。
  const openNewLoop = () => setCreateOpen(true);

  const isEmpty = view === "grouped" ? groups.every((g) => g.issues.length === 0) : total === 0;

  // 选项列表(多选共用,避免重复 map)。
  const statusOpts = ISSUE_STATUS_ORDER.map((s) => (
    <Select.Option key={s} value={s}>{t(`loop.status.${s}`)}</Select.Option>
  ));
  const priorityOpts = PRIORITY_ORDER.map((p) => (
    <Select.Option key={p} value={p}>{t(`loop.priority.${p}`)}</Select.Option>
  ));
  const projectOpts = projects.map((p) => (
    <Select.Option key={p.id} value={p.id}>{p.title}</Select.Option>
  ));
  const labelOpts = labels.map((l) => (
    <Select.Option key={l.id} value={l.id}>{l.name}</Select.Option>
  ));

  const title = defaultScope === "involves" ? t("loop.nav.myloop") : t("loop.nav.issue");

  // 关键词走全文搜索端点(独立语义,不吃其它筛选/排序)。搜索激活时禁用面板内其它筛选/scope,
  // 避免它们「看起来生效、实际被忽略」的误导。主看板三视图均支持;「我的回路」无关键词(搜索不吃 involves)。
  const searching = !isMyLoop && !!f.keyword.trim();

  // 「筛选」按钮上的激活计数(每个生效维度记 1)。搜索激活时只有 keyword 生效——其它维度被
  // 搜索端点忽略且面板已禁用,故不计,免得徽章高亮却对结果无影响(与 scope tab 搜索时去激活一致)。
  const activeFilters =
    (searching
      ? 0
      : (f.statuses.length ? 1 : 0) +
        (f.priorities.length ? 1 : 0) +
        (f.assigneeIds.length || noAssigneeActive ? 1 : 0) +
        (f.creatorIds.length ? 1 : 0) +
        (f.projectIds.length || f.noProject ? 1 : 0) +
        (f.labelIds.length ? 1 : 0) +
        (f.dateRange ? 1 : 0)) +
    (!isMyLoop && f.keyword.trim() ? 1 : 0);

  const clearFilters = () =>
    update({
      keyword: "", statuses: [], priorities: [], assigneeIds: [], noAssignee: false,
      creatorIds: [], projectIds: [], noProject: false, labelIds: [], dateRange: undefined,
    });

  // 一行多选筛选(标签 + Select multiple)。各维度只差 options / filter / maxTagCount,收进一个函数。
  const filterSelect = (
    label: string,
    value: string[],
    onChange: (v: string[]) => void,
    children: React.ReactNode,
    opts?: { filter?: boolean; maxTagCount?: number },
  ) => (
    <div className="loop-fields__row">
      <div className="loop-fields__label">{label}</div>
      <Select multiple value={value} onChange={(v) => onChange((v ?? []) as string[])} showClear filter={opts?.filter} disabled={searching} maxTagCount={opts?.maxTagCount ?? 1} {...FIELD_POPUP} style={{ width: "100%" }} placeholder={label}>
        {children}
      </Select>
    </div>
  );

  const filterPanel = (
    <div className="loop-fields loop-filter-panel">
      <div className="loop-filter-panel__head">
        <span>{t("loop.action.filter")}</span>
        {activeFilters > 0 && (
          <button type="button" className="loop-filter-panel__clear" onClick={clearFilters}>{t("loop.action.clearFilters")}</button>
        )}
      </div>
      {filterSelect(t("loop.filter.status"), f.statuses, (v) => update({ statuses: v as IssueStatus[] }), statusOpts, { maxTagCount: 2 })}
      {filterSelect(t("loop.filter.priority"), f.priorities, (v) => update({ priorities: v as IssuePriority[] }), priorityOpts, { maxTagCount: 2 })}
      {/* 「谁」类筛选(负责人/无负责人/创建者)在「我的回路」隐藏——该页本就锁定「与我相关」,
          按他人负责人/创建者筛与语义矛盾,且会污染并集扇出(见 listMyGroupedIssues)。 */}
      {!isMyLoop && filterSelect(t("loop.filter.assignee"), f.assigneeIds, (v) => update({ assigneeIds: v }), cands.map((c) => (<Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)), { filter: true })}
      {!isMyLoop && (
        <div className="loop-fields__row">
          <Checkbox className="loop-nofilter" checked={noAssigneeActive} onChange={(e) => update({ noAssignee: !!e.target.checked })} disabled={searching || scope !== "all"}>{t("loop.filter.noAssignee")}</Checkbox>
        </div>
      )}
      {!isMyLoop && filterSelect(t("loop.filter.creator"), f.creatorIds, (v) => update({ creatorIds: v }), cands.filter((c) => c.type === "member").map((c) => (<Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)), { filter: true })}
      {projects.length > 0 && filterSelect(t("loop.filter.project"), f.projectIds, (v) => update({ projectIds: v }), projectOpts, { filter: true })}
      <div className="loop-fields__row">
        <Checkbox className="loop-nofilter" checked={f.noProject} onChange={(e) => update({ noProject: !!e.target.checked })} disabled={searching}>{t("loop.filter.noProject")}</Checkbox>
      </div>
      {labels.length > 0 && filterSelect(t("loop.filter.label"), f.labelIds, (v) => update({ labelIds: v }), labelOpts, { filter: true })}
      <div className="loop-fields__row">
        <div className="loop-fields__label">{t("loop.filter.dateRange")}</div>
        <div className="loop-fields__inline">
          <Select value={f.dateField} onChange={(v) => update({ dateField: v as IssueDateField })} disabled={searching} {...FIELD_POPUP} style={{ width: 104 }}>
            {ISSUE_DATE_FIELDS.map((d) => (<Select.Option key={d} value={d}>{t(`loop.dateField.${d}`)}</Select.Option>))}
          </Select>
          <DatePicker type="dateRange" density="compact" disabled={searching} value={f.dateRange} onChange={(d) => update({ dateRange: Array.isArray(d) && d.length === 2 && d[0] && d[1] ? (d as Date[]) : undefined })} placeholder={t("loop.filter.dateRange")} zIndex={FIELD_POPUP.zIndex} style={{ flex: 1 }} />
        </div>
      </div>
      {/* 关键词走全文搜索(平铺,分组视图前端按负责人再分组呈现)。「我的回路」不支持(搜索不吃 involves)。 */}
      {!isMyLoop && (
        <div className="loop-fields__row">
          <div className="loop-fields__label">{t("loop.search.issue")}</div>
          <Input className="loop-search" prefix={<Search size={14} />} placeholder={t("loop.search.issue")} value={f.keyword} onChange={(v) => update({ keyword: v })} showClear style={{ width: "100%" }} />
        </div>
      )}
    </div>
  );

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
    </div>
  );

  return (
    <div className="loop-page">
      <div className="loop-page__head loop-page__head--stack">
        <div className="loop-page__title-row">
          <h2 className="loop-page__title">{title}</h2>
          <span className="loop-page__title-beta">{t("loop.beta")}</span>
        </div>
        <div className="loop-page__toolbar">
          {/* 作用域 tab:全部/成员/AI,贯三视图,走后端 assignee_types。
              「我的回路」锁定 involves、不给切 scope(否则点「全部」会显示全工作区),故不渲染。 */}
          {!isMyLoop && (
            <div className="loop-agent-scope" role="tablist">
              {(["all", "members", "agents"] as IssueScope[]).map((s) => {
                // 搜索激活时 scope 不参与(searchIssues 不吃 scope):既禁用、也不显选中态,
                // 免得高亮的 tab 暗示"结果已按此 scope 收窄"。scope 状态保留,清空搜索后恢复。
                const active = !searching && scope === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={searching}
                    className={`loop-agent-scope__btn${active ? " is-active" : ""}`}
                    onClick={() => { setScope(s); setPage(0); }}
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
          {/* 「我的回路」锁死分组视图,不给切视图/排序 → 隐藏「显示」入口。 */}
          {!isMyLoop && (
            <Dropdown trigger="click" visible={showOpen} onVisibleChange={setShowOpen} position="bottomRight" render={showPanel}>
              <button className="loop-toolbtn">
                <SlidersHorizontal size={14} />
                {t("loop.action.show")}
              </button>
            </Dropdown>
          )}
          <LoopButton icon={<Plus size={14} />} onClick={openNewLoop}>
            {t("loop.action.newIssue")}
          </LoopButton>
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
            <LoopButton icon={<Plus size={14} />} onClick={openNewLoop} style={{ marginTop: 12 }}>
              {t("loop.action.newIssue")}
            </LoopButton>
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
      <CreateIssueModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); onMutated(); Toast.success(t("loop.toast.created")); }}
      />
    </div>
  );
}
