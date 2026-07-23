import type {
  AssigneeCandidate,
  IssueDateField,
  IssueLabel,
  IssuePriority,
  IssueScope,
  IssueStatus,
} from "../api/types";
import { ISSUE_DATE_FIELDS } from "../api/types";

export interface IssueFilters {
  keyword: string;
  statuses: IssueStatus[];
  priorities: IssuePriority[];
  assigneeIds: string[];
  noAssignee: boolean;
  creatorIds: string[];
  projectIds: string[];
  noProject: boolean;
  labelIds: string[];
  dateField: IssueDateField;
  dateRange?: Date[];
}

export interface IssueFilterState {
  filters: IssueFilters;
  scope: IssueScope;
}

export interface IssueFilterOptionIds {
  assigneeIds?: string[];
  creatorIds?: string[];
  projectIds?: string[];
  labelIds?: string[];
}

export interface IssueFilterOptionSource {
  candidates: AssigneeCandidate[];
  candidatesLoaded: boolean;
  candidatesSucceeded: boolean;
  projects: Array<{ id: string }>;
  projectsLoaded: boolean;
  projectsSucceeded: boolean;
  labels: Pick<IssueLabel, "id">[];
  labelsLoaded: boolean;
  labelsSucceeded: boolean;
}

export interface IssueFilterReader {
  getItem(key: string): string | null;
}

export interface IssueFilterWriter {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];
const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low", "none"];
const ISSUE_PAGE_SCOPES: IssueScope[] = ["all", "members", "agents"];

export function defaultIssueFilters(): IssueFilters {
  return {
    keyword: "",
    statuses: [],
    priorities: [],
    assigneeIds: [],
    noAssignee: false,
    creatorIds: [],
    projectIds: [],
    noProject: false,
    labelIds: [],
    dateField: "created_at",
    dateRange: undefined,
  };
}

export function issueFilterStorageKey(
  workspaceSlug: string,
  viewKey?: string,
  workspaceId?: string
): string | null {
  if (!workspaceSlug || !viewKey || !workspaceId) return null;
  return `loop.issue.filters:${viewKey}:workspace:${workspaceId}`;
}

export function readIssueFilterState(
  store: IssueFilterReader,
  key: string | null,
  fallbackScope: IssueScope,
  isMyLoop: boolean
): IssueFilterState {
  const fallback = { filters: defaultIssueFilters(), scope: fallbackScope };
  if (!key) return fallback;
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    return normalizeState(JSON.parse(raw), fallbackScope, isMyLoop);
  } catch {
    return fallback;
  }
}

export function writeIssueFilterState(
  store: IssueFilterWriter,
  key: string | null,
  state: IssueFilterState,
  isMyLoop: boolean
): void {
  if (!key) return;
  const normalized = normalizeState(state, state.scope, isMyLoop);
  try {
    if (isDefaultState(normalized, isMyLoop)) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, JSON.stringify(serializeState(normalized, isMyLoop)));
  } catch {
    /* ignore storage quota / privacy mode failures */
  }
}

export function reconcileIssueFilters(
  filters: IssueFilters,
  options: IssueFilterOptionIds,
  isMyLoop: boolean
): IssueFilters {
  const next: IssueFilters = {
    ...filters,
    assigneeIds: isMyLoop
      ? []
      : intersect(filters.assigneeIds, options.assigneeIds),
    creatorIds: isMyLoop
      ? []
      : intersect(filters.creatorIds, options.creatorIds),
    projectIds: intersect(filters.projectIds, options.projectIds),
    labelIds: intersect(filters.labelIds, options.labelIds),
  };
  if (isMyLoop && (next.keyword || next.noAssignee)) {
    next.keyword = "";
    next.noAssignee = false;
  }
  return filtersEqual(filters, next) ? filters : next;
}

export function issueFilterOptionIds(
  source: IssueFilterOptionSource
): IssueFilterOptionIds {
  return {
    assigneeIds:
      source.candidatesLoaded && source.candidatesSucceeded
        ? source.candidates.map((c) => c.id)
        : undefined,
    creatorIds:
      source.candidatesLoaded && source.candidatesSucceeded
        ? source.candidates.filter((c) => c.type === "member").map((c) => c.id)
        : undefined,
    projectIds:
      source.projectsLoaded && source.projectsSucceeded
        ? source.projects.map((p) => p.id)
        : undefined,
    labelIds:
      source.labelsLoaded && source.labelsSucceeded
        ? source.labels.map((l) => l.id)
        : undefined,
  };
}

export function filtersEqual(a: IssueFilters, b: IssueFilters): boolean {
  return (
    a.keyword === b.keyword &&
    a.noAssignee === b.noAssignee &&
    a.noProject === b.noProject &&
    a.dateField === b.dateField &&
    arraysEqual(a.statuses, b.statuses) &&
    arraysEqual(a.priorities, b.priorities) &&
    arraysEqual(a.assigneeIds, b.assigneeIds) &&
    arraysEqual(a.creatorIds, b.creatorIds) &&
    arraysEqual(a.projectIds, b.projectIds) &&
    arraysEqual(a.labelIds, b.labelIds) &&
    datesEqual(a.dateRange, b.dateRange)
  );
}

function normalizeState(
  value: unknown,
  fallbackScope: IssueScope,
  isMyLoop: boolean
): IssueFilterState {
  const v = isRecord(value) ? value : {};
  const rawFilters = isRecord(v.filters) ? v.filters : v;
  const filters = normalizeFilters(rawFilters, isMyLoop);
  const scope =
    !isMyLoop &&
    typeof v.scope === "string" &&
    ISSUE_PAGE_SCOPES.includes(v.scope as IssueScope)
      ? (v.scope as IssueScope)
      : fallbackScope;
  return { filters, scope };
}

function normalizeFilters(
  value: Record<string, unknown>,
  isMyLoop: boolean
): IssueFilters {
  const defaults = defaultIssueFilters();
  const dateRange = normalizeDateRange(value.dateRange);
  return {
    keyword: isMyLoop ? "" : stringValue(value.keyword),
    statuses: enumList(value.statuses, STATUSES),
    priorities: enumList(value.priorities, PRIORITIES),
    assigneeIds: isMyLoop ? [] : stringList(value.assigneeIds),
    noAssignee: isMyLoop ? false : value.noAssignee === true,
    creatorIds: isMyLoop ? [] : stringList(value.creatorIds),
    projectIds: stringList(value.projectIds),
    noProject: value.noProject === true,
    labelIds: stringList(value.labelIds),
    dateField:
      typeof value.dateField === "string" &&
      (ISSUE_DATE_FIELDS as readonly string[]).includes(value.dateField)
        ? (value.dateField as IssueDateField)
        : defaults.dateField,
    dateRange,
  };
}

function serializeState(state: IssueFilterState, isMyLoop: boolean) {
  const filters = state.filters;
  return {
    filters: {
      keyword: isMyLoop ? "" : filters.keyword,
      statuses: filters.statuses,
      priorities: filters.priorities,
      assigneeIds: isMyLoop ? [] : filters.assigneeIds,
      noAssignee: isMyLoop ? false : filters.noAssignee,
      creatorIds: isMyLoop ? [] : filters.creatorIds,
      projectIds: filters.projectIds,
      noProject: filters.noProject,
      labelIds: filters.labelIds,
      dateField: filters.dateField,
      dateRange: filters.dateRange?.map((d) => d.toISOString()),
    },
    scope: isMyLoop ? undefined : state.scope,
  };
}

function isDefaultState(state: IssueFilterState, isMyLoop: boolean): boolean {
  const defaults = defaultIssueFilters();
  const defaultScope = isMyLoop ? "involves" : "all";
  return (
    filtersEqual(state.filters, defaults) &&
    (isMyLoop || state.scope === defaultScope)
  );
}

function normalizeDateRange(value: unknown): Date[] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const start = toValidDate(value[0]);
  const end = toValidDate(value[1]);
  if (!start || !end || start.getTime() > end.getTime()) return undefined;
  return [start, end];
}

function toValidDate(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function enumList<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T[] {
  const allowedSet = new Set<string>(allowed);
  return stringList(value).filter((v): v is T => allowedSet.has(v));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function intersect(value: string[], allowed?: string[]): string[] {
  if (!allowed) return value;
  const allowedSet = new Set(allowed);
  return value.filter((id) => allowedSet.has(id));
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function datesEqual(a?: Date[], b?: Date[]): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((date, i) => date.getTime() === b[i].getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
