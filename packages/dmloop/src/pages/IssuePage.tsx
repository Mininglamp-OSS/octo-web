import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Spin,
  Toast,
  Select,
  Pagination,
  DatePicker,
  RadioGroup,
  Radio,
} from "@douyinfe/semi-ui";
import { Search, Plus, LayoutGrid, List as ListIcon, Users, ClipboardList, ArrowUp, ArrowDown } from "lucide-react";
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
import CreateIssueModal from "../ui/CreateIssueModal";

const { Title } = Typography;

type ViewMode = "board" | "grouped" | "list";

// scope pill → assignee_types 过滤(仅 /grouped 支持;all/involves 不按类型收窄)。
function scopeToAssigneeTypes(scope: IssueScope): ("member" | "agent" | "squad")[] | undefined {
  if (scope === "members") return ["member"];
  if (scope === "agents") return ["agent", "squad"];
  return undefined;
}

interface Filters {
  keyword: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assignee?: string;
  creator?: string;
  project?: string;
  dateField: IssueDateField; // 时间范围筛选的列(created_at|updated_at)
  dateRange?: Date[];        // [start, end];为空则不按时间筛选
  sortBy: IssueSortField;
  sortDir: "asc" | "desc";
}

const PAGE_SIZE = 50;

export default function IssuePage() {
  const { t } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [groups, setGroups] = useState<IssueGroup[]>([]);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("board");
  const [scope, setScope] = useState<IssueScope>("all");
  const [f, setF] = useState<Filters>({ keyword: "", sortBy: "position", sortDir: "desc", dateField: "created_at" });
  const [page, setPage] = useState(0); // 0-based，仅列表视图分页
  const [createOpen, setCreateOpen] = useState(false);
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
        statuses: f.status ? [f.status] : undefined,
        priorities: f.priority ? [f.priority] : undefined,
        creator_id: f.creator,
        project_id: f.project,
        date_field: dr ? f.dateField : undefined,
        date_start: dr ? dr[0].toISOString() : undefined,
        date_end: endExclusive ? endExclusive.toISOString() : undefined,
        // ponytail: 每组取后端上限 100；超量请用筛选。
        limit: 100,
      };
      // 「与我相关」= 指派给我 ∪ 我创建 ∪ 间接关联(后端三过滤并集,fan-out 合并);
      // 其余 scope 单发一次、按 assignee_types 收窄。myMemberId 缺失时 pill 已禁用,不会走到此分支。
      const req =
        scope === "involves" && myMemberId
          ? listMyGroupedIssues(myMemberId, gp)
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

  // 改任一筛选/搜索都回到第一页，避免停在越界的 offset（此规则只此一处表达）。
  const update = (p: Partial<Filters>) => { setF((prev) => ({ ...prev, ...p })); setPage(0); };
  const switchView = (v: ViewMode) => { setView(v); setPage(0); };

  // 点击 Issue → 跳转独立详情页（push 到右主栏，返回可 pop）。
  // key=id:issueId 变化即整体重挂载 → 详情页所有异步状态从零开始,结构性杜绝跨 issue 陈旧写入
  // (如未来点子 issue 原地切换时,慢请求无法把旧 issue 数据写进新 issue 视图)。
  const openDetail = (id: string) => {
    WKApp.routeRight.push(<IssueDetailPage key={id} issueId={id} onChanged={onMutated} />);
  };

  const isEmpty = view === "grouped" ? groups.every((g) => g.issues.length === 0) : total === 0;

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.issue")}</Title>
        <div className="loop-viewtoggle">
          <button className={view === "board" ? "is-active" : ""} onClick={() => switchView("board")}>
            <LayoutGrid size={14} />
            {t("loop.view.board")}
          </button>
          <button className={view === "grouped" ? "is-active" : ""} onClick={() => switchView("grouped")}>
            <Users size={14} />
            {t("loop.view.grouped")}
          </button>
          <button className={view === "list" ? "is-active" : ""} onClick={() => switchView("list")}>
            <ListIcon size={14} />
            {t("loop.view.list")}
          </button>
        </div>
        {view === "grouped" && (
          <RadioGroup
            type="button"
            buttonSize="small"
            value={scope}
            onChange={(e) => setScope(e.target.value as IssueScope)}
          >
            <Radio value="all">{t("loop.scope.all")}</Radio>
            <Radio value="members">{t("loop.scope.members")}</Radio>
            <Radio value="agents">{t("loop.scope.agents")}</Radio>
            {/* 「与我相关」需当前成员的后端 id;未解析出则禁用(而非静默失效)。 */}
            <Radio value="involves" disabled={!myMemberId}>{t("loop.scope.involves")}</Radio>
          </RadioGroup>
        )}
        <div className="loop-page__spacer" />
        <Select
          placeholder={t("loop.filter.status")}
          value={f.status}
          onChange={(v) => update({ status: v as IssueStatus | undefined })}
          showClear
          size="small"
          style={{ width: 130 }}
        >
          {ISSUE_STATUS_ORDER.map((s) => (
            <Select.Option key={s} value={s}>{t(`loop.status.${s}`)}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder={t("loop.filter.priority")}
          value={f.priority}
          onChange={(v) => update({ priority: v as IssuePriority | undefined })}
          showClear
          size="small"
          style={{ width: 120 }}
        >
          {PRIORITY_ORDER.map((p) => (
            <Select.Option key={p} value={p}>{t(`loop.priority.${p}`)}</Select.Option>
          ))}
        </Select>
        {/* assignee 单选筛选仅扁平列表/看板用(grouped 用 scope pill 按类型收窄)。 */}
        {view !== "grouped" && (
          <Select
            placeholder={t("loop.filter.assignee")}
            value={f.assignee}
            onChange={(v) => update({ assignee: v as string | undefined })}
            showClear
            filter
            size="small"
            style={{ width: 150 }}
          >
            {cands.map((c) => (
              <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
            ))}
          </Select>
        )}
        {/* 「与我相关」自带 creator=我 的并集腿,creator 下拉对它无效 → 隐藏,避免设了不生效。 */}
        {!(view === "grouped" && scope === "involves") && (
          <Select
            placeholder={t("loop.filter.creator")}
            value={f.creator}
            onChange={(v) => update({ creator: v as string | undefined })}
            showClear
            filter
            size="small"
            style={{ width: 130 }}
          >
            {cands.filter((c) => c.type === "member").map((c) => (
              <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
            ))}
          </Select>
        )}
        {projects.length > 0 && (
          <Select
            placeholder={t("loop.filter.project")}
            value={f.project}
            onChange={(v) => update({ project: v as string | undefined })}
            showClear
            filter
            size="small"
            style={{ width: 140 }}
          >
            {projects.map((p) => (
              <Select.Option key={p.id} value={p.id}>{p.title}</Select.Option>
            ))}
          </Select>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {f.dateRange && (
            <Select
              value={f.dateField}
              onChange={(v) => update({ dateField: v as IssueDateField })}
              size="small"
              style={{ width: 104 }}
            >
              {ISSUE_DATE_FIELDS.map((d) => (
                <Select.Option key={d} value={d}>{t(`loop.dateField.${d}`)}</Select.Option>
              ))}
            </Select>
          )}
          <DatePicker
            type="dateRange"
            size="small"
            density="compact"
            value={f.dateRange}
            onChange={(d) => update({ dateRange: Array.isArray(d) && d.length === 2 && d[0] && d[1] ? (d as Date[]) : undefined })}
            placeholder={t("loop.filter.dateRange")}
            style={{ width: 220 }}
          />
        </div>
        {view === "list" && (
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Select
            value={f.sortBy}
            onChange={(v) => update({ sortBy: v as IssueSortField })}
            size="small"
            style={{ width: 120 }}
          >
            {ISSUE_SORT_FIELDS.map((s) => (
              <Select.Option key={s} value={s}>{t(`loop.sort.${s}`)}</Select.Option>
            ))}
          </Select>
          <Button
            size="small"
            theme="borderless"
            // position(手动序)后端忽略方向,禁用切换。
            disabled={f.sortBy === "position"}
            icon={f.sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            aria-label={t("loop.sort.direction")}
            onClick={() => update({ sortDir: f.sortDir === "asc" ? "desc" : "asc" })}
          />
        </div>
        )}
        {/* 关键词走全文搜索(独立语义,不与 grouped 组合),故分组视图隐藏。 */}
        {view !== "grouped" && (
          <Input
            prefix={<Search size={14} />}
            placeholder={t("loop.search.issue")}
            value={f.keyword}
            onChange={(v) => update({ keyword: v })}
            showClear
            style={{ width: 200 }}
          />
        )}
        <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          {t("loop.action.newIssue")}
        </Button>
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
            <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} style={{ marginTop: 12 }}>
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

      <CreateIssueModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { Toast.success(t("loop.toast.created")); onMutated(); }}
      />
    </div>
  );
}
